"""服务端入口：`uvicorn main:app`。

日志落在 `data/events.db`（已在 .gitignore 里）。目录不存在就建——
第一次跑不该因为少一个目录就起不来。

**启动时读一次 `server/.env`。** 这是本地跑模型那条路唯一的配置来源：
不读它，用户就得在起服务的那个终端里 export 一遍 Key，而 Windows 的
`set` 会把 Key 留在命令历史里。读到的只打印**变量名**，不打印值。

`PIXEL_WORLD_EVENT_DB` 可以指到别处——演示/验收用一份隔离的库，
不碰 `data/events.db`。
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from events.api import create_app
from events.log import EventLog
from oracle.env_file import load_env

#: 启动日志里显式提到的变量。其余变量名照常打印，只是不猜它们的用途。
_KNOWN_ENV = ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_TIMEOUT_SECONDS")


def _default_log_path() -> Path:
    raw = os.environ.get("PIXEL_WORLD_EVENT_DB")
    return Path(raw) if raw else Path(__file__).resolve().parent.parent / "data" / "events.db"


def _log_config(loaded: list[str], path: Path) -> None:
    """把「从哪儿配的」打出来，**不许打值**。

    Windows 控制台默认 GBK，而这几行里有中文。不切成 UTF-8，`print` 会在
    Windows 上抛 `UnicodeEncodeError`——服务起不来，报的却是一个跟配置
    毫无关系的编码错误。与 `scripts/intent_experiment.py` 同一个兜底。
    """
    import sys

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    print(f"[pixel-world] 事件库：{path}", file=sys.stderr)
    if loaded:
        print(f"[pixel-world] 从 server/.env 读到：{', '.join(loaded)}", file=sys.stderr)
    else:
        print("[pixel-world] 没有 server/.env（或该读的变量都已由环境给出）", file=sys.stderr)
    missing = [name for name in _KNOWN_ENV if not os.environ.get(name)]
    if "LLM_API_KEY" in missing:
        # 缺 Key 不是崩溃：世界照常跑，只是 `/api/world/intent` 会回 503。
        print(
            "[pixel-world] 没配 LLM_API_KEY：意图端点会回 503，世界仍可离线运行",
            file=sys.stderr,
        )


def _build() -> FastAPI:
    loaded = load_env()
    path = _default_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _log_config(loaded, path)
    return create_app(EventLog(str(path)))


app = _build()
