import random
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..core.google import GoogleTokenError, verify_google_id_token
from ..core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from ..database import get_db
from ..models import User
from ..schemas import GoogleLoginRequest, LoginRequest, RefreshRequest, RegisterRequest, TokenPair, UserOut
from .deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


def _find_user(db: Session, identifier: str) -> User | None:
    raw = (identifier or "").strip()
    if not raw:
        return None
    lowered = raw.lower()
    digits = re.sub(r"\D", "", raw)

    user = db.query(User).filter(func.lower(User.email) == lowered).first()
    if user:
        return user
    user = db.query(User).filter(User.nickname == raw).first()
    if user:
        return user
    user = db.query(User).filter(User.salvis_id == raw.upper()).first()
    if user:
        return user
    if digits:
        user = db.query(User).filter(or_(User.phone == raw, func.regexp_replace(User.phone, r"\D", "") == digits)).first()
        if user:
            return user
    return None


def _upsert_google_user(db: Session, claims: dict) -> User:
    email = (claims.get("email") or "").lower()
    google_sub = str(claims.get("sub") or "")
    if not email and not google_sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google token missing email")

    user = None
    if email:
        user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user and google_sub:
        user = db.query(User).filter(User.google_sub == google_sub).first()

    if user:
        user.google_sub = user.google_sub or google_sub
        user.name = claims.get("name") or user.name
        user.avatar = claims.get("picture") or user.avatar
        if not user.google_sub:
            user.google_sub = google_sub
    else:
        user = User(
            email=email,
            salvis_id="SALVIS-" + str(random.randint(100000, 999999)),
            google_sub=google_sub or None,
            name=claims.get("name") or email.split("@")[0] or "Salvis User",
            nickname="@" + re.sub(r"[^a-z0-9]", "", (claims.get("name") or "user").lower()),
            avatar=claims.get("picture"),
            password_hash="",
            is_security_onboarded=False,
        )
        db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    existing = db.query(User).filter(func.lower(User.email) == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    user = User(
        email=email,
        name=payload.name.strip() or "Salvis User",
        nickname="@" + re.sub(r"[^a-z0-9]", "", payload.name.lower()),
        password_hash=hash_password(payload.password),
        is_security_onboarded=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _tokens(user)


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = _find_user(db, payload.identifier)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
    return _tokens(user)


@router.post("/google", response_model=TokenPair)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    try:
        claims = verify_google_id_token(payload.id_token)
    except GoogleTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    user = _upsert_google_user(db, claims)
    return _tokens(user)


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    decoded = decode_token(payload.refresh_token)
    if not decoded or decoded.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = db.get(User, decoded.get("sub", ""))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account unavailable")
    return _tokens(user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user