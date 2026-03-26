import logging
from pathlib import Path

from app.utils.timezone import shanghai_now, shanghai_time_tuple


class ShanghaiFormatter(logging.Formatter):
    converter = staticmethod(shanghai_time_tuple)


def setup_logging(log_dir: Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{shanghai_now():%Y%m%d}.log"

    formatter = ShanghaiFormatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    stream_handler = logging.StreamHandler()
    file_handler.setFormatter(formatter)
    stream_handler.setFormatter(formatter)

    logging.basicConfig(
        level=logging.INFO,
        handlers=[
            file_handler,
            stream_handler,
        ],
        force=True,
    )
