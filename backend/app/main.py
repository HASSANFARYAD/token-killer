from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, extension, usage
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="RTK Backend", version="0.1.0")
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(auth.router)
    app.include_router(auth.api_router)
    app.include_router(extension.router)
    app.include_router(extension.api_router)
    app.include_router(usage.router)
    app.include_router(usage.api_router)
    app.include_router(admin.router)
    app.include_router(admin.api_router)

    app.add_api_route("/api/me", auth.me, methods=["GET"], response_model=auth.CurrentUserResponse)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    return app


app = create_app()
