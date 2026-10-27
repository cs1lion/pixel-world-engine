"""事件日志的 HTTP 面。

**这条 API 自己只读：只有 `GET /api/events`，没有 POST/PUT/DELETE。**

不是还没写，是刻意不写：日志是世界的事实来源，能通过 HTTP 往里塞事件，
等于把「世界发生过什么」交给了任何能访问端口的人。#5 #6 #7 写日志的方式是
服务端内部调用 `EventLog.append`，不经过网络。

**2026-10-28 补记：这个「将来」已经到了，而且挂在同一个 `create_app` 里。**
下面第 94-95 行，`app.include_router(router)` 之后紧挨着
`app.include_router(world_changes_router)`——`POST /api/world/changes`
正是这里描述的那种「带校验和身份的命令端点」：它校验完再调 `EventLog.append`，
回 201。`events/world_changes.py` 的 docstring 把它称作「只开这一个口子」。
所以「没有 POST」作为**事件日志 HTTP 面**的整体描述已经失实；准确的说法是
**读面只读，写面是另一条带校验的端点**，两者在同一个 app 上并存。
上面那段「将来真需要……」因此从预测改成了对已存在之物的说明。

响应形状与 `world-client/src/world/events-client.ts` 的解析对齐：

    {
      "events": [{id, at, kind, actor, payload}, ...],
      "latestId": 42,
      "hasMore": false
    }

`hasMore` 让客户端知道「这次没读满是因为到头了，还是因为 limit 卡住了」。
没有它，客户端要么多问一次空响应，要么把 limit 当成了真实终点。
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import JSONResponse

from events.log import DEFAULT_LIMIT, MAX_LIMIT, EventLog, EventValidationError
from events.world_changes import router as world_changes_router
from events.world_changes import register_error_handler as register_world_change_errors
from memory.api import register_memory_routes
from memory.writer import MemoryWriter
from oracle.api import register_routes as register_oracle_routes

#: 游标 `since` 的上限。SQLite 的 INTEGER 是 64 位有符号，超过它的数绑不进去，
#: `sqlite3` 抛的是 OverflowError——不是 EventValidationError，于是 `ge=0` 放行的
#: 一个巨大游标把读接口打成 500。给它一个上限，越界就落到 422 那句话上。
#:
#: 不 clamp 而是拒：把一个巨大游标悄悄夹成上限，客户端会以为「后面没有了」，
#: 而它问的是「第 N 条之后」。那是用静默修正换一个好看的 200。
MAX_SINCE = 2**63 - 1

router = APIRouter()


def _default_memory_root() -> Path:
    raw = os.environ.get("PIXEL_WORLD_MEMORY_DIR")
    return Path(raw) if raw else Path(__file__).resolve().parents[2] / "memory"


def _log_of(request: Request) -> EventLog:
    log = getattr(request.app.state, "event_log", None)
    if log is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.event_log 未装配")
    return log


@router.get("/api/events")
def read_events(
    request: Request,
    since: int = Query(
        0,
        ge=0,
        le=MAX_SINCE,
        description=f"排他游标：只返回 id 更大的事件（不超过 {MAX_SINCE}）",
    ),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, object]:
    log = _log_of(request)
    events = log.read(since=since, limit=limit)
    latest = log.latest_id()
    return {
        "events": [event.to_json() for event in events],
        # latestId 是**整个日志**的最大 id，不是这一页的最大 id。
        # 客户端拿它判断追平没有：since >= latestId 就是追平了。
        "latestId": latest,
        "hasMore": bool(events) and events[-1].id < latest,
    }


def create_app(
    log: EventLog | None = None, memory_root: Path | None = None
) -> FastAPI:
    """装配一个 app。测试传内存库与临时记忆目录，生产传文件库。"""
    app = FastAPI(title="pixel-world-server", version="0.1.0")
    event_log = log if log is not None else EventLog()
    app.state.event_log = event_log
    # 记忆与事件日志共享同一个 log：证据链拿它核对，每日快照从它派生。
    app.state.memory_writer = MemoryWriter(memory_root or _default_memory_root(), event_log)
    app.include_router(router)
    app.include_router(world_changes_router)
    # 意图解析与事件日志互不依赖：解析失败不该影响世界读日志，反之亦然。
    register_oracle_routes(app)
    register_memory_routes(app)

    @app.exception_handler(EventValidationError)
    async def _validation_error(_request: Request, exc: EventValidationError) -> JSONResponse:
        # 参数越界说清是哪一条、错在哪，不回一个笼统的 400。
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    register_world_change_errors(app)
    return app
