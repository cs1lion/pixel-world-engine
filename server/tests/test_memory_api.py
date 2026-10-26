"""记忆的 HTTP 面。

覆盖票据 #7 的验收条件：写入一条带证据的记忆、不带 source 被拒、
声称 llm_generation 被拒、`GET /api/memory/list` 列出条目与摘要、
每日快照能重新生成。另外钉住 422 与「不猜」——形状错和铁律错分开报。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from events.api import create_app
from events.log import EventLog


@pytest.fixture
def log():
    return make_log()


def make_log() -> EventLog:
    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload={"change": "building.built", "instanceId": "wave_house#1", "prefabId": "wave_house", "displayName": "叠浪楼", "summary": "为抄书斋那条活而建"}, at=1_000)
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=2_000)
    return log


@pytest.fixture
def client(tmp_path, log):
    return TestClient(create_app(log, tmp_path / "memory"))


def body(**over):
    base = {
        "kind": "event",
        "title": "渡口的第一夜",
        "body": "我在旧站牌下点了一盏灯。",
        "source": "direct_observation",
        "evidence": [1],
        "at": 1500,
    }
    base.update(over)
    return base


# ------------------------------------------------------------------ 写


def test_写入一条带证据的记忆(client, tmp_path):
    response = client.post("/api/memory/write", json=body())
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["path"] == "events/E0001-渡口的第一夜.md"
    assert payload["evidence"] == [1]
    assert (tmp_path / "memory" / payload["path"]).is_file()


def test_不带_source_的写入被拒(client):
    item = body()
    del item["source"]
    response = client.post("/api/memory/write", json=item)
    assert response.status_code == 422
    assert "缺 source" in response.json()["detail"]


def test_声称_llm_generation_的写入被拒(client):
    response = client.post("/api/memory/write", json=body(source="llm_generation"))
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "llm_generation" in detail
    assert "不能写入记忆" in detail


def test_证据查不到被拒(client):
    response = client.post("/api/memory/write", json=body(evidence=[99]))
    assert response.status_code == 422
    assert "不存在" in response.json()["detail"]


def test_缺字段报的是缺哪一个(client):
    item = body()
    del item["body"]
    response = client.post("/api/memory/write", json=item)
    assert response.status_code == 422
    assert "缺字段 body" in response.json()["detail"]


def test_标题不能当文件名被拒(client):
    response = client.post("/api/memory/write", json=body(title="con"))
    assert response.status_code == 422
    assert "保留名" in response.json()["detail"]


def test_同一个角色的记忆走同一个文件(client, tmp_path):
    first = client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔"),
    ).json()
    second = client.post(
        "/api/memory/write",
        json=body(kind="character", title="她也记得那场雨", subject="莞尔", body="她把伞留在了渡口。", evidence=[2]),
    ).json()
    assert first["path"] == second["path"] == "characters/莞尔.md"
    assert first["appended"] is False
    assert second["appended"] is True


def test_character_记忆缺_subject_被拒(client):
    response = client.post("/api/memory/write", json=body(kind="character", title="她记得我点了灯"))
    assert response.status_code == 422
    assert "必须带 subject" in response.json()["detail"]


# ------------------------------------------------------------------ 列


def test_列出条目与摘要(client):
    client.post("/api/memory/write", json=body())
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔"),
    )
    response = client.get("/api/memory/list")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    paths = {entry["path"] for entry in payload["entries"]}
    assert paths == {"events/E0001-渡口的第一夜.md", "characters/莞尔.md"}
    by_path = {entry["path"]: entry for entry in payload["entries"]}
    # 摘要取这一条记忆的正文第一句，不是文件头那段给读的人的说明。
    assert by_path["characters/莞尔.md"]["summary"] == "我在旧站牌下点了一盏灯。"
    assert by_path["events/E0001-渡口的第一夜.md"]["title"] == "渡口的第一夜"
    for entry in payload["entries"]:
        assert entry["summary"], entry


def test_空记忆目录也回得动(client):
    response = client.get("/api/memory/list")
    assert response.status_code == 200
    assert response.json() == {"entries": [], "count": 0}


# ------------------------------------------------------------------ 快照


def test_重新生成每日快照(client, tmp_path):
    response = client.post("/api/memory/snapshot", json={})
    assert response.status_code == 200, response.text
    payload = response.json()
    # 这份日志里的事件都在第 0 个世界日，所以只该有一天。
    assert payload["written"] == 1
    assert payload["unchanged"] == 0
    assert (tmp_path / "memory" / "entries" / "day-0000.md").is_file()


def test_快照不重复落档(client, tmp_path):
    client.post("/api/memory/snapshot", json={})
    before = (tmp_path / "memory" / "entries" / "day-0000.md").read_bytes()
    response = client.post("/api/memory/snapshot", json={})
    assert response.json()["written"] == 0
    assert response.json()["unchanged"] == 1
    assert (tmp_path / "memory" / "entries" / "day-0000.md").read_bytes() == before


def test_省略请求体与空对象同义(client, tmp_path):
    """客户端为了「全部重生成」不该再多问一次有哪些天。"""
    assert client.post("/api/memory/snapshot").status_code == 200
    assert client.post("/api/memory/snapshot", json={}).status_code == 200
    assert (tmp_path / "memory" / "entries" / "day-0000.md").is_file()


def test_只重某一天(client, tmp_path):
    response = client.post("/api/memory/snapshot", json={"day": 1})
    assert response.status_code == 200
    assert response.json()["written"] == 1
    assert not (tmp_path / "memory" / "entries" / "day-0000.md").exists()


def test_快照的_day_非法被拒(client):
    response = client.post("/api/memory/snapshot", json={"day": -1})
    assert response.status_code == 422


def test_记忆端点不依赖模型(client):
    """没有 Key 也照常写——这与意图端点正好相反，那条路没有模型就什么都做不了。"""
    assert client.post("/api/memory/write", json=body()).status_code == 201


def test_事件日志端点没被记忆面影响(client):
    """记忆是后挂上去的，不该改动既有的只读日志面。"""
    response = client.get("/api/events")
    assert response.status_code == 200
    assert response.json()["latestId"] == 2
