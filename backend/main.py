import logging

import uvicorn

from app.core.bootstrap import ensure_runtime_dirs
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.server import app


def main() -> None:
    settings = get_settings()
    ensure_runtime_dirs(settings)
    setup_logging(settings.log_dir)
    logger = logging.getLogger(__name__)

    try:
        uvicorn.run(
            app,
            host=settings.app_host,
            port=settings.app_port,
            reload=settings.app_reload,
        )
    except Exception:
        logger.exception(
            "Backend startup failed. host=%s port=%s reload=%s",
            settings.app_host,
            settings.app_port,
            settings.app_reload,
        )
        raise


if __name__ == "__main__":
    main()
