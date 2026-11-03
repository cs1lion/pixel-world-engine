"""造物账本的只增文件与查询端点。

钉住四件事：

1. 一行一条、只追加；`recordId` 重复不写第二条（重试不重复）。
2. 重启后账本还在，`seq` 接着数、`recordedAt` 不倒退。
3. 按世界日 / 模板 / 拒绝原因查询，返回原始记录。
4. 形状不对的载荷回 422，而不是静默收进账本。
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from creation_ledger.store import CreationLedgerError, CreationLedgerStore
from events.api import create_app
from events.log import EventLog


def _gate(name: str, phase: str, passed: bool, observed: object, threshold: str) -> dict:
    return {
        "name": name,
        "phase": phase,
        "observed": observed,
        "threshold": threshold,
        "passed": passed,
        "reason": "pass" if passed else "below_requirement",
    }


def _replay(day: int, fingerprint: str = "deadbeef") -> dict:
    return {
        "seed": "dengchao",
        "eventFrom": 0,
        "eventTo": 0,
        "dayFrom": day,
        "dayTo": day,
        "fingerprint": fingerprint,
    }


def _ladder() -> dict:
    return {
        "level": 3,
        "levelName": "L3",
        "targetLevel": 3,
        "isFused": False,
        "action": "allow",
        "reason": "未抽中，自动放行",
        "metrics": {"schemaPassRate": 1.0, "coverageRate": 1.0},
    }


def _creation(
    *,
    record_id: str = "dengchao:waiting_shelter#7",
    day: int = 3,
    template: str = "waiting_shelter",
    rejection_gate: str | None = None,
    verdict: str = "accepted",
) -> dict:
    rejection = None
    if rejection_gate is not None:
        rejection = {
            "gate": rejection_gate,
            "observed": 0.5,
            "threshold": ">= 0.95",
            "kind": "below_requirement",
            "detail": "已落地 1/2 种，本提案补 1 种 → 2/2 不该是 0.5（测试夹具）",
        }
    return {
        "kind": "creation",
        "ledgerVersion": 1,
        "recordId": record_id,
        "worldId": "dengchao",
        "seed": "dengchao",
        "day": day,
        "at": day * 24 * 60 * 60 * 1000,
        "templateId": template,
        "templateName": "候车亭",
        "templateKind": "industry",
        "intentText": None,
        "target": {"x": 40, "y": 30},
        "origin": "auto",
        "gates": [
            _gate("schema", "proposal", True, True, "= true"),
            _gate("placement", "proposal", True, True, "= true"),
            _gate("coverage", "proposal", rejection_gate is None, 1.0, ">= 0.95"),
        ],
        "ladder": _ladder(),
        "verdict": verdict,
        "rejection": rejection,
        "rejectionGate": rejection_gate,
        "overrides": [],
        "replay": _replay(day),
        "landing": None,
    }


def _landing(proposal_id: str, *, day: int = 3) -> dict:
    return {
        "kind": "landing",
        "ledgerVersion": 1,
        "recordId": f"{proposal_id}:landing",
        "proposalId": proposal_id,
        "worldId": "dengchao",
        "seed": "dengchao",
        "day": day,
        "at": day * 24 * 60 * 60 * 1000 + 16,
        "templateId": "waiting_shelter",
        "landed": True,
        "buildingId": proposal_id,
        "origin": {"x": 40, "y": 30},
        "door": {"x": 42, "y": 32},
        "gates": [
            _gate("pathfinding", "landing", True, True, "= true"),
            _gate("replay", "landing", True, True, "= true"),
        ],
        "replay": _replay(day, "cafebabe"),
        "failure": None,
    }


def _observation(proposal_id: str, *, day: int = 10) -> dict:
    return {
        "kind": "observation",
        "ledgerVersion": 1,
        "recordId": f"{proposal_id}:observation:{day}",
        "proposalId": proposal_id,
        "worldId": "dengchao",
        "day": day,
        "at": day * 24 * 60 * 60 * 1000,
        "dueDay": day,
        "buildingId": proposal_id,
        "status": "still_present",
        "detail": "仍立在 (40,30)",
    }


@pytest.fixture()
def store(tmp_path: Path) -> CreationLedgerStore:
    return CreationLedgerStore(tmp_path / "creation-ledger")


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(
        create_app(EventLog(), tmp_path / "memory", tmp_path / "creation-ledger")
    ) as test_client:
        yield test_client


# --------------------------------------------------------------- 只增与去重


def test_追加一条后读回来逐字段相同(store: CreationLedgerStore) -> None:
    record = _creation()
    outcome = store.append(record)
    assert outcome.duplicate is False
    assert outcome.record["seq"] == 1
    assert outcome.record["recordId"] == record["recordId"]
    assert store.read("dengchao") == [outcome.record]


def test_同一个_recordId_重试不写第二条(store: CreationLedgerStore) -> None:
    first = store.append(_creation())
    second = store.append(_creation())
    assert second.duplicate is True
    assert second.record["seq"] == first.record["seq"]
    assert store.count("dengchao") == 1
    assert store.bytes("dengchao") > 0


def test_三类记录按_seq_升序返回(store: CreationLedgerStore) -> None:
    creation = _creation()
    store.append(creation)
    store.append(_landing(creation["recordId"]))
    store.append(_observation(creation["recordId"]))
    records = store.read("dengchao")
    assert [item["kind"] for item in records] == ["creation", "landing", "observation"]
    assert [item["seq"] for item in records] == [1, 2, 3]


def test_文件里没有_update_delete_之类的入口(store: CreationLedgerStore) -> None:
    for forbidden in ("update", "delete", "remove", "rewrite", "set"):
        assert not hasattr(store, forbidden), f"账本不该有 {forbidden}"


# --------------------------------------------------------------- 重启


def test_重启后账本还在_序号接着数_时间不倒退(tmp_path: Path) -> None:
    path = tmp_path / "creation-ledger"
    clock = iter(
        [
            datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 3, 12, 0, 1, tzinfo=timezone.utc),
        ]
    )

    first = CreationLedgerStore(path, clock=lambda: next(clock))
    first.append(_creation(record_id="dengchao:shelter#1"))
    before = first.read("dengchao")

    # 新实例 = 进程重启：从文件里重新加载，不继承内存。
    second = CreationLedgerStore(path)
    after = second.read("dengchao")
    assert after == before

    outcome = second.append(_creation(record_id="dengchao:shelter#2", day=4))
    assert outcome.record["seq"] == 2
    assert outcome.record["recordedAt"] >= after[-1]["recordedAt"]


def test_重启后_recordId_去重仍然有效(tmp_path: Path) -> None:
    path = tmp_path / "creation-ledger"
    first = CreationLedgerStore(path)
    first.append(_creation(record_id="same-id"))
    second = CreationLedgerStore(path)
    outcome = second.append(_creation(record_id="same-id"))
    assert outcome.duplicate is True
    assert second.count("dengchao") == 1


# --------------------------------------------------------------- 查询


def test_按模板查询把同一次造物的落地与观测一并带回(store: CreationLedgerStore) -> None:
    creation = _creation()
    store.append(creation)
    store.append(_landing(creation["recordId"]))
    store.append(_observation(creation["recordId"]))
    records = store.read("dengchao", template="waiting_shelter")
    assert [item["kind"] for item in records] == ["creation", "landing", "observation"]


def test_按世界日_模板_拒绝原因查询(store: CreationLedgerStore) -> None:
    store.append(_creation(record_id="d3-a", day=3))
    store.append(_creation(record_id="d4-a", day=4))
    store.append(
        _creation(
            record_id="d4-rejected",
            day=4,
            rejection_gate="coverage",
            verdict="rejected",
        )
    )
    store.append(_creation(record_id="d5-other", day=5, template="ink_house"))

    assert [item["recordId"] for item in store.read("dengchao", day=4)] == [
        "d4-a",
        "d4-rejected",
    ]
    assert [item["recordId"] for item in store.read("dengchao", template="ink_house")] == [
        "d5-other"
    ]
    assert [item["recordId"] for item in store.read("dengchao", reject="coverage")] == [
        "d4-rejected"
    ]


def test_api_追加与查询(client: TestClient) -> None:
    record = _creation()
    response = client.post("/api/creation-ledger/entries", json=record)
    assert response.status_code == 201
    body = response.json()
    assert body["duplicate"] is False
    assert body["record"]["seq"] == 1

    listed = client.get("/api/creation-ledger/entries", params={"worldId": "dengchao", "day": 3})
    assert listed.status_code == 200
    payload = listed.json()
    assert payload["count"] == 1
    assert payload["entries"][0]["recordId"] == record["recordId"]
    assert payload["bytes"] > 0


def test_api_拒绝原因查询只回那一类(client: TestClient) -> None:
    client.post("/api/creation-ledger/entries", json=_creation(record_id="ok"))
    client.post(
        "/api/creation-ledger/entries",
        json=_creation(
            record_id="bad", rejection_gate="coverage", verdict="rejected"
        ),
    )
    listed = client.get(
        "/api/creation-ledger/entries",
        params={"worldId": "dengchao", "reject": "coverage"},
    )
    assert listed.status_code == 200
    assert [item["recordId"] for item in listed.json()["entries"]] == ["bad"]


# --------------------------------------------------------------- 校验


@pytest.mark.parametrize(
    "mutate",
    [
        lambda record: record.pop("recordId"),
        lambda record: record.update({"worldId": "../escape"}),
        lambda record: record.update({"kind": "mystery"}),
        lambda record: record.update({"ledgerVersion": 99}),
        lambda record: record.update({"seq": 1}),
        lambda record: record.update({"gates": []}),
        lambda record: record.update({"landing": {"x": 1}}),
        lambda record: record.update({"rejectionGate": "unknown"}),
    ],
)
def test_形状不对的记录被拒(store: CreationLedgerStore, mutate) -> None:
    record = _creation()
    mutate(record)
    with pytest.raises(CreationLedgerError):
        store.append(record)
    assert store.count("dengchao") == 0


def test_api_形状不对回_422(client: TestClient) -> None:
    record = _creation()
    record.pop("recordId")
    response = client.post("/api/creation-ledger/entries", json=record)
    assert response.status_code == 422
    assert "recordId" in response.json()["detail"]


def test_api_查询不认识的拒绝原因回_422(client: TestClient) -> None:
    response = client.get(
        "/api/creation-ledger/entries",
        params={"worldId": "dengchao", "reject": "not-a-gate"},
    )
    assert response.status_code == 422
