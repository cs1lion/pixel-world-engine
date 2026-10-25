"""事件日志的 HTTP 面。

**只读。** 这条 API 只有 `GET /api/events`，没有 POST/PUT/DELETE。

不是还没写，是刻意不写：日志是世界的事实来源，能通过 HTTP 往里塞事件，
等于把「世界发生过什么」交给了任何能访问端口的人。#5 #6 #7 写日志的方式是
服务端内部调用 `EventLog.append`，不经过网络。

将来真需要一个写入入口（比如玩家操作要落库），那应该是一条**带校验和身份**的
命令端点，由它校验完再调 `append`，而不是把裸的 append 暴露成 HTTP。

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

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import JSONResponse

from events.log import DEFAULT_LIMIT, MAX_LIMIT, EventLog, EventValidationError
from events.world_changes import router as world_changes_router
from events.world_changes import register_error_handler as register_world_change_errors

router = APIRouter()


def _log_of(request: Request) -> EventLog:
    log = getattr(request.app.state, "event_log", None)
    if log is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.event_log 未装配")
    return log


@router.get("/api/events")
def read_events(
    request: Request,
    since: int = Query(0, ge=0, description="排他游标：只返回 id 更大的事件"),
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


def create_app(log: EventLog | None = None) -> FastAPI:
    """装配一个 app。测试传内存库，生产传文件库。"""
    app = FastAPI(title="pixel-world-server", version="0.1.0")
    app.state.event_log = log if log is not None else EventLog()
    app.include_router(router)
    app.include_router(world_changes_router)

    @app.exception_handler(EventValidationError)
    async def _validation_error(_request: Request, exc: EventValidationError) -> JSONResponse:
        # 参数越界说清是哪一条、错在哪，不回一个笼统的 400。
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    register_world_change_errors(app)
    return app
