import asyncio
import ipaddress
import json
import re
import random
import socket
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .api import auth_routes, bank_routes, profile_routes, sync_routes, transaction_routes, vault_routes
from .config import settings
from .database import Base, engine

# Import models so the metadata is populated before create_all / alembic.
from .models import Base as _  # noqa: F401


class ProductURLRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


def _parse_price(value) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"[-+]?\d[\d,]*(?:\.\d{1,2})?", text)
    if not match:
        return None
    number = match.group(0).replace(",", "")
    try:
        price = float(number)
    except ValueError:
        return None
    return round(price, 2) if price > 0 else None


def _meta_content(soup, **attrs):
    element = soup.find("meta", attrs=attrs)
    if not element:
        return ""
    return (element.get("content") or "").strip()


def _product_store(url: str) -> str:
    hostname = (urlsplit(url).hostname or "Online Store").lower().removeprefix("www.")
    stores = (
        ("amazon", "Amazon"),
        ("flipkart", "Flipkart"),
        ("ebay", "eBay"),
        ("walmart", "Walmart"),
        ("etsy", "Etsy"),
        ("myntra", "Myntra"),
    )
    for marker, name in stores:
        if marker in hostname:
            return name
    return hostname.split(".")[0].replace("-", " ").title() or "Online Store"


def _json_ld_price(soup) -> float | None:
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            payload = json.loads(script.get_text())
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        nodes = payload if isinstance(payload, list) else [payload]
        pending = list(nodes)
        visited = 0
        while pending and visited < 60:
            visited += 1
            node = pending.pop(0)
            if isinstance(node, dict):
                offers = node.get("offers")
                if isinstance(offers, dict):
                    price = _parse_price(offers.get("price") or offers.get("lowPrice"))
                    if price:
                        return price
                if isinstance(offers, list):
                    for offer in offers:
                        if isinstance(offer, dict):
                            price = _parse_price(offer.get("price") or offer.get("lowPrice"))
                            if price:
                                return price
                pending.extend(value for value in node.values() if isinstance(value, (dict, list)))
            elif isinstance(node, list):
                pending.extend(node)
    return None


def _select_text(soup, selectors: tuple[str, ...]) -> str:
    for selector in selectors:
        element = soup.select_one(selector)
        if element:
            value = element.get_text(" ", strip=True)
            if value:
                return value
    return ""


def _looks_like_captcha(soup, status_code: int) -> bool:
    if status_code in {403, 429}:
        return True
    text = soup.get_text(" ", strip=True)[:8000].lower()
    markers = ("captcha", "robot check", "verify you are human", "unusual traffic", "access denied", "cf-chl-")
    return any(marker in text for marker in markers)


def _slug_title(url: str) -> str:
    path = urlsplit(url).path.strip("/")
    parts = [p for p in path.split("/") if p and p.lower() not in {"dp", "p", "gp", "product", "item"}]
    if parts:
        slug = parts[0]
        words = re.sub(r"[-_+]+", " ", slug).strip()
        if len(words) > 3 and not words.isdigit():
            return words[:120].title()
    return "Tracked Product"


def _extract_product(soup, url: str, is_captcha: bool = False) -> dict:
    title = _select_text(soup, ("span#productTitle", "h1#title", "span.B_NuCI", "span.VU-ZEz", "h1._6EBuvT"))
    title = title or _meta_content(soup, property="og:title") or _meta_content(soup, name="twitter:title")
    if not title or title.lower() in {"robot check", "amazon.in", "flipkart", "access denied", "blocked"}:
        title = _slug_title(url)

    price = None
    whole = soup.find("span", class_=re.compile(r"a-price-whole"))
    fraction = soup.find("span", class_=re.compile(r"a-price-fraction"))
    if whole:
        price = _parse_price(whole.get_text())
        if price and fraction:
            fraction_text = fraction.get_text(" ", strip=True)
            decimal = _parse_price(fraction_text)
            if decimal is not None and decimal < 1:
                price = round(price + decimal, 2)
            elif re.fullmatch(r"\d{1,2}", fraction_text):
                price = round(price + int(fraction_text) / 100, 2)
    if not price:
        price = _parse_price(_meta_content(soup, property="product:price:amount"))
    if not price:
        price = _parse_price(_meta_content(soup, property="og:price:amount"))
    if not price:
        for selector in (
            "#priceblock_ourprice",
            "#priceblock_dealprice",
            "#corePriceDisplay_desktop_feature_div .a-price-whole",
            "span.apexPriceToPay span.a-offscreen",
            "span.a-price-whole",
            "div.Nx9bqj.CxhGGd",
            "div._30jeq3._16J06d",
            "div._30jeq3",
            "div._25b18c ._30jeq3",
            "twister-plus-buying-options-price-data",
            "[data-a-price]",
        ):
            element = soup.select_one(selector)
            if not element:
                continue
            price = _parse_price(element.get("content") or element.get("data-price") or element.get_text(" ", strip=True))
            if price:
                break
    if not price:
        price_element = soup.find(attrs={"itemprop": "price"})
        price = _parse_price(
            (price_element.get("content") or price_element.get_text(" ", strip=True)) if price_element else None
        )
    if not price:
        price = _json_ld_price(soup)

    image_element = (
        soup.find("img", id="landingImage")
        or soup.find("img", class_=re.compile(r"_396cs4|DByuf4|_2r_T1I"))
        or soup.find("img", attrs={"itemprop": "image"})
    )
    image = (image_element.get("src") or image_element.get("data-src") if image_element else "") or _meta_content(soup, property="og:image")
    currency = _meta_content(soup, property="product:price:currency") or _meta_content(soup, property="og:price:currency")
    return {
        "success": not is_captcha,
        "is_captcha": is_captcha,
        "title": title,
        "price": price,
        "image_url": image,
        "category": "Electronics",
        "currency": currency or None,
        "store_name": _product_store(url),
    }


USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
)


async def _validate_product_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Only public HTTP product URLs are supported")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".local") or hostname == "metadata.google.internal":
        raise HTTPException(status_code=400, detail="Private product URLs are not supported")
    try:
        addresses = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, socket.getaddrinfo, hostname, parsed.port or (443 if parsed.scheme == "https" else 80)),
            timeout=3.0
        )
    except (socket.gaierror, asyncio.TimeoutError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Product host could not be resolved") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(status_code=400, detail="Private product URLs are not supported")


def create_app() -> FastAPI:
    if settings.AUTO_CREATE_TABLES:
        Base.metadata.create_all(bind=engine)

    app = FastAPI(
        title=settings.APP_NAME,
        debug=settings.DEBUG,
        openapi_url=f"{settings.API_PREFIX}/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz", tags=["system"])
    def healthz() -> dict:
        return {"status": "ok", "app": settings.APP_NAME}

    @app.post(f"{settings.API_PREFIX}/scrape-product", tags=["products"])
    async def scrape_product(payload: ProductURLRequest) -> dict:
        await _validate_product_url(payload.url)
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "Sec-CH-UA-Mobile": "?0",
            "Sec-CH-UA-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }
        client_timeout = httpx.Timeout(6.0, connect=3.0)
        try:
            async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=client_timeout) as client:
                response = await client.get(payload.url)
            for redirect in [*response.history, response]:
                await _validate_product_url(str(redirect.url))
            if len(response.content) > 8 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Product page is too large to scan")
            soup = BeautifulSoup(response.text, "html.parser")
            is_captcha = _looks_like_captcha(soup, response.status_code)
            product = _extract_product(soup, str(response.url), is_captcha=is_captcha)
            return product
        except HTTPException:
            raise
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            raise HTTPException(status_code=504, detail="Store connection timed out. Please enter details manually.") from exc
        except (httpx.HTTPError, OSError) as exc:
            raise HTTPException(status_code=502, detail="Product page could not be reached. You can enter details manually.") from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Product details could not be parsed. You can enter details manually.") from exc

    app.include_router(auth_routes.router, prefix=settings.API_PREFIX)
    app.include_router(vault_routes.router, prefix=settings.API_PREFIX)
    app.include_router(transaction_routes.router, prefix=settings.API_PREFIX)
    app.include_router(profile_routes.router, prefix=settings.API_PREFIX)
    app.include_router(bank_routes.router, prefix=settings.API_PREFIX)
    app.include_router(sync_routes.router, prefix=settings.API_PREFIX)

    return app


app = create_app()