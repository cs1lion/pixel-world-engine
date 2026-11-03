"""造物账本的 HTTP 面：追加与按条件查询。

两个端点，一个写一个读：

| 方法 | 路径 | 干什么 |
| --- | --- | --- |
| POST | `/api/creation-ledger/entries` | 追加一条记录；`recordId` 重复时返回旧的那条（`duplicate=true`） |
| GET | `/api/creation-ledger/entries` | 按 `worldId` / `day` / `template` / `reject` 查 |

**写面只追加，不提供改/删。** 账本是审计日志，能通过 HTTP 改历史就等于
没有账本。读面返回原始记录（一行一条），折叠成「每件造物一条」是客户端
`foldLedger()` 的事——服务端不替它决定「哪条 landing 属于哪次 creation」
之外的语义。
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Body, FastAPI, Query, Request
from fastapi.responses import JSONResponse

from creation_ledger.store import (
    GATE_NAMES,
    CreationLedgerError,
    CreationLedgerStore,
)

router = APIRouter()


def _default_root() -> Path:
    raw = os.environ.get("PIXEL_WORLD_CREATION_LEDGER_DIR")
    return Path(raw) if raw else Path(__file__).resolve().parents[2] / "data" / "creation-ledger"


def _store_of(request: Request) -> CreationLedgerStore:
    store = getattr(request.app.state, "creation_ledger", None)
    if store is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.creation_ledger 未装配")
    return store


@router.post("/api/creation-ledger/entries", status_code=201)
def append_entry(
    request: Request,
    payload: dict[str, object] = Body(...),
) -> dict[str, object]:
    store = _store_of(request)
    try:
        outcome = store.append(payload)
    except CreationLedgerError as error:
        return JSONResponse(status_code=422, content={"detail": str(error)})
    return {"record": outcome.record, "duplicate": outcome.duplicate}


@router.get("/api/creation-ledger/entries")
def list_entries(
    request: Request,
    worldId: str = Query(..., description="世界 id；也是账本文件名"),
    day: int | None = Query(None, ge=0, description="世界日；不给就不过滤"),
    template: str | None = Query(None, description="模板 id"),
    reject: str | None = Query(None, description="拒绝原因的门禁名"),
) -> dict[str, object]:
    if reject is not None and reject not in GATE_NAMES:
        return JSONResponse(
            status_code=422,
            content={"detail": f"reject 必须是 {GATE_NAMES} 之一"},
        )
    store = _store_of(request)
    try:
        records = store.read(worldId, day=day, template=template, reject=reject)
    except CreationLedgerError as error:
        return JSONResponse(status_code=422, content={"detail": str(error)})
    return {
        "entries": records,
        "count": len(records),
        "bytes": store.bytes(worldId),
    }


def register_routes(app: FastAPI, root: Path | None = None) -> None:
    """装配账本。- 测试传临时目录，生产走环境变量或 `data/creation-ledger`。"""
    app.state.creation_ledger = CreationLedgerStore(root if root is not None else _default_root())
    app.include_router(router)
