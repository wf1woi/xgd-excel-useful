from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "xgd-excel-useful-backend"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    app_reload: bool = False
    db_path: Path = Field(default=BASE_DIR / "db" / "app.sqlite3")
    log_dir: Path = Field(default=BASE_DIR / "log")
    upload_dir: Path = Field(default=BASE_DIR / "storage" / "uploads")
    export_dir: Path = Field(default=BASE_DIR / "storage" / "exports")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
