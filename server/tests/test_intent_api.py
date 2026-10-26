"""`POST /api/world/intent` 与冻结的线协议。

前端 `world-client/src/world/intent-client.ts` 只读响应里的 `intent`，
并把它交给 `intent-schema.ts` 校验。所以这组测试钉两件事：

1. 信封形状是 `{intent, model, source}`，不多不少（客户端会拒缺 `intent`）。
2. **装进 `intent` 的东西真的能过客户端的校验器**——这一条由
   `world-client/test/intent-contract.test.ts` 反向钉住：它拿这里的响应当输入。

两边拿的是**同一份**冻结样例 `docs/intent.sample.json`。不是各写一张表：
各写一张只钉住「写那天两边一致」，共读一份才钉得住端点本身。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from events.api import create_app
from events.log import EventLog
from oracle import wire
from oracle.api import command_to_intent
from oracle.orchestrator import ModelUnavailable
from rules.schema import validate_command

SAMPLE = Path(__file__).resolve().parents[2] / "docs" / "intent.sample.json"

TEMPLATES = [
    {"id": "code_forge", "displayName": "炼码工坊", "boundTask": "code"},
    {"id": "workshop_plot", "displayName": "新工坊", "boundTask": None},
]


def client_with(reply: str | None = None, *, raises: Exception | None = None) -> TestClient:
    app = create_app(EventLog(":memory:"))

    def caller(_messages):
        if raises is not None:
            raise raises
        return reply if reply is not None else ""

    app.state.model_caller = caller
    app.state.model_name = "fake-model"
    return TestClient(app)


def post(client: TestClient, **overrides):
    body = {"utterance": "下雨吧", "templates": TEMPLATES}
    body.update(overrides)
    return client.post("/api/world/intent", json=body)


def commands(*items: dict) -> str:
    return json.dumps({"commands": list(items), "narrative": "听懂了"})


def client_with_log(*built: str, removed: tuple[str, ...] = ()) -> TestClient:
    """事件日志里先有建筑记录的客户端。

    `docs/INTENT_EXPERIMENT.md` 里漏掉的那条（「拆掉第 999 号楼」）只有在
    **服务端知道世界上有什么**的时候才拦得住——空日志里它照样过得去，
    而那是故意的：证不明就不判。
    """
    app = create_app(EventLog(":memory:"))
    log = app.state.event_log
    for index, instance_id in enumerate(built):
        log.append(
            kind="world.changed",
            actor="world",
            payload={"change": "building.built", "instanceId": instance_id, "prefabId": "code_forge", "displayName": "工坊"},
            at=float(index),
        )
    for offset, instance_id in enumerate(removed):
        log.append(
            kind="world.changed",
            actor="world",
            payload={"change": "building.removed", "instanceId": instance_id, "displayName": "工坊"},
            at=float(len(built) + offset),
        )

    def caller(_messages):
        return commands({"command": "building.remove", "args": {"instanceId": "observatory#999"}})

    app.state.model_caller = caller
    app.state.model_name = "fake-model"
    return TestClient(app)


# ---------------------------------------------------------------- 冻结样例

def _sample_cases() -> list[dict]:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))["responses"]


def test_冻结样例里的每一条端点都真的这么回() -> None:
    """`docs/intent.sample.json` 是意图线的冻结产物。

    客户端 `intent-contract.test.ts` 拿它当输入，断言自己的校验器全收得下；
    这里拿它当**期望值**，断言端点真的产出这些形状。两边各自冻结，
    改协议时两边同时红——样例是那条共同的钉子。
    """
    cases = _sample_cases()
    assert cases, "样例空了，这条测试等于没跑"
    for case in cases:
        command = case["command"]
        if command is None:
            # 没听懂：命令为空，原因走 narrative → unknown.reason。
            reply = json.dumps({"commands": [], "narrative": case["intent"]["reason"]}, ensure_ascii=False)
        else:
            reply = commands(command)
        response = post(client_with(reply))
        assert response.status_code == 200, case["why"]
        assert response.json()["intent"] == case["intent"], case["why"]


def test_端点能回的意图种类与样例覆盖的种类一致() -> None:
    """反方向：样例没覆盖的类型，说明有人加了命令却没加样例；
    样例多出来的类型，说明样例过期了。两种都该当场红。"""
    sample_kinds = {case["intent"]["kind"] for case in _sample_cases()}
    reachable = {
        intent["kind"]
        for intent in (
            command_to_intent(command)
            for command in (
                validate_command({"command": "weather.set", "args": {"value": "rain"}}),
                validate_command({"command": "tide.setLevel", "args": {"value": 1, "durationMs": 1000}}),
                validate_command(
                    {"command": "building.add", "args": {"prefabId": "code_forge", "at": {"x": 1, "y": 1}}}
                ),
                validate_command({"command": "building.remove", "args": {"instanceId": "x#1"}}),
                validate_command({"command": "miracle.spawn", "args": {"kind": "cat"}}),
            )
        )
        if intent is not None
    } | {"unknown"}
    assert sample_kinds == reachable


# ---------------------------------------------------------------- 成功

def test_一条天气命令回到客户端认得的样子() -> None:
    response = post(
        client_with(commands({"command": "weather.set", "args": {"value": "rain"}}))
    )
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == {"kind": "setWeather", "weather": "rain"}
    assert body["model"] == "fake-model"
    assert body["source"] == "model"


def test_拨潮回到_setTide_带着时长() -> None:
    response = post(
        client_with(
            commands({"command": "tide.setLevel", "args": {"value": 1, "durationMs": 30_000}})
        )
    )
    assert response.json()["intent"] == {"kind": "setTide", "level": 1, "durationMs": 30_000}


def test_建楼回到_build_形状() -> None:
    response = post(
        client_with(
            commands(
                {"command": "building.add", "args": {"prefabId": "code_forge", "at": {"x": 3, "y": 4}}}
            )
        )
    )
    assert response.json()["intent"] == {
        "kind": "build",
        "templateId": "code_forge",
        "at": {"x": 3, "y": 4},
    }


def test_拆楼的实例_id_原样到世界() -> None:
    """实例 id 是身份，不是可以化简的名字。

    早先这里把 `bookshop#1` 降级成 `bookshop`，世界再去拆「第一栋抄书斋」——
    用户说拆 1 号，拆掉的是 2 号，而且回执还会说成功。
    """
    response = post(
        client_with(commands({"command": "building.remove", "args": {"instanceId": "bookshop#2"}}))
    )
    assert response.json()["intent"] == {"kind": "demolish", "instanceId": "bookshop#2"}


# ---------------------------------------------------------------- 存在性这道闸

def test_日志里有建筑记录时_拆一栋不存在的楼落_unknown() -> None:
    """#16 验收条件里「越界请求被拒率 = 100%」首轮漏的就是这一条。

    模型给了一个世界上没有的 instanceId。早先白名单只查「是不是非空字符串」，
    于是它原样到了世界那儿。坐标越界在 `_point` 里就拦，实例存在与否没有
    理由放到世界那一层再答一遍。归因不在模型——服务端那时答不出
    「世界上有哪些楼」。
    """
    response = post(client_with_log("code_forge#1", "bookshop#1"))
    body = response.json()
    assert body["intent"]["kind"] == "unknown"
    assert "observatory#999" in body["intent"]["reason"]
    assert "code_forge#1" in body["intent"]["reason"], "拒收时要把世界上有的列出来"


def test_日志里有的楼_拆得过() -> None:
    client = client_with_log("code_forge#1", "bookshop#1")
    app = client.app

    def caller(_messages):
        return commands({"command": "building.remove", "args": {"instanceId": "bookshop#1"}})

    app.state.model_caller = caller
    assert post(client).json()["intent"] == {"kind": "demolish", "instanceId": "bookshop#1"}


def test_建了又拆掉的那栋_再拆就被拒() -> None:
    """投影要跟着日志递减。只累加不递减的话，拆掉一次之后再也拆不了第二次，
    而世界里的楼确实已经没了。"""
    response = post(client_with_log("bookshop#1", removed=("bookshop#1",)))
    assert response.json()["intent"]["kind"] == "unknown"


def test_日志里没有建筑记录时不拿存在性拦人() -> None:
    """证不明就不判。空日志时服务端无从判断，交给世界照它自己的话说——
    否则每一句合理的「拆掉那栋楼」都会被拒，而世界明明在好好地建楼拆楼。"""
    response = post(
        client_with(commands({"command": "building.remove", "args": {"instanceId": "bookshop#2"}}))
    )
    assert response.json()["intent"] == {"kind": "demolish", "instanceId": "bookshop#2"}


# ---------------------------------------------------------------- 现状以客户端为准

def _built_context(*instance_ids: str) -> dict:
    return {
        "built": {
            "town": [{"instanceId": each, "templateId": "code_forge", "name": "工坊"} for each in instance_ids],
            "wild": [],
        }
    }


def test_客户端报了现状_拆一栋日志里没有的楼也拆得过() -> None:
    """**开局就有的楼在日志里没有 `building.built` 事件。**

    客户端只对运行时新建的楼发回写。所以一个会话里日志出现的第一条建筑记录
    往往是一次拆除——那一刻投影的口袋是空的，于是之后每一句「拆掉它」都被拒
    成 unknown-instance，还附一句「现在一栋楼也没有」。世界明明还在好好地
    建楼拆楼。世界的现状只有客户端知道，所以以它为准，日志只做兜底。
    """
    client = client_with(commands({"command": "building.remove", "args": {"instanceId": "ferry#1"}}))
    client.app.state.event_log.append(
        kind="world.changed",
        actor="world",
        payload={"change": "building.removed", "instanceId": "old_shop#1", "displayName": "旧铺"},
        at=0.0,
    )
    response = post(client, context=_built_context("ferry#1", "code_forge#1"))
    assert response.json()["intent"] == {"kind": "demolish", "instanceId": "ferry#1"}


def test_客户端报的现状里没有那栋_照拒() -> None:
    """以现状为准不等于放宽。客户端说没有，就是没有——它比日志新。"""
    client = client_with(commands({"command": "building.remove", "args": {"instanceId": "observatory#999"}}))
    client.app.state.event_log.append(
        kind="world.changed",
        actor="world",
        payload={"change": "building.built", "instanceId": "observatory#1", "prefabId": "code_forge", "displayName": "工坊"},
        at=0.0,
    )
    response = post(client, context=_built_context("code_forge#1"))
    body = response.json()
    assert body["intent"]["kind"] == "unknown"
    assert "observatory#999" in body["intent"]["reason"]
    assert "code_forge#1" in body["intent"]["reason"]


class _BrokenLog:
    """一读就炸的日志。"""

    def read(self, **_kwargs):
        raise RuntimeError("数据库锁着")


def test_日志读不动时不拿存在性拦人_也不回_500() -> None:
    """世界摘要是判越界的帮手，不是「这句话翻不翻得出来」的前提。

    日志坏着的当口，仍然该把「拆掉它」翻成拆除命令，只是这一句不再查存在性。
    多一个 500 就是多一种客户端没准备过的失败，少的却是白名单里本来照常生效的
    那几项检查——端点文档里只有 503 / 422 / 200 三种结局，别自己加第四种。
    """
    app = create_app(EventLog(":memory:"))
    app.state.event_log = _BrokenLog()
    app.state.model_caller = lambda _m: commands(
        {"command": "building.remove", "args": {"instanceId": "bookshop#2"}}
    )
    app.state.model_name = "fake-model"
    response = post(TestClient(app))
    assert response.status_code == 200
    assert response.json()["intent"] == {"kind": "demolish", "instanceId": "bookshop#2"}


def test_神迹回到_miracle_形状() -> None:
    response = post(client_with(commands({"command": "miracle.spawn", "args": {"kind": "cat"}})))
    assert response.json()["intent"] == {"kind": "miracle", "miracle": "cat", "at": None}


def test_多给一条命令时整条拒_不是悄悄只做第一条() -> None:
    """世界侧还没有「一批命令按序结算」。

    悄悄执行第一条比明确拒绝更坏：用户说了两件事，世界只做了一件，
    回执却像办完了。要批处理是调用方拆成多次请求的事。
    """
    response = post(
        client_with(
            commands(
                {"command": "weather.set", "args": {"value": "rain"}},
                {"command": "weather.set", "args": {"value": "storm"}},
            )
        )
    )
    body = response.json()
    assert body["intent"]["kind"] == "unknown"
    assert "最多 1 条" in body["intent"]["reason"]
    assert "dropped" not in body


# ---------------------------------------------------------------- 没听懂

def test_模型判_unknown_时回_source_none_与原因() -> None:
    response = post(client_with(json.dumps({"commands": [], "narrative": "这是在闲聊"})))
    body = response.json()
    assert body["intent"]["kind"] == "unknown"
    assert body["intent"]["reason"] == "这是在闲聊"
    assert body["source"] == "none"


def test_模型回非_JSON_落_unknown_不猜() -> None:
    response = post(client_with("好的，我这就下雨"))
    body = response.json()
    assert response.status_code == 200, "没听懂不是 HTTP 错误"
    assert body["intent"]["kind"] == "unknown"
    assert "不是 JSON" in body["intent"]["reason"]


def test_越界命令落_unknown_并说清为什么() -> None:
    response = post(
        client_with(commands({"command": "tide.setLevel", "args": {"value": 5}}))
    )
    body = response.json()
    assert body["intent"]["kind"] == "unknown"
    assert "0..1" in body["intent"]["reason"]


def test_世界还执行不了的命令落_unknown_而不是装作执行了() -> None:
    """`npc.setSchedule` 过得了白名单（它是一条合法命令），但客户端与世界
    都还没有这条意图。端点必须说「世界还执行不了」，不能装作办完了。"""
    response = post(
        client_with(
            commands({"command": "npc.setSchedule", "args": {"id": "v0", "schedule": "garden"}})
        )
    )
    assert response.json()["intent"]["kind"] == "unknown"


def test_拆楼没有实例_id_时被拒_而不是编一个() -> None:
    """只有模板 id 时，服务端**不能**自己拼一个 `templateId#1` 去拆——
    那等于替用户挑了一栋。这一条钉的是那个诱惑。"""
    with pytest.raises(wire.WireError) as caught:
        wire.validate_intent({"kind": "demolish", "templateId": "ink_house"})
    assert "instanceId" in str(caught.value)


def test_拆楼两个键同时给也被拒() -> None:
    """两个都给了，说明调用方对「拆哪一栋」没有拿定主意。猜一个不如问清楚。"""
    with pytest.raises(wire.WireError) as caught:
        wire.validate_intent(
            {"kind": "demolish", "templateId": "ink_house", "instanceId": "ink_house#2"}
        )
    assert "不能同时给" in str(caught.value)


def test_拆楼给了实例_id_就原样翻成白名单命令() -> None:
    intent, command = wire.validate_intent({"kind": "demolish", "instanceId": "ink_house#3"})
    assert intent["instanceId"] == "ink_house#3"
    assert command is not None
    assert command.name == "building.remove"
    assert command.args == {"instanceId": "ink_house#3"}


# ---------------------------------------------------------------- 端点自身的错误

def test_没配_Key_回_503() -> None:
    app = create_app(EventLog(":memory:"))
    def unavailable(_messages):
        raise ModelUnavailable("未配置 LLM_API_KEY")

    app.state.model_caller = unavailable
    response = TestClient(app).post(
        "/api/world/intent", json={"utterance": "下雨吧", "templates": TEMPLATES}
    )
    assert response.status_code == 503
    assert "LLM_API_KEY" in response.json()["detail"]


def test_没有注入调用者时按环境变量判断并回_503(monkeypatch) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    response = TestClient(create_app(EventLog(":memory:"))).post(
        "/api/world/intent", json={"utterance": "下雨吧", "templates": TEMPLATES}
    )
    assert response.status_code == 503


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"templates": TEMPLATES},
        {"utterance": 7, "templates": TEMPLATES},
        {"utterance": "下雨吧"},
        {"utterance": "下雨吧", "templates": [{"displayName": "无 id"}]},
        {"utterance": "下雨吧", "templates": TEMPLATES, "context": "不是对象"},
    ],
)
def test_请求形状不对回_422(body: dict) -> None:
    response = TestClient(create_app(EventLog(":memory:"))).post("/api/world/intent", json=body)
    assert response.status_code == 422


def test_意图端点不写事件日志() -> None:
    """解析只是解析。世界改变由世界回写 `/api/world/changes`——
    这条端点要是也写日志，同一条改变会被记两次。"""
    client = client_with(commands({"command": "weather.set", "args": {"value": "rain"}}))
    post(client)
    assert client.get("/api/events").json()["events"] == []
