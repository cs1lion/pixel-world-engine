"""villager_decision 端点的测试：LLM 的决策被正确收成结构化结果。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from events.api import create_app


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setenv("PWE_LLM_PROVIDER", "fake")
    monkeypatch.setenv("PWE_LLM_MODEL", "fake-model")
    app = create_app()
    return TestClient(app)


def _register_caller(client: TestClient, reply: str) -> None:
    """注入假 caller，返回固定字符串。"""
    from oracle.orchestrator import ModelCaller

    def fake_caller(messages):
        return reply

    client.app.state.model_caller = fake_caller  # type: ignore[attr-defined]


def test_follow_action_parses(client: TestClient) -> None:
    _register_caller(
        client,
        '{"action": "follow", "reason": "没什么特别的"}',
    )
    r = client.post("/api/world/villager-decision", json={
        "villagerName": "炉匠",
        "routineLabel": "锅炉房搬炭",
        "day": 3,
        "memories": [{"text": "昨天集市缺货", "day": 2}],
        "availableSites": [{"siteId": "market", "siteName": "集市", "activities": ["trade"]}],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["action"] == "follow"
    assert body["reason"] == "没什么特别的"


def test_deviate_action_parses(client: TestClient) -> None:
    _register_caller(
        client,
        '{"action": "deviate", "siteId": "market", "activityId": "trade", "reason": "记得昨天集市缺货"}',
    )
    r = client.post("/api/world/villager-decision", json={
        "villagerName": "炉匠",
        "routineLabel": "锅炉房搬炭",
        "day": 3,
        "memories": [{"text": "昨天集市缺货", "day": 2}],
        "availableSites": [{"siteId": "market", "siteName": "集市", "activities": ["trade"]}],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["action"] == "deviate"
    assert body["siteId"] == "market"
    assert body["activityId"] == "trade"
    assert body["reason"] == "记得昨天集市缺货"


def test_json_fence_stripped(client: TestClient) -> None:
    _register_caller(
        client,
        '```json\n{"action": "follow"}\n```',
    )
    r = client.post("/api/world/villager-decision", json={
        "villagerName": "炉匠",
        "routineLabel": "锅炉房搬炭",
        "day": 1,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["action"] == "follow"


def test_invalid_json_returns_not_ok(client: TestClient) -> None:
    _register_caller(client, "not json at all")
    r = client.post("/api/world/villager-decision", json={"villagerName": "炉匠"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False


def test_invalid_action_returns_not_ok(client: TestClient) -> None:
    _register_caller(client, '{"action": "run_away"}')
    r = client.post("/api/world/villager-decision", json={"villagerName": "炉匠"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False


def test_deviate_without_required_fields(client: TestClient) -> None:
    _register_caller(client, '{"action": "deviate", "reason": "想去看看"}')
    r = client.post("/api/world/villager-decision", json={"villagerName": "炉匠"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False


def test_model_unavailable_returns_not_ok(client: TestClient, monkeypatch) -> None:
    from oracle.orchestrator import ModelUnavailable

    def failing_caller(messages):
        raise ModelUnavailable("no key")

    client.app.state.model_caller = failing_caller  # type: ignore[attr-defined]
    r = client.post("/api/world/villager-decision", json={"villagerName": "炉匠"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "no key" in body["reason"]
