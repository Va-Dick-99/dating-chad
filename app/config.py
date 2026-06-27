"""Application configuration loaded from environment / .env."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = ""

    host: str = "127.0.0.1"
    port: int = 8000

    tinder_x_auth_token: str = ""

    @property
    def llm_enabled(self) -> bool:
        """True when an API key is configured; otherwise we use the heuristic fallback."""
        return bool(self.openai_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
