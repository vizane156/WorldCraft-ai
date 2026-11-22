from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str

    # Gemini
    gemini_api_key: str

    # CORS — comma-separated list of allowed origins
    allowed_origins: str = "https://localhost:8081"

    # Scene constraints
    scene_radius_m: float = 0.5
    scene_max_objects: int = 20

    # Rate limiting
    rate_limit_rpm: int = 10

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
