import jwt
from jwt import PyJWKClient

from ..config import settings

_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_jwks_client = PyJWKClient(_JWKS_URL)


class GoogleTokenError(Exception):
    pass


def verify_google_id_token(id_token: str) -> dict:
    """Verify a Google Identity Services JWT and return its claims."""
    if not settings.GOOGLE_CLIENT_ID:
        raise GoogleTokenError("GOOGLE_CLIENT_ID is not configured on the server")
    try:
        key = _jwks_client.get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            issuer="https://accounts.google.com",
            audience=settings.GOOGLE_CLIENT_ID,
            options={"verify_exp": True},
        )
    except GoogleTokenError:
        raise
    except jwt.PyJWTError as exc:
        raise GoogleTokenError("Invalid or expired Google token") from exc
    return claims