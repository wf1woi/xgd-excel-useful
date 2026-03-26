from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo


SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


def shanghai_now() -> datetime:
    return datetime.now(SHANGHAI_TZ)


def shanghai_now_naive() -> datetime:
    return shanghai_now().replace(tzinfo=None)


def shanghai_time_tuple(timestamp: float):
    return datetime.fromtimestamp(timestamp, SHANGHAI_TZ).timetuple()
