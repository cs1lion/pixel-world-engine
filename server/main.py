"""服务端入口：`uvicorn main:app`。

日志落在 `data/events.db`（已在 .gitignore 里）。目录不存在就建——
第一次跑不该因为少一个目录就起不来。
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from events.api import create_app
from events.log import EventLog


def _default_log_path() -> Path:
    raw = os.environ.get("PIXEL_WORLD_EVENT_DB")
    return Path(raw) if raw else Path(__file__).resolve().parent.parent / "data" / "events.db"


def _build() -> FastAPI:
    path = _default_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return create_app(EventLog(str(path)))


app = _build()
