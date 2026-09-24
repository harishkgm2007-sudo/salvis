from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from ..config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _base_claims(subject: str, token_type: str, expires_delta: timedelta) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }


def create_access_token(subject: str) -> str:
    payload = _base_claims(subject, "access", timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(subject: str) -> str:
    payload = _base_claims(subject, "refresh", timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None