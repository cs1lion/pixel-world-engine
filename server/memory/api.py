"""记忆的 HTTP 面：`POST /api/memory/write`、`GET /api/memory/list`、
`GET /api/memory/entry`、`POST /api/memory/snapshot`。

**写入端点收的是「已经观测到的事」，不是「想让世界记住的话」。** 所以它不做
任何生成：body 给什么就写什么，一个字都不添。模型当然可以参与——它转述观测，
而转述的结果由调用方作为 `body` 传进来，`source` 仍然是 `direct_observation`。
这条边界在这里由 `check_source` 执行，不在文档里。

三种失败，三种状态码，和 `/api/world/intent` 同一套纪律：

| 状态 | 含义 | 用户能做什么 |
|---|---|---|
| 422 | 请求不合法：缺 source、source 是 llm_generation、证据查不到 | 补上依据 |
| 200 | 写成了 | 看文件 |

不设 503：记忆不依赖模型，没有 Key 也照常写。这与意图端点正好相反——
那条路没有模型就什么都做不了。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from memory.evidence import EvidenceError
from memory.paths import MemoryLayout, MemoryPathError
from memory.snapshot import SnapshotError, day_of, days_present, write_snapshot, write_snapshots
from memory.writer import MemoryWriter

from memory import MemoryDraft, MemoryWriteError  # noqa: E402

router = APIRouter()


def _layout_of(request: Request) -> MemoryLayout:
    """记忆目录布局。

    装配处（`events.api.create_app`）先把 `MemoryWriter` 放进 app.state，
    这里从它身上取布局——不自己再建一个。两个 layout 会指向同一个目录，
    但那是两份真相，将来其中一个改了默认值就会悄悄分叉。
    """
    writer = getattr(request.app.state, "memory_writer", None)
    if writer is not None:
        return writer.layout
    layout = getattr(request.app.state, "memory_layout", None)
    if layout is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.memory_writer 未装配")
    return layout


def _writer_of(request: Request) -> MemoryWriter:
    writer = getattr(request.app.state, "memory_writer", None)
    if writer is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.memory_writer 未装配")
    return writer


def _draft_from(body: Any) -> MemoryDraft:
    """把请求体变成 `MemoryDraft`。

    形状错与铁律错**分开报**：这里只管「字段在不在、类型对不对」，
    `source` 与 `evidence` 交给铁律那一层说——它说的话更具体
    （「缺 source」比「缺字段 source」更说得出该补什么）。
    """
    if not isinstance(body, dict):
        raise MemoryWriteError("请求体必须是 JSON 对象")
    for field in ("kind", "title", "body", "at"):
        if field not in body:
            raise MemoryWriteError(f"缺字段 {field}")
    return MemoryDraft(
        kind=body["kind"],
        title=body["title"],
        body=body["body"],
        source=body.get("source"),
        evidence=body.get("evidence", ()),
        at=body["at"],
        subject=body.get("subject"),
    )


@router.post("/api/memory/write", status_code=201)
def write_memory(request: Request, body: Any = Body(...)) -> dict[str, object]:
    writer = _writer_of(request)
    written = writer.write(_draft_from(body))
    return written.to_json()


@router.get("/api/memory/list")
def list_memory(request: Request) -> dict[str, object]:
    writer = _writer_of(request)
    entries = writer.list_entries()
    return {"entries": entries, "count": len(entries)}


@router.get("/api/memory/entry")
def read_memory(
    request: Request,
    path: str | None = None,
    section: str | None = None,
    at: float | None = None,
) -> dict[str, object]:
    """读一份记忆的全文。

    票据 #7 的验收是「我能读到这座镇子过去发生过什么，像读一本编年史」——
    只有标题和一行摘要是目录，不是编年史。所以读面必须给全文。

    `section` 可省。列表里的一行是**一条**记忆，而一份角色档案里躺着好几条；
    不带上小节名，点开「她记得那场雨」会读到她的整个档案——那倒不是错，
    但列表答应的是那一条。带上就只要那一节（连同她的人名标题）。

    `at` 是 `section` 的消歧，可省。同一个人对同一件事的两次观测会有两个
    同名小节，列表里那是两行（只有 `at` 不同）。客户端把行上的 `at` 原样带回，
    服务端据此只回那一条；不带而又有多个同名小节时服务端答 422 说明要带，
    而不是悄悄返回第一条。

    `path` 故意不收在 URL 路径里（`/api/memory/entry/characters/莞尔.md`）：
    那样 FastAPI 会先把斜杠解开，`%2F` 与真正的斜杠在不同版本下行为不一致，
    而这里要的只是一个标识符。查询参数没有这层歧义。
    """
    writer = _writer_of(request)
    return writer.read_entry(path, section, at)


@router.post("/api/memory/snapshot")
def snapshot_memory(request: Request, body: Any = Body(default=None)) -> dict[str, object]:
    """重新生成每日快照。不给 `day` 就把日志里出现过的每一天都重一遍。

    这是唯一会覆盖文件的端点，而它覆盖的只有**自己派生的内容**——
    逐条记忆在 `events/` 与 `characters/`，两条路不相交。
    """
    layout = _layout_of(request)
    log = getattr(request.app.state, "event_log", None)
    if log is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.event_log 未装配")

    day: int | None = None
    if body:
        # 空对象 `{}` 与省略 body 同义：把日志里出现过的每一天都重一遍。
        # 不这么做的话，客户端为了「全部重生成」得先 GET 一次有哪些天——
        # 多一次往返，还多一处可能对不上的地方。
        if not isinstance(body, dict) or "day" not in body:
            raise SnapshotError("请求体要么是空，要么是 {\"day\": 序号}")
        day = body["day"]
        if isinstance(day, bool) or not isinstance(day, int) or day < 0:
            raise SnapshotError(f"day 必须是非负整数，收到 {day!r}")

    days = [day] if day is not None else days_present(log)
    # 「全部重生成」走单次翻页的那条路：三十天不该翻三十遍全量日志。
    if day is not None:
        results = [write_snapshot(layout, log, day).to_json()]
    else:
        results = [item.to_json() for item in write_snapshots(layout, log, days)]
    written = sum(1 for item in results if item["written"])
    return {
        "days": results,
        "written": written,
        "unchanged": len(results) - written,
    }


def register_routes(app) -> None:
    """把记忆面挂到 app 上。

    布局从已经装配好的 `MemoryWriter` 身上取（见 `_layout_of`），
    所以这个函数只负责挂路由与错误处理——装配由 `create_app` 做主。
    """
    app.include_router(router)

    @app.exception_handler(MemoryWriteError)
    async def _write_error(_request: Request, exc: MemoryWriteError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(MemoryPathError)
    async def _path_error(_request: Request, exc: MemoryPathError) -> JSONResponse:
        # 标题不能当文件名是**请求**的问题，不是服务端坏了。
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(EvidenceError)
    async def _evidence_error(_request: Request, exc: EvidenceError) -> JSONResponse:
        # 证据查不到也是**请求**的问题：它引用了一件没发生过的事。
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(SnapshotError)
    async def _snapshot_error(_request: Request, exc: SnapshotError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})


__all__ = ["register_memory_routes", "register_routes", "router"]

#: 装配处按 `register_<模块>_routes` 的名字导入（与 `register_oracle_routes`
#: 一致），所以这里给一个同义名。两件事一个函数，不让它俩有机会分叉。
register_memory_routes = register_routes
