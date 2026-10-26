"""`GET /api/events` 的形状与分页语义。

客户端 `events-client.ts` 依赖这个形状，所以这里的断言是**契约**，
不是实现细节——改这里等于改线协议。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from events.api import MAX_SINCE, create_app
from events.log import MAX_LIMIT, EventLog


@pytest.fixture()
def client_and_log():
    log = EventLog()
    with TestClient(create_app(log)) as client:
        yield client, log


def _fill(log: EventLog, n: int) -> None:
    for index in range(n):
        log.append(
            kind="world.changed",
            actor="world",
            payload={"n": index},
            at=float(index),
        )


def test_空日志返回空数组与_latestId_0(client_and_log) -> None:
    client, _ = client_and_log
    body = client.get("/api/events").json()
    assert body == {"events": [], "latestId": 0, "hasMore": False}


def test_返回的五字段与票面一致(client_and_log) -> None:
    client, log = client_and_log
    _fill(log, 1)
    event = client.get("/api/events").json()["events"][0]
    assert set(event) == {"id", "at", "kind", "actor", "payload"}
    assert event["id"] == 1
    assert event["at"] == 0.0
    assert event["kind"] == "world.changed"
    assert event["actor"] == "world"
    assert event["payload"] == {"n": 0}


def test_since_断点续读(client_and_log) -> None:
    client, log = client_and_log
    _fill(log, 5)
    first = client.get("/api/events", params={"since": 0, "limit": 2}).json()
    assert [e["id"] for e in first["events"]] == [1, 2]
    assert first["hasMore"] is True

    rest = client.get("/api/events", params={"since": 2, "limit": 100}).json()
    assert [e["id"] for e in rest["events"]] == [3, 4, 5]
    assert rest["hasMore"] is False


def test_追平之后_hasMore_为_false(client_and_log) -> None:
    client, log = client_and_log
    _fill(log, 3)
    body = client.get("/api/events", params={"since": 3}).json()
    assert body["events"] == []
    assert body["hasMore"] is False
    assert body["latestId"] == 3


def test_latestId_是整个日志的最大_id_不是这一页的(client_and_log) -> None:
    client, log = client_and_log
    _fill(log, 10)
    body = client.get("/api/events", params={"limit": 3}).json()
    assert [e["id"] for e in body["events"]] == [1, 2, 3]
    assert body["latestId"] == 10, "客户端靠它判断追平没有，不能是分页内的最大值"


def test_恰好读满且已到底_hasMore_为_false(client_and_log) -> None:
    client, log = client_and_log
    _fill(log, 3)
    body = client.get("/api/events", params={"limit": 3}).json()
    assert body["hasMore"] is False, "读满不等于还有更多"


def test_读满且后面还有_hasMore_为_true(client_and_log) -> None:
    client, log = client_and_log
    _fill(log, 4)
    body = client.get("/api/events", params={"limit": 3}).json()
    assert body["hasMore"] is True


@pytest.mark.parametrize("since", [-1, "abc"])
def test_since_越界或非整数返回_422(client_and_log, since) -> None:
    client, _ = client_and_log
    assert client.get("/api/events", params={"since": since}).status_code == 422


def test_since_超过_SQLite_整数上限也返回_422_不是_500(client_and_log) -> None:
    """SQLite 的 INTEGER 是 64 位有符号，超出去的数绑不进去。

    `sqlite3` 抛的是 OverflowError，不是 `EventValidationError`——API 层那个
    转 422 的处理器接不住，于是读接口回 500。`ge=0` 只挡住了负数，
    挡不住「大到不是游标」的那种数。

    不把它夹成上限：客户端问的是「第 N 条之后」，夹一下等于回答「没有了」，
    那是用静默修正换一个好看的 200。
    """
    client, _ = client_and_log
    response = client.get("/api/events", params={"since": 2**63})
    assert response.status_code == 422, f"回了 {response.status_code}，客户端只认 422"
    # 上限本身是合法游标：追平了的客户端传的就是它附近的值。
    assert client.get("/api/events", params={"since": MAX_SINCE}).status_code == 200


@pytest.mark.parametrize("limit", [0, MAX_LIMIT + 1, "abc"])
def test_limit_越界或非整数返回_422(client_and_log, limit) -> None:
    client, _ = client_and_log
    assert client.get("/api/events", params={"limit": limit}).status_code == 422


def test_事件日志没有写入端点(client_and_log) -> None:
    client, log = client_and_log
    # 只读是设计决定，不是「还没写」。能通过 HTTP 往里塞事件，
    # 等于把「世界发生过什么」交给了任何能访问端口的人。
    for method in ("post", "put", "patch", "delete"):
        response = getattr(client, method)("/api/events")
        assert response.status_code == 405, f"{method.upper()} /api/events 不该存在"


def test_中文_payload_原样往返(client_and_log) -> None:
    client, log = client_and_log
    log.append(kind="oracle.spoken", actor="player", payload={"raw": "让天晴"}, at=1.0)
    event = client.get("/api/events").json()["events"][0]
    assert event["payload"]["raw"] == "让天晴"


# ------------------------------------------------------- 冻结样例（跨语言契约）

SAMPLE = Path(__file__).resolve().parents[2] / "docs" / "events-page.sample.json"


def test_服务端产出的形状与冻结样例逐字段一致(client_and_log) -> None:
    """`docs/events-page.sample.json` 是线协议的冻结产物。

    客户端 `test/events-client.test.ts` 断言自己读得懂它；这里断言服务端**造得出**它。
    两边各自冻结，改协议时两边同时红——否则「服务端改了、客户端没跟上」这种漂移
    要等到运行时才发现。
    """
    client, log = client_and_log
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    for item in sample["events"]:
        log.append(kind=item["kind"], actor=item["actor"], payload=item["payload"], at=item["at"])

    body = client.get("/api/events").json()
    assert body == sample
