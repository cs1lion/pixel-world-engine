"""记忆的 HTTP 面：`POST /api/memory/write`、`GET /api/memory/list`、
`GET /api/memory/entry`、`POST /api/memory/snapshot`。

**写入端点收的是「已经观测到的事」，不是「想让世界记住的话」。** 所以它不做
任何生成：body 给什么就写什么，一个字都不添。模型当然可以参与——它转述观测，
而转述的结果由调用方作为 `body` 传进来，`source` 仍然是 `direct_observation`。
这条边界在这里由 `check_source` 执行，不在文档里。

三种状态码，和 `/api/world/intent` 同一套纪律：

| 状态 | 含义 | 用户能做什么 |
|---|---|---|
| 422 | 请求不合法：缺 source、source 是 llm_generation、证据查不到 | 补上依据 |
| 201 | 写成了（`POST /api/memory/write`） | 看文件 |
| 200 | 读到了（`GET` 那三个端点） | 看文件 |

不设 503：记忆不依赖模型，没有 Key 也照常写。这与意图端点正好相反——
那条路没有模型就什么都做不了。

2026-10-28 补记：上一段原来写「三种失败，三种状态码」，而它下面的表里只有
两行。第三种失败是真的——`SnapshotError`（`snapshot` 端点里 `day` 校验那几处
抛的）——但它既不在这张表里，也不在「三种」之内。同一句套话写在
`oracle/api.py` 上名副其实（那边表格三行），搬到这里就名不副实。
现在按表写「两种」。`SnapshotError` 的归属另记一句：它是**调用方传进来的
`day` 不对**——不是正整数，或者大到最后那个文件名放不下（见 `snapshot_memory`
里 2026-10-28 那段）——与 422 同类，不是第三种状态码。

2026-10-28 补记二：上一则补记把「三种」改成「两种」，改法是**让句子去迁就表**——
可表自己少了一行。`POST /api/memory/write` 声明的是 `status_code=201`，
`test_memory_api.py` 断言的也正是 201；GET 那三个端点是 200；422 是请求不合法。
所以本来就是**三种**，上一则补记改完反而离真话远了一格：它修的是「句子与表
不一致」，而病根是表漏了 201。现在表补上这一行，句子照表改回「三种」。
（顺带：上一则补记说 `oracle/api.py`「那边表格三行」——那句今天仍成立，
但那是它自己对，不是这里可以照抄的理由。）
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

#: 文件系统单个路径组件最长 255 字节（ext4 / APFS / NTFS 都是这个数）。
#: `day` 最后要变成一个文件名，所以它不是一个可以任意大的整数——见下面
#: `snapshot_memory` 里 2026-10-28 那段补记。
_FILENAME_MAX_BYTES = 255


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
        # 2026-10-28 补记：上面那道 `isinstance(day, int)` 收的是**任意精度**整数，
        # 而 `day` 的归宿是一个文件名（`paths.py` 的 `entry_path` 拼
        # `day-{day:04d}.md`）。10**250 堂堂正正过得了类型检查，落盘时文件名
        # 258 字节，撞上文件系统单组件 255 字节那面墙，抛出来的是 `OSError`——
        # 既不是 `SnapshotError` 也不是 `MemoryPathError`，两端点四个 422 handler
        # 一个都接不住，于是回 500。而本文件开头那张表冻住的失败面只有 422 / 200。
        # **同一种病本仓已经治过四次**：`events/log.py::_check_at`、
        # `events/world_changes.py`、`rules/schema.py::_number`、
        # `memory/__init__.py::_check_at`，后两处还各有一道测试钉着 10**400 → 422
        # （grep `10**400`）。`day` 是第五个入口，也是唯一没写的那一个。
        # 所以这里自己收口：**文件名放不下就是调用方写错了，不是服务端的错。**
        if len(f"day-{day:04d}.md") > _FILENAME_MAX_BYTES:
            raise SnapshotError(
                f"day 太大，拼不出文件名：{day}。世界日序号是给文件起名用的，"
                f"没有那么大的世界"
            )

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
