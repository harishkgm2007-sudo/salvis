from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Salvis API"
    DEBUG: bool = False
    API_PREFIX: str = "/api"

    DATABASE_URL: str = "sqlite:///./salvis.db"

    JWT_SECRET: str = "dev-only-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    GOOGLE_CLIENT_ID: str = ""

    CORS_ORIGINS: str = (
        "https://harishkgm2007-sudo.github.io,"
        "http://localhost:8000,"
        "http://localhost:5500"
    )

    AUTO_CREATE_TABLES: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()