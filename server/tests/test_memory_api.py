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


def test_at_大到转不成浮点也是_422_不是_500(client):
    """`isinstance(at, int)` 收任意精度的整数，`float(at)` 只到 1.8e308。

    中间的巨数过了类型检查，炸出来的是 OverflowError——不是 MemoryWriteError，
    写记忆的端点于是回 500。而这个端点的每一处拒绝都写着 422。
    """
    response = client.post("/api/memory/write", json=body(at=10**400))
    assert response.status_code == 422, f"回了 {response.status_code}，客户端只认 422"
    assert "at" in response.json()["detail"]


def test_at_为负被拒(client):
    response = client.post("/api/memory/write", json=body(at=-1))
    assert response.status_code == 422
    assert "at" in response.json()["detail"]


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
    # 快照的 frontmatter 写的是 day/from_ms/to_ms，没有 at——但它那一天的世界时间
    # 就是 from_ms（窗口起点）。读它：第 0 天的 at 是 0，day 也是 0。
    # 早先这条钉的是 `at is None`，那是个**错的答案**：None 让排序键
    # （`(at is None, at or 0, path)`）把整整一类条目排到最后，
    # 第 3 天的日志于是排在第 2 天的记忆后面，而行上只剩「日志」两个字。
    assert by_path["entries/day-0000.md"]["at"] == 0
    assert by_path["entries/day-0000.md"]["day"] == 0


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


# ------------------------------------------------------------------ 读面的分叉
# 下面几条是子agent review 挑出来的。共同点：不是「功能没做」，
# 是**做了一半**——写面想到了，读面没想到；或者一个文件想到了，一类文件没想到。
# 半道把关比没有把关更危险：它让人以为有人守。


def test_两份同名小节_不带_at_就报错_不静默挑一条(client):
    """同一个人对同一件事的两次观测：两个小节同名，只有 at 不同。

    这是最普通的数据。而小节只用**标题**当身份，`_slice_to_section` 取第一个
    匹配就返回——列表里那两行 `path` 与 `section` 逐字节相同，读者点开
    at=5000 那一行，读回的是 at=1000 的正文，而且没有任何迹象。
    """
    client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得那场雨", subject="莞尔", at=1000),
    )
    client.post(
        "/api/memory/write",
        json=body(
            kind="character",
            title="她记得那场雨",
            subject="莞尔",
            at=5000,
            evidence=[2],
            body="她把伞留在了渡口。",
        ),
    )
    entries = client.get("/api/memory/list").json()["entries"]
    same = [entry for entry in entries if entry["section"] == "她记得那场雨"]
    assert len(same) == 2, "两条都是真记忆，列表两行都该在"
    assert {entry["path"] for entry in same} == {"characters/莞尔.md"}
    assert [entry["at"] for entry in same] == [1000, 5000]

    # 不带 at：报错说明要带，不挑。
    refused = client.get(
        "/api/memory/entry",
        params={"path": "characters/莞尔.md", "section": "她记得那场雨"},
    )
    assert refused.status_code == 422
    assert "at" in refused.json()["detail"]

    # 带了 at：读到对的那一条。
    later = client.get(
        "/api/memory/entry",
        params={"path": "characters/莞尔.md", "section": "她记得那场雨", "at": 5000},
    ).json()
    assert "她把伞留在了渡口。" in later["text"]
    assert "我在旧站牌下点了一盏灯。" not in later["text"]
    earlier = client.get(
        "/api/memory/entry",
        params={"path": "characters/莞尔.md", "section": "她记得那场雨", "at": 1000},
    ).json()
    assert "我在旧站牌下点了一盏灯。" in earlier["text"]

    # 带一个哪儿都没有的 at：也是 422，不是「找不到就退回第一条」。
    missing = client.get(
        "/api/memory/entry",
        params={"path": "characters/莞尔.md", "section": "她记得那场雨", "at": 9999},
    )
    assert missing.status_code == 422


def test_角色正文里的小节标题不让写(client):
    """`## ` 是角色档案里**记忆的边界**，读面靠它把一份档案拆成一条一条。

    调用方自由给的 4000 字里混进这样一行，那条记忆会被安静地截成两半，
    后半以一条独立记忆的身份混进编年史——界面上看不出任何异常。
    挡在写面：读面分不清「这是排版」与「这是下一条记忆」，它没有依据可依。
    """
    response = client.post(
        "/api/memory/write",
        json=body(
            kind="character",
            title="她记得那场雨",
            subject="莞尔",
            body="开头一句。\n\n## 后记\n\n这句本来属于同一条记忆。",
        ),
    )
    assert response.status_code == 422
    assert "body" in response.json()["detail"]


def test_事件的正文可以有排版小节(client):
    """`events/` 是一事一文件，没人按 `## ` 切——在那里它只是排版。"""
    response = client.post(
        "/api/memory/write",
        json=body(body="## 后记\n\n一句话。"),
    )
    assert response.status_code == 201, response.text


def test_标题不能跨行(client):
    """标题要单独成为一行（`## {title}`）。带换行就是往文件里注入整行。"""
    response = client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得那场雨\n\n## 后记", subject="莞尔"),
    )
    assert response.status_code == 422
    assert "title" in response.json()["detail"]


def test_非_UTF8_的文件不让整个列表打不开(client, tmp_path):
    """`memory/` 是 checked-in 的 Markdown，本来就给人手改——手改就有人存成 GBK。

    `read_text` 撞上非 UTF-8 字节抛 `UnicodeDecodeError`，那是 `ValueError`
    的子类，不在 `except OSError` 里：两个读端点一起 500，
    整个镇志抽屉全黑，只因为一个文件。`format.py` 早就为坏 YAML 做了降级，
    编码这一路原来没有。
    """
    folder = tmp_path / "memory" / "events"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "E0009-手写的.md").write_bytes("# 手写的\n\n下雨了。\n".encode("gbk"))
    client.post("/api/memory/write", json=body())
    listed = client.get("/api/memory/list")
    assert listed.status_code == 200, listed.text
    assert any(e["path"] == "events/E0009-手写的.md" for e in listed.json()["entries"])
    opened = client.get("/api/memory/entry", params={"path": "events/E0009-手写的.md"})
    assert opened.status_code == 200, opened.text


def test_path_里的_NUL_字节是_422_不是_500(client):
    """写面的 `check_slug` 早就挡它，读面收的是同一个调用方能控的字符串。

    `Path("events\x00.md").resolve()` 抛的是裸 `ValueError`，不是
    `MemoryPathError`，API 层的 422 handler 接不住。
    """
    response = client.get("/api/memory/entry", params={"path": "events\x00.md"})
    assert response.status_code == 422
    assert "NUL" in response.json()["detail"]


def test_给日志传_section_被拒(client):
    """`## 天气` 是快照里的排版，不是记忆的边界。按它切只会读回半份文件。"""
    client.post("/api/memory/write", json=body())
    client.post("/api/memory/snapshot", json={})
    response = client.get(
        "/api/memory/entry",
        params={"path": "entries/day-0000.md", "section": "天气"},
    )
    assert response.status_code == 422
    assert "只有角色档案分节读" in response.json()["detail"]


def test_两天的日志摘要各自说得清(client, tmp_path):
    """正文第一句是模板行，任意两天除了区间数字完全一样。

    「由事件日志派生，不要手改。世界时间 0–86400000 毫秒，共 2 条。」——
    人在列表里看不出那天发生了什么。摘要该说的是那天的事。
    """
    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=1_000)
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "snow"}, at=90_000_000)
    own = TestClient(create_app(log, tmp_path / "own-memory"))
    own.post("/api/memory/snapshot", json={})
    by_path = {e["path"]: e for e in own.get("/api/memory/list").json()["entries"]}
    # 事件 id 跟着一起说：摘要是通往日志的指针，不只是那天的一句话。
    assert by_path["entries/day-0000.md"]["summary"] == "#1 rain"
    assert by_path["entries/day-0001.md"]["summary"] == "#2 snow"


def test_什么都没发生的那天_摘要说的是这句(client, tmp_path):
    """没有事件的那天会落到通用路径，读到「这一天什么都没发生。」——正好是实话。"""
    log = EventLog(":memory:")
    own = TestClient(create_app(log, tmp_path / "empty-memory"))
    own.post("/api/memory/snapshot", json={"day": 0})
    by_path = {e["path"]: e for e in own.get("/api/memory/list").json()["entries"]}
    assert by_path["entries/day-0000.md"]["summary"] == "这一天什么都没发生。"


def test_指到外面的符号链接不让整个列表打不开(client, tmp_path):
    """一个解析到 memory/ 外的链接：跳过它，别让整个目录读不出来。

    `list_entries` 原先先 `_read` 再 `_relative`，于是链接的目标先被读出来、
    随后被拒——整个列表 422，而 detail 是一个**写**错误的类型名出现在读端点上。
    `resolve_entry` 那条路是干净的（`_resolve` 先拒），两条路判定原本相反。
    """
    outside = tmp_path / "outside.md"
    outside.write_text("# 外面的\n\n不该被读进来。\n", encoding="utf-8")
    link = tmp_path / "memory" / "events" / "E0009-链.md"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("这台机器建不了符号链接（Windows 默认要管理员权限）")
    client.post("/api/memory/write", json=body())
    listed = client.get("/api/memory/list")
    assert listed.status_code == 200, listed.text
    paths = [e["path"] for e in listed.json()["entries"]]
    assert "events/E0009-链.md" not in paths
    # 读面那条路本来就是干净的：它拒，不是 500。
    assert client.get("/api/memory/entry", params={"path": "events/E0009-链.md"}).status_code == 422


def test_subject_带换行同样往档案里注入小节标题(client, tmp_path):
    """`subject` 与 `title` 一样单独成为一行（`format` 写的是 `# {subject}`）。

    只挡 `title` 不挡 `subject`，注入就从 subject 那条路走：
    `subject="莞尔\n\n## 后记"` 落盘后，`GET /api/memory/list` 会把**一条**
    记忆数成三条，其中一条连 `# 莞尔` 那行都读不回来。人只写了一条。
    """
    response = client.post(
        "/api/memory/write",
        json=body(kind="character", title="她记得那场雨", subject="莞尔\n\n## 后记"),
    )
    assert response.status_code == 422, (
        f"subject 带换行该被拒（title 那条已经拒了），实际 "
        f"{response.status_code} 并写出了 {response.json().get('path')}"
    )
    assert "subject" in response.json()["detail"]


def test_同名小节都没写世界时间_别劝人带一个指不到它们的_at(client, tmp_path):
    """`_at_of_chunk` 认不出 `at:` 行时返回 None，而 `at=None` 永远匹配不上任何一节。

    于是「要读哪一条得带上 at」是一句做不到的劝告：那两条从此读不回来。
    仓库里现成的旧档案就有不带 `at:` 的小节，所以这不是假包。
    """
    path = tmp_path / "memory" / "characters" / "莞尔.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "---",
                "kind: character",
                "subject: 莞尔",
                "---",
                "",
                "# 莞尔",
                "",
                "## 她记得那场雨",
                "",
                "第一回，没写时间。",
                "",
                "## 她记得那场雨",
                "",
                "第二回，也没写。",
                "",
            ]
        ),
        encoding="utf-8",
    )
    listed = client.get("/api/memory/list")
    assert listed.status_code == 200, listed.text
    rows = [
        e
        for e in listed.json()["entries"]
        if e["path"] == "characters/莞尔.md" and e["section"] == "她记得那场雨"
    ]
    assert len(rows) == 2, f"该有两条同名的：{[r['at'] for r in rows]}"

    refused = client.get(
        "/api/memory/entry", params={"path": "characters/莞尔.md", "section": "她记得那场雨"}
    )
    assert refused.status_code == 422
    detail = refused.json()["detail"]
    assert "没写" in detail, f"得说清它们没有世界时间，别说成 None：{detail}"
    assert "带 at 也指不到" in detail, f"别说一句做不到的劝告：{detail}"


def test_非_UTF8_的快照文件不让快照端点_500(client, tmp_path):
    """`writer._read` 早就按 replacement 解码了，`snapshot._write_one` 没沾上。

    同一个「手写文件存成 GBK」：列表端点现在回 200，快照端点仍抛裸
    `UnicodeDecodeError`——events 那层只有一个 `EventValidationError` handler，
    接不住，表现成 500。
    """
    day0 = tmp_path / "memory" / "entries" / "day-0000.md"
    day0.parent.mkdir(parents=True, exist_ok=True)
    day0.write_bytes("# 世界日 0\n\n下雨了。\n".encode("gbk"))
    response = client.post("/api/memory/snapshot", json={"day": 0})
    assert response.status_code == 200, response.text

def test_每日摘要是序号最小的那条_不是文件里排最前的那条(client, log):
    """快照按 `_SECTIONS` 的固定次序分节（天气→潮水→盖了起来→…），不是按事件序号。

    一天里 `#1 盖了起来` 与 `#2 rain` 并存时，`## 天气` 排在 `## 盖了起来`
    前面，取「第一个 `- ` 行」拿到的是 `#2 rain`——而 docstring 承诺的是
    「第一条事件」。行里带着序号，挑得出来。
    """
    # 盖楼在 1000，下雨在 9000。文件里 `## 天气` 排在 `## 盖了起来` 前面，
    # 所以「第一个 `- ` 行」是 #2；序号最小的是 #1。
    log.append(
        kind="world.changed",
        actor="world",
        payload={"change": "building.built", "instanceId": "wave_house#1", "prefabId": "wave_house", "displayName": "叠浪楼", "summary": "为抄书斋那条活而建"},
        at=1000,
    )
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=9000)
    client.post("/api/memory/snapshot", json={"day": 0})

    listed = client.get("/api/memory/list")
    assert listed.status_code == 200, listed.text
    row = next(e for e in listed.json()["entries"] if e["kind"] == "day" and e["day"] == 0)
    assert row["summary"].startswith("#1"), (
        f"摘要该是序号最小的那条：{row['summary']!r}"
    )
    assert "叠浪楼" in row["summary"], f"摘要是最早那条的原文：{row['summary']!r}"


def test_没闭合的_frontmatter_别让摘要变成_day(client, tmp_path):
    """`_body_lines` 只在 frontmatter **闭合**时剥它。没闭合时 `day:` 以正文
    第一行的身份出现，而它不在 `_MACHINE_LINES` 里——摘要于是变成 `day: 2`，
    正是这个函数当初要消灭的那个表现，只是换了条路进来。
    """
    path = tmp_path / "memory" / "entries" / "day-0002.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\nday: 2\nfrom_ms: 172800000\n\n# 世界日 2\n\n这一天什么都没发生。\n",
        encoding="utf-8",
    )
    listed = client.get("/api/memory/list")
    assert listed.status_code == 200, listed.text
    row = next(e for e in listed.json()["entries"] if e["path"] == "entries/day-0002.md")
    assert row["summary"] != "day: 2", f"机器的字段行被当成了正文：{row['summary']!r}"
    assert row["summary"] == "这一天什么都没发生。", row["summary"]
