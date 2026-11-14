"""作业牌子端点：只写一句话，失败退回原文案，不碰世界。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from events.api import create_app
from oracle.work_note import MAX_NOTE_CHARS, clean_note


def _app():
    return TestClient(create_app())


def test_没有可用模型时回_200_且_ok_false(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    client = _app()
    resp = client.post("/api/world/work-note", json={"siteName": "炉底入口", "activity": "work", "stock": 2})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["text"] is None


def test_提示词只带调用方给的事实(monkeypatch):
    seen: dict = {}

    def fake(messages):
        seen["messages"] = messages
        return "在炉边添炭"

    app = create_app()
    app.state.model_caller = fake
    client = TestClient(app)
    resp = client.post("/api/world/work-note", json={
        "siteName": "炉底入口", "activity": "work", "stock": 3, "day": 2, "people": ["炉匠", "汐"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "text": "在炉边添炭"}
    user = seen["messages"][-1]["content"]
    assert "炉底入口" in user and "3 份" in user and "第 2 天" in user and "炉匠" in user
    assert "不许编" in seen["messages"][0]["content"]


def test_模型话被收成一句牌子():
    assert clean_note("“在炉边添炭”。") == "在炉边添炭"
    assert clean_note("在炉边\n添炭") == "在炉边 添炭"
    assert clean_note("   ") is None
    long = "在" * 40
    assert len(clean_note(long) or "") == MAX_NOTE_CHARS


def test_模型抛错时回_200_而不是_500():
    def broken(messages):
        from oracle.orchestrator import ModelFailed
        raise ModelFailed("上游挂了")

    app = create_app()
    app.state.model_caller = broken
    resp = TestClient(app).post("/api/world/work-note", json={"siteName": "x"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is False
