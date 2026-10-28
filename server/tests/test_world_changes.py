"""`POST /api/world/changes` 的白名单与形状校验。

这组测试的重点不是「能不能写」，而是**写不进不该写的东西**：
读接口已经由 `test_events_api.py` 钉住了，这里钉的是它新开的那扇窄门——
世界只能把「我做成了什么」记回去。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from events.api import create_app
from events.log import EventLog
from events.world_changes import WORLD_CHANGE_CHECKS, WorldChangeError, validate_world_change

SAMPLE = Path(__file__).resolve().parents[2] / "docs" / "world-changes.sample.json"

VALID_PAYLOADS = {
    "task.delivered": {
        "taskId": "c_1",
        "summary": "写爬虫",
        "workerId": "v0",
        "source": "feed",
        "taskKind": "code",
    },
    "building.built": {
        "instanceId": "bookshop#1",
        "prefabId": "bookshop",
        "displayName": "书斋",
        "summary": "建一间书斋",
    },
    "building.removed": {"instanceId": "bookshop#1", "displayName": "书斋"},
    "miracle": {"miracle": "lamp", "at": {"x": 3, "y": 4}},
    # 三档都收；storm 是 #14 加的强度档，不是新机制。
    "weather": {"weather": "storm"},
    # 记的是覆盖，不是当时的潮位：潮位是 now 的纯函数，记它等于记时钟。
    "tide": {"level": 0.25, "until": 120_000},
    # 一天结束了，世界的心电图。不是「世界改了什么」，是「世界现在什么样」——
    # 内环唯一被允许的对外输出（补充设计 §0）。
    "world.vitals": {
        "day": 0,
        "meanValence": -0.12,
        "meanArousal": 0.38,
        "infoEntropy": 0.44,
        "isolatedHoldersCount": 1,
    },
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(EventLog(":memory:")))


def post(client: TestClient, change: str, payload: dict, at: object = 1000):
    return client.post("/api/world/changes", json={"at": at, "change": change, "payload": payload})


# ---------------------------------------------------------------- 白名单

def test_白名单与载荷表是同一批名字() -> None:
    """`WORLD_CHANGE_CHECKS` 与 `VALID_PAYLOADS` 必须覆盖同一批 `change`。

    2026-10-28 補记：这一条**原来叫** `test_白名单就是客户端那份联合类型`，
    docstring 写着「这份清单要与 `world-client/src/world/world-changes.ts` 的
    `WorldChange` 联合类型逐个对上」。**那句话是假的**——断言比的是本文件里的
    两张服务端表，一个客户端文件都没读过（本文件至今不读任何客户端源码，
    grep `world-client` 只有这行補记）。跨边界那一半在客户端那一侧：
    `world-client/test/world-changes.test.ts` 有一条读
    `server/events/world_changes.py` 的 `WORLD_CHANGE_CHECKS`，
    与 `WORLD_CHANGE_KINDS` 逐个对。两边各守一半，加起来才闭环。

    一句假话比没有话更坏：它读起来像那道闸已经跨过边界了，
    于是没有人再去写真正跨边界的那一条。所以名字与 docstring 都按实测改。

    本条自己仍然有用，而且**只此一处**：它是唯一一个拿 `WORLD_CHANGE_CHECKS`
    当输入遍历的表。往白名单加一种 `change` 而 `VALID_PAYLOADS` 没跟，
    别的测试一个都不会红——`test_每种合法的世界改变都能写进去` 只遍历
    `VALID_PAYLOADS` 自己的键，`test_取值域之外被拒` 的参数化是写死的五行。
    实测过：从 `VALID_PAYLOADS` 里删掉一个键，红的只有这一条。
    但那是「两张服务端表对齐」，不是「两端对齐」，别把它说成后者。
    """
    assert set(WORLD_CHANGE_CHECKS) == set(VALID_PAYLOADS)


def test_冻结样例里的每一条都收得下(client: TestClient) -> None:
    """`docs/world-changes.sample.json` 是白名单的冻结产物。

    客户端 `test/world-changes.test.ts` 断言自己造得出这些形状；这里断言服务端
    **全都收得下**。两边各自冻结，改协议时两边同时红——否则「客户端加了一种改变、
    服务端没跟上」要等到线上一条也写不进去才发现。
    """
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    for body in sample["changes"]:
        response = client.post("/api/world/changes", json=body)
        assert response.status_code == 201, (body["change"], response.text)

    stored = client.get("/api/events", params={"limit": 100}).json()["events"]
    assert [event["payload"]["change"] for event in stored] == [
        body["change"] for body in sample["changes"]
    ]


def test_每种合法的世界改变都能写进去(client: TestClient) -> None:
    for change, payload in VALID_PAYLOADS.items():
        response = post(client, change, payload)
        assert response.status_code == 201, (change, response.text)
        assert isinstance(response.json()["id"], int)


def test_写进去的事件是_world_changed_而不是调用方指定的_kind(client: TestClient) -> None:
    post(client, "weather", {"weather": "rain"}, at=5)
    page = client.get("/api/events").json()
    assert len(page["events"]) == 1
    event = page["events"][0]
    assert event["kind"] == "world.changed"
    assert event["actor"] == "world"
    assert event["at"] == 5
    assert event["payload"] == {"change": "weather", "weather": "rain"}


def test_调用方不能自带_kind(client: TestClient) -> None:
    """想借这个口子伪造 `task.settled` 是不行的：`kind` 服务端写死。"""
    response = client.post(
        "/api/world/changes",
        json={"at": 1, "kind": "task.settled", "change": "weather", "payload": {"weather": "rain"}},
    )
    assert response.status_code == 422
    assert "kind" in response.json()["detail"]


def test_白名单外的_change_被拒并列出白名单(client: TestClient) -> None:
    response = post(client, "task.forged", {})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "task.forged" in detail
    assert "weather" in detail, "拒收时要说清白名单里有什么"


# ---------------------------------------------------------------- 信封

def test_信封多带字段被拒(client: TestClient) -> None:
    response = client.post(
        "/api/world/changes",
        json={"at": 1, "change": "weather", "payload": {"weather": "rain"}, "id": 99},
    )
    assert response.status_code == 422
    assert "id" in response.json()["detail"]


def test_payload_必须是对象(client: TestClient) -> None:
    for payload in (None, [], "rain", 1):
        response = post(client, "weather", payload)  # type: ignore[arg-type]
        assert response.status_code == 422, payload


def test_神迹坐标不会顶掉世界时间(client: TestClient) -> None:
    """信封的 `at` 是世界时间，神迹的 `at` 是格子坐标。分层之后不会撞。

    第一版把两者都叫 `at`，`{"at": {"x": 1, "y": 2}}` 会被当成「时间是个对象」
    而被拒——坐标根本递不进去。现在坐标住在 payload 里。
    """
    response = post(client, "miracle", {"miracle": "lamp", "at": {"x": 3, "y": 4}}, at=42)
    assert response.status_code == 201
    event = client.get("/api/events").json()["events"][0]
    assert event["at"] == 42, '世界时间没被坐标顶掉'
    assert event["payload"]["at"] == {"x": 3, "y": 4}, '坐标原样落进载荷'


@pytest.mark.parametrize("at", [-1, "1000", None, True])
def test_at_必须是世界时间的非负数(client: TestClient, at) -> None:
    response = post(client, "weather", {"weather": "rain"}, at=at)
    assert response.status_code == 422
    assert "at" in response.json()["detail"]


@pytest.mark.parametrize("at", [10**400, -(10**400)])
def test_at_大到转不成浮点也是_422_不是_500(client: TestClient, at) -> None:
    """`at < 0` 对任意精度的整数照样判得出来，所以负的巨数在前一道就被拒。

    正的巨数一路走到 `float(at)` 才炸 OverflowError。它不是 `WorldChangeError`，
    于是这个端点回 500——而它的每一处拒绝都该是 422。世界时间以毫秒计，
    没有 1e400 这么大的时刻，这不是一个合法但极端的世界时间。
    """
    response = post(client, "weather", {"weather": "rain"}, at=at)
    assert response.status_code == 422, f"回了 {response.status_code}，客户端只认 422"
    assert "at" in response.json()["detail"]


def test_at_省略也被拒(client: TestClient) -> None:
    response = client.post(
        "/api/world/changes", json={"change": "weather", "payload": {"weather": "rain"}}
    )
    assert response.status_code == 422
    assert "at" in response.json()["detail"]


# ---------------------------------------------------------------- 载荷形状

@pytest.mark.parametrize("missing", ["taskId", "summary", "workerId", "source", "taskKind"])
def test_缺字段被拒且指名缺哪个(client: TestClient, missing: str) -> None:
    payload = {k: v for k, v in VALID_PAYLOADS["task.delivered"].items() if k != missing}
    response = post(client, "task.delivered", payload)
    assert response.status_code == 422
    assert missing in response.json()["detail"]


@pytest.mark.parametrize(
    "patch, fragment",
    [
        ({"source": "oracle"}, "source"),
        ({"taskKind": "cooking"}, "taskKind"),
        ({"summary": ""}, "不能为空"),
        ({"taskId": 7}, "taskId"),
        ({"extra": "x"}, "不认识的字段"),
    ],
)
def test_取值域之外被拒(client: TestClient, patch: dict, fragment: str) -> None:
    payload = {**VALID_PAYLOADS["task.delivered"], **patch}
    response = post(client, "task.delivered", payload)
    assert response.status_code == 422
    assert fragment in response.json()["detail"]


def test_多带字段被拒() -> None:
    """宽松解析会让两端的理解悄悄分叉：多出来的字段一端以为记上了，另一端丢了。"""
    body = {"at": 1, "change": "weather", "payload": {"weather": "rain", "extra": "x"}}
    with pytest.raises(WorldChangeError, match="不认识的字段"):
        validate_world_change(body)


def test_神迹坐标必须是整数格(client: TestClient) -> None:
    for at in ({"x": 1.5, "y": 2}, {"x": 1}, {"x": 1, "y": 2, "z": 3}, {"x": True, "y": 2}, "1,2"):
        response = post(client, "miracle", {"miracle": "lamp", "at": at})
        assert response.status_code == 422, at


@pytest.mark.parametrize("weather", ["clear", "rain", "storm"])
def test_天气三档都收(client: TestClient, weather: str) -> None:
    """#14 把 `Weather` 扩成三档；回写白名单必须同步，否则暴雨天世界写不回去。"""
    assert post(client, "weather", {"weather": weather}).status_code == 201


def test_天气不认识的值被拒(client: TestClient) -> None:
    response = post(client, "weather", {"weather": "snow"})
    assert response.status_code == 422
    assert "weather" in response.json()["detail"]


@pytest.mark.parametrize(
    "patch, fragment",
    [
        ({"level": 1.5}, "0..1"),
        ({"level": -0.1}, "0..1"),
        ({"level": True}, "布尔"),
        ({"until": -1}, "不能为负"),
        ({"extra": "x"}, "不认识的字段"),
        ({"level": "0.5"}, "必须是"),
    ],
)
def test_撥潮载荷越界被拒(client: TestClient, patch: dict, fragment: str) -> None:
    """拨潮记的是覆盖：潮位必须在 0..1，到期时刻不能为负。"""
    payload = {**VALID_PAYLOADS["tide"], **patch}
    response = post(client, "tide", payload)
    assert response.status_code == 422, payload
    assert fragment in response.json()["detail"]


def test_拨潮缺字段被拒(client: TestClient) -> None:
    for missing in ("level", "until"):
        payload = {k: v for k, v in VALID_PAYLOADS["tide"].items() if k != missing}
        response = post(client, "tide", payload)
        assert response.status_code == 422
        assert missing in response.json()["detail"]


def test_建筑来由可以是_null(client: TestClient) -> None:
    """开局常驻的楼没有来由。null 是合法值，不是缺字段。"""
    payload = {**VALID_PAYLOADS["building.built"], "summary": None}
    assert post(client, "building.built", payload).status_code == 201


def test_校验是纯函数_不碰日志() -> None:
    """同一条载荷反复校验，不产生任何写入。"""
    body = {"at": 7, "change": "weather", "payload": {"weather": "rain"}}
    change, at, payload = validate_world_change(body)
    assert change == "weather"
    assert at == 7.0
    assert payload == {"weather": "rain"}


def test_读接口不受影响_仍然没有写事件的通用入口(client: TestClient) -> None:
    """`/api/events` 还是只读的：这个世界改变端点不能变成通用 append。"""
    assert client.post("/api/events", json={"kind": "task.settled"}).status_code == 405
    assert client.put("/api/events", json={}).status_code == 405
    assert client.delete("/api/events").status_code == 405
