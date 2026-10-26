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


# ------------------------------------------------------------------ 读单条


def test_读一份记忆的全文(client):
    """票据 #7 要「像读一本编年史」——只有标题和一行摘要是目录，不是书。"""
    client.post("/api/memory/write", json=body())
    response = client.get("/api/memory/entry", params={"path": "events/E0001-渡口的第一夜.md"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["kind"] == "event"
    assert payload["title"] == "渡口的第一夜"
    assert "我在旧站牌下点了一盏灯。" in payload["text"]
    assert "依据：#1" in payload["text"]


def test_读每日快照(client, tmp_path):
    client.post("/api/memory/snapshot", json={})
    response = client.get("/api/memory/entry", params={"path": "entries/day-0000.md"})
    assert response.status_code == 200
    payload = response.json()
    # 快照不是谁写的记忆，它是日志派生的——编年史里要能看出这个分别。
    assert payload["kind"] == "day"
    assert payload["text"] == (tmp_path / "memory" / "entries" / "day-0000.md").read_text(
        encoding="utf-8"
    )


def test_读角色档案(client):
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔"),
    )
    payload = client.get("/api/memory/entry", params={"path": "characters/莞尔.md"}).json()
    assert payload["kind"] == "character"
    assert payload["title"] == "莞尔"
    assert "## 她记得我点了灯" in payload["text"]


def test_读不存在的记忆被拒(client):
    response = client.get("/api/memory/entry", params={"path": "events/E9999-没写过.md"})
    assert response.status_code == 422
    assert "没有这份记忆" in response.json()["detail"]


def test_缺_path_被拒(client):
    response = client.get("/api/memory/entry")
    assert response.status_code == 422
    assert "缺 path" in response.json()["detail"]


@pytest.mark.parametrize(
    "path",
    [
        "../index.yaml",
        "../../server/requirements.txt",
        "../../.git/config",
        "index.yaml",
        "/etc/passwd",
        "C:/Windows/win.ini",
        "rules/铁律.yaml",
    ],
)
def test_读面不许碰_memory_外面的东西(client, path):
    """读面与写面共用同一道 containment，但挡的是 `?path=` 而不是标题。"""
    response = client.get("/api/memory/entry", params={"path": path})
    assert response.status_code == 422, path
    detail = response.json()["detail"]
    assert "memory" in detail or "相对路径" in detail or "Markdown" in detail


def test_索引读不到即使它躺在_memory_里(client, tmp_path):
    """白名单比「在 memory/ 里」更严：索引是派生物，不是一条记忆。"""
    folder = tmp_path / "memory"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.yaml").write_text("kind: index\n", encoding="utf-8")
    assert client.get("/api/memory/entry", params={"path": "index.yaml"}).status_code == 422


# ------------------------------------------------------------------ 编年史


def test_列表按世界时间排而不是按文件名(client):
    """`characters/` 下的人名序不是任何事发生的顺序——编年史要按 `at` 排。"""
    client.post("/api/memory/write", json=body())  # at 1500，第一件
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她也记得那场雨", subject="阿雨", evidence=[2], at=9000),
    )
    client.post(
        "/api/memory/write",
        json=body(title="渡口的第二夜", evidence=[1], at=4200),
    )
    paths = [entry["path"] for entry in client.get("/api/memory/list").json()["entries"]]
    assert paths == [
        "events/E0001-渡口的第一夜.md",
        "events/E0002-渡口的第二夜.md",
        "characters/阿雨.md",
    ]


def test_列表带_at_与_day(client):
    client.post("/api/memory/write", json=body())
    client.post("/api/memory/snapshot", json={})
    by_path = {e["path"]: e for e in client.get("/api/memory/list").json()["entries"]}
    assert by_path["events/E0001-渡口的第一夜.md"]["at"] == 1500
    # 快照不是谁写的记忆：它在编年史里是单独一类。
    assert by_path["entries/day-0000.md"]["kind"] == "day"
    assert by_path["entries/day-0000.md"]["at"] is None


def test_没有_at_的记忆排在最后不猜时间(client, tmp_path):
    folder = tmp_path / "memory" / "events"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "E0009-手写的.md").write_text("# 手写的\n\n没有 frontmatter。\n", encoding="utf-8")
    client.post("/api/memory/write", json=body())
    paths = [entry["path"] for entry in client.get("/api/memory/list").json()["entries"]]
    assert paths[-1] == "events/E0009-手写的.md"


def test_手写坏的_frontmatter_不让列表打不开(client, tmp_path):
    """一份坏文件该少一个字段，不该让整个目录读不出来。"""
    folder = tmp_path / "memory" / "events"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "E0009-坏的.md").write_text("---\nat: [没闭上的\n---\n\n# 坏的\n", encoding="utf-8")
    client.post("/api/memory/write", json=body())
    payload = client.get("/api/memory/list").json()
    by_path = {entry["path"]: entry for entry in payload["entries"]}
    assert by_path["events/E0009-坏的.md"]["at"] is None
    assert by_path["events/E0009-坏的.md"]["title"] == "坏的"


def test_列表带第几个世界日(client):
    """同一个常数只在服务端有一份。客户端再写一遍 DAY_MS，迟早有一边忘了改。"""
    client.post("/api/memory/write", json=body(at=90000))  # 90 秒，仍是第 0 天
    client.post("/api/memory/write", json=body(title="第三天", evidence=[1], at=3 * 86400000))
    by_path = {e["path"]: e for e in client.get("/api/memory/list").json()["entries"]}
    assert by_path["events/E0001-渡口的第一夜.md"]["day"] == 0
    assert by_path["events/E0002-第三天.md"]["day"] == 3


def test_没有_at_就没有世界日(client, tmp_path):
    folder = tmp_path / "memory" / "events"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "E0009-手写的.md").write_text("# 手写的\n\n没有 frontmatter。\n", encoding="utf-8")
    by_path = {e["path"]: e for e in client.get("/api/memory/list").json()["entries"]}
    assert by_path["events/E0009-手写的.md"]["day"] is None


# ------------------------------------------------------------------ 一条记忆一行


def test_角色档案按记忆列_不按文件列(client):
    """「她记得那场雨」该出现在那场雨那天，不是跟着档案第一动。

    按文件列的话，一个居民的全部记忆只能共享一个时间——那是档案的创建时间，
    于是她后来记住的事全都排在最后，编年史就不是编年史了。
    """
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔", at=1500),
    )
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她也记得那场雨", subject="莞尔", at=9000, evidence=[2]),
    )
    entries = client.get("/api/memory/list").json()["entries"]
    assert [entry["title"] for entry in entries] == ["她记得我点了灯", "她也记得那场雨"]
    # 两条都指向同一份档案，但各自带着自己的小节名。
    assert {entry["path"] for entry in entries} == {"characters/莞尔.md"}
    assert [entry["section"] for entry in entries] == ["她记得我点了灯", "她也记得那场雨"]
    assert [entry["at"] for entry in entries] == [1500, 9000]
    assert [entry["day"] for entry in entries] == [0, 0]


def test_读一节只要那一节(client):
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔"),
    )
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她也记得那场雨", subject="莞尔", at=9000, evidence=[2]),
    )
    payload = client.get(
        "/api/memory/entry",
        params={"path": "characters/莞尔.md", "section": "她也记得那场雨"},
    ).json()
    assert payload["section"] == "她也记得那场雨"
    assert "## 她也记得那场雨" in payload["text"]
    # 人名那一行留着：读一节时也该知道这是谁的档案。
    assert "# 莞尔" in payload["text"]
    # 另一节不在里面。点开一条就该读到那一条，不是整份档案。
    assert "她记得我点了灯" not in payload["text"]


def test_读一节时小节名必须是真有的(client):
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔"),
    )
    response = client.get(
        "/api/memory/entry",
        params={"path": "characters/莞尔.md", "section": "她记得一件没发生过的事"},
    )
    assert response.status_code == 422
    assert "没有" in response.json()["detail"]


def test_事件与快照没有小节名(client):
    client.post("/api/memory/write", json=body())
    client.post("/api/memory/snapshot", json={})
    by_path = {e["path"]: e for e in client.get("/api/memory/list").json()["entries"]}
    assert by_path["events/E0001-渡口的第一夜.md"]["section"] is None
    assert by_path["entries/day-0000.md"]["section"] is None


def test_摘要跳过机器的字段行(client):
    """一节的开头三行是 `at:`/`依据：`/`来源：`，没有一句是正文。"""
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得我点了灯", subject="莞尔"),
    )
    entry = client.get("/api/memory/list").json()["entries"][0]
    assert entry["summary"] == "我在旧站牌下点了一盏灯。"
