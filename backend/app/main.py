from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import auth_routes, bank_routes, profile_routes, sync_routes, transaction_routes, vault_routes
from .config import settings
from .database import Base, engine

# Import models so the metadata is populated before create_all / alembic.
from .models import Base as _  # noqa: F401


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

    app.include_router(auth_routes.router, prefix=settings.API_PREFIX)
    app.include_router(vault_routes.router, prefix=settings.API_PREFIX)
    app.include_router(transaction_routes.router, prefix=settings.API_PREFIX)
    app.include_router(profile_routes.router, prefix=settings.API_PREFIX)
    app.include_router(bank_routes.router, prefix=settings.API_PREFIX)
    app.include_router(sync_routes.router, prefix=settings.API_PREFIX)

    return app


app = create_app()