"""造物主：模型回了什么，世界就做什么——或者明确说没听懂。

这里**不调真实模型**。`ModelCaller` 是注入的，所以每条分支都能离线钉住。
真实模型的实验在 `scripts/intent_experiment.py`，结果记在 `docs/`。
"""

from __future__ import annotations

import json

import pytest

from oracle import orchestrator
from oracle.orchestrator import MAX_COMMANDS, ModelFailed, ModelUnavailable, interpret
from oracle.prompt import build_messages, build_system_prompt

TEMPLATES = [
    {"id": "code_forge", "displayName": "炼码工坊", "boundTask": "code"},
    {"id": "workshop_plot", "displayName": "新工坊", "boundTask": None},
]


def caller(reply: str):
    """一个只回一句话的假模型。它记下收到的 messages 供断言。"""
    calls: list[list[dict[str, str]]] = []

    def call(messages):
        calls.append(messages)
        return reply

    call.calls = calls  # type: ignore[attr-defined]
    return call


def reply(*commands: dict) -> str:
    return json.dumps({"commands": list(commands), "narrative": "听懂了"})


WEATHER_RAIN = {"command": "weather.set", "args": {"value": "rain"}}


# ---------------------------------------------------------------- 成功路径

def test_一条天气命令走到_command() -> None:
    result = interpret("下雨吧", TEMPLATES, None, caller(reply(WEATHER_RAIN)))
    assert result.ok
    assert [c.name for c in result.commands] == ["weather.set"]
    assert result.commands[0].args == {"value": "rain"}


def test_拨潮带上时长_不是永久的() -> None:
    result = interpret(
        "把潮水涨起来",
        TEMPLATES,
        None,
        caller(reply({"command": "tide.setLevel", "args": {"value": 1, "durationMs": 30_000}})),
    )
    assert result.ok
    assert result.commands[0].args == {"value": 1, "durationMs": 30_000}


def test_命令可以为空_那不是失败() -> None:
    """模型说「这不是命令」是一个正常结果，与「模型坏了」是两回事。"""
    result = interpret(
        "今天好累",
        TEMPLATES,
        None,
        caller(json.dumps({"commands": [], "narrative": "在闲聊"})),
    )
    assert result.ok
    assert result.commands == []
    assert result.narrative == "在闲聊"


def test_只给_narrative_不给_commands_也算听懂了但不动() -> None:
    result = interpret("嗯", TEMPLATES, None, caller(json.dumps({"narrative": "没什么要做的"})))
    assert result.ok
    assert result.commands == []


def test_模型裹了代码块也能取出来() -> None:
    wrapped = "```json\n" + reply(WEATHER_RAIN) + "\n```"
    result = interpret("下雨吧", TEMPLATES, None, caller(wrapped))
    assert result.ok, "剥围栏是合理宽容——它不是形状错误，是包裹"


# ---------------------------------------------------------------- 失败必须不猜

@pytest.mark.parametrize(
    "bad",
    ["好的，我这就下雨", "", "{\"commands\": [", "不是 JSON"],
)
def test_非_JSON_落_not_json_不猜(bad: str) -> None:
    result = interpret("下雨吧", TEMPLATES, None, caller(bad))
    assert not result.ok
    assert result.code == "not-json"
    assert result.commands == []


def test_模型抛错落_model_failed() -> None:
    def boom(_messages):
        raise ModelFailed("超时 8s")

    result = interpret("下雨吧", TEMPLATES, None, boom)
    assert not result.ok
    assert result.code == "model-failed"
    assert "超时" in (result.error or "")


def test_没有_Key_继续往上抛而不是当成没听懂() -> None:
    """503 与「没听懂」是两回事：前者要人去配 Key，后者用户换句话就行。"""

    def unavailable(_messages):
        raise ModelUnavailable("未配置 LLM_API_KEY")

    with pytest.raises(ModelUnavailable):
        interpret("下雨吧", TEMPLATES, None, unavailable)


@pytest.mark.parametrize(
    "command, code",
    [
        ({"command": "weather.summon", "args": {}}, "unknown-command"),
        ({"command": "weather.set", "args": {"value": "snow"}}, "out-of-domain"),
        ({"command": "tide.setLevel", "args": {"value": 5}}, "out-of-range"),
        (
            {"command": "tide.setLevel", "args": {"value": 1, "durationMs": 600_000}},
            "duration-too-long",
        ),
        ({"command": "building.remove", "args": {}}, "missing-field"),
    ],
)
def test_越界命令带着错误码回来(command: dict, code: str) -> None:
    result = interpret("随便", TEMPLATES, None, caller(reply(command)))
    assert not result.ok
    assert result.code == code
    assert result.commands == []


def test_越界时连合法的那条也不执行() -> None:
    """一条不合法就整串拒：办了两条、丢了一条的世界，谁也没要求过。"""
    result = interpret(
        "随便",
        TEMPLATES,
        None,
        caller(reply(WEATHER_RAIN, {"command": "weather.summon", "args": {}})),
    )
    assert not result.ok
    assert result.commands == []


def test_一次只收一条命令_多了整条拒() -> None:
    """世界侧没有「一批命令按序结算」。多给的命令**不能悄悄丢掉**——
    用户说了两件事，世界只做了一件却说办完了，比拒掉更坏。"""
    assert MAX_COMMANDS == 1
    many = [WEATHER_RAIN] * (MAX_COMMANDS + 1)
    result = interpret("随便", TEMPLATES, None, caller(reply(*many)))
    assert not result.ok
    assert result.code == "too-many-commands"
    assert result.commands == []


def test_空句子与超长句子在调模型之前就被拒() -> None:
    spy = caller(reply(WEATHER_RAIN))
    assert interpret("   ", TEMPLATES, None, spy).code == "empty-utterance"
    assert interpret("雨" * 600, TEMPLATES, None, spy).code == "utterance-too-long"
    assert spy.calls == [], "这两种不该花一次模型调用"


def test_没有模板表就不问模型() -> None:
    spy = caller(reply(WEATHER_RAIN))
    assert interpret("建个工坊", [], None, spy).code == "no-templates"
    assert spy.calls == []


# ---------------------------------------------------------------- 提示词

def test_提示词列出每一条模板与每一种世界能执行的命令() -> None:
    prompt = build_system_prompt(TEMPLATES)
    for item in TEMPLATES:
        assert item["id"] in prompt
        assert item["displayName"] in prompt
    for command in (
        "weather.set",
        "tide.setLevel",
        "building.add",
        "building.remove",
        "miracle.spawn",
    ):
        assert command in prompt, f"提示词没讲 {command}"


def test_提示词不列世界办不到的命令() -> None:
    """`npc.setSchedule` 在白名单里，但客户端与世界都还没有这条意图。

    把它写进提示词，等于让模型去说一件世界办不到的事——用户看到「听懂了」，
    世界什么也没做。白名单管合法性，提示词管能力声明，两层不能混。
    """
    prompt = build_system_prompt(TEMPLATES)
    assert "npc.setSchedule" not in prompt
    assert "只输出下面五种之一" in prompt


def test_提示词禁止模型自己改数() -> None:
    # 把「潮位调到 5」悄悄改成 1 再回「办好了」，是这套设计最怕的失败。
    assert "不要自己改数" in build_system_prompt(TEMPLATES)
    assert "越界就照实输出" in build_system_prompt(TEMPLATES)


def test_提示词把时长上限写出来() -> None:
    prompt = build_system_prompt(TEMPLATES)
    assert "120000" in prompt
    assert "durationMs" in prompt


def test_消息是_system_加_user_两条_user_就是原话() -> None:
    messages = build_messages(TEMPLATES, "帮我写个爬虫")
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "帮我写个爬虫"}, "不许改写用户原话"


def test_世界现状进了提示词_且三档天气各说各的() -> None:
    for weather, fragment in (("clear", "天晴"), ("rain", "在下雨"), ("storm", "暴雨")):
        prompt = build_system_prompt(TEMPLATES, {"weather": weather})
        assert fragment in prompt, f"{weather} 没说出来"


def test_没有现状时整段不出现_也不写未知() -> None:
    prompt = build_system_prompt(TEMPLATES)
    assert "世界现在长什么样" not in prompt
    assert "未知" not in prompt


# ---------------------------------------------------------------- 提取 JSON

def test_extract_json_不猜花括号在哪() -> None:
    """从一段散文里截出花括号是最坏的做法：它会把
    「我觉得可以这样」里的括号当成 JSON 的开始。"""
    assert orchestrator.extract_json('我觉得可以 {"a": 1} 这样') is None
    assert orchestrator.extract_json('{"a": 1}') == {"a": 1}
    assert orchestrator.extract_json("```\n{\"a\": 1}\n```") == {"a": 1}
