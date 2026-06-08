from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    microsoft_tenant_id: str = Field(alias="MICROSOFT_TENANT_ID")
    microsoft_client_id: str = Field(alias="MICROSOFT_CLIENT_ID")
    app_secret_key: str = Field(alias="APP_SECRET_KEY")
    command_hash_secret: str = Field(alias="COMMAND_HASH_SECRET")
    access_token_minutes: int = Field(default=30, alias="ACCESS_TOKEN_MINUTES")
    cors_origins: str = Field(default="", alias="CORS_ORIGINS")
    seed_super_admin_email: str = Field(default="rtk@hazentech.com", alias="SEED_SUPER_ADMIN_EMAIL")
    seed_super_admin_password: str = Field(default="Admin@123456", alias="SEED_SUPER_ADMIN_PASSWORD")
    seed_super_admin_name: str = Field(default="RTK Bootstrap Super Admin", alias="SEED_SUPER_ADMIN_NAME")
    seed_organization_name: str = Field(default="HazenTech", alias="SEED_ORGANIZATION_NAME")

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
