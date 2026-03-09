from pathlib import Path

from app.core.config import Settings


def ensure_runtime_dirs(settings: Settings) -> None:
    for path in (
        settings.db_path.parent,
        settings.log_dir,
        settings.upload_dir,
        settings.export_dir,
    ):
        Path(path).mkdir(parents=True, exist_ok=True)
