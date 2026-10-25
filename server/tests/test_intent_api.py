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


def test_拆楼把实例_id_换成模板_id() -> None:
    """白名单收 instanceId（bookshop#1），客户端的 demolish 收 templateId。
    去掉 #N 后缀是**明确的换算**，不是猜。"""
    response = post(
        client_with(commands({"command": "building.remove", "args": {"instanceId": "bookshop#1"}}))
    )
    assert response.json()["intent"] == {"kind": "demolish", "templateId": "bookshop"}


def test_神迹回到_miracle_形状() -> None:
    response = post(client_with(commands({"command": "miracle.spawn", "args": {"kind": "cat"}})))
    assert response.json()["intent"] == {"kind": "miracle", "miracle": "cat", "at": None}


def test_多给一条命令时只执行第一条并报出条数() -> None:
    """世界侧还没有「一批命令按序结算」。悄悄丢掉第二条比明确只做第一条更坏。"""
    response = post(
        client_with(
            commands(
                {"command": "weather.set", "args": {"value": "rain"}},
                {"command": "weather.set", "args": {"value": "storm"}},
            )
        )
    )
    body = response.json()
    assert body["intent"] == {"kind": "setWeather", "weather": "rain"}
    assert body["dropped"] == 1


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
    response = post(
        client_with(
            commands({"command": "npc.setSchedule", "args": {"id": "v0", "schedule": "garden"}})
        )
    )
    assert response.json()["intent"]["kind"] == "unknown"


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
