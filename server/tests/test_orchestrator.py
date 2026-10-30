"""造物主：模型回了什么，世界就做什么——或者明确说没听懂。

这里**不调真实模型**。`ModelCaller` 是注入的，所以每条分支都能离线钉住。
真实模型的实验在 `scripts/intent_experiment.py`，结果记在 `docs/`。
"""

from __future__ import annotations

import json
import re

import pytest

from oracle import orchestrator
from oracle.orchestrator import MAX_COMMANDS, ModelFailed, ModelUnavailable, interpret
from oracle.prompt import COMMAND_LINES, build_messages, build_system_prompt
from rules.schema import COMMAND_CHECKS

#: COMMAND_LINES 里每条形如 `- {"command":"weather.set","args":{...}}`。
#: 数它，是为了让「提示词说有几种」这个数从正文里长出来，而不是谁的手写。
COMMAND_IN_LINES = re.compile(r'\{"command":"([a-zA-Z.]+)"')

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


def test_json_抛_RecursionError_时落_not_json_不是_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`json` 的解析器是递归的，层数够深它会抛 `RecursionError`。

    它是 `RuntimeError` 的子类，**不在** `extract_json` 原来那个
    `(json.JSONDecodeError, ValueError)` 里。而 `parse_reply` 在 `interpret` 那个
    try 的**外面**（那句 `except Exception` 兜的是 `caller`，不是我们自己的代码），
    于是这个错一路直达端点——线上协议多出第五种失败面 500，而模块开头冻住的只有
    503 / 422 / 200+unknown 三种。

    几千层嵌套在用户眼里就是「这不是能用的 JSON」，与「非 JSON」同一件事，
    所以它该落在 `not-json` 上，跟上面那条参数化测试同一种结局。

    **2026-10-30 修：这条原来靠真的塞 `"[" * 5000` 去撞深度，那样钉的是解释器，
    不是我们的代码。** CI 上 Python 3.12.15 在 5000 层**解析成功**（返回一个
    list，于是落 `not-an-object`），本机 3.12.4 在 2998 层抛 `RecursionError`
    ——同一份代码，两台机器一红一绿，而 CI 从 10-28 起一直红着。
    `json` 走的是 C 扫描器，`sys.setrecursionlimit()` 管不到它，阈值是编译期定
    的、跨小版本会动。所以这里改成**注入**：让 `json.loads` 直接抛
    `RecursionError`，钉住「我们接住了它」这件事本身，不再赌解释器在哪一层炸。
    """
    def boom(*_args: object, **_kwargs: object) -> object:
        raise RecursionError("simulated deep nesting")

    monkeypatch.setattr(orchestrator.json, "loads", boom)
    result = interpret("下雨吧", TEMPLATES, None, caller("[" * 5_000 + "]" * 5_000))
    assert not result.ok
    assert result.code == "not-json"
    assert result.commands == []


def test_极深的嵌套数组即使解析成了也不是对象() -> None:
    """上面那条钉「接住了 `RecursionError`」。这条钉另一边。

    如果换一台机器的解释器能把这 5000 层解析出来（返回的是 `list`），那也不该
    落成 500——`extract_json` 返回的不是 `dict`，`parse_reply` 落 `not-an-object`。
    两种结局都是「没听懂」，差别只在 `code` 这个给实验统计用的字符串上。

    这条不依赖解释器深度：`[]` 在哪种解释器上都解析得成、都不是对象。
    """
    result = orchestrator.parse_reply("[]")
    assert not result.ok
    assert result.code == "not-an-object"
    assert result.commands == []


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

def test_提示词列出每一种模板() -> None:
    """模板表是前端发来的，提示词负责把它写进去——漏一个，模型就建不出那一栋。"""
    prompt = build_system_prompt(TEMPLATES)
    for item in TEMPLATES:
        assert item["id"] in prompt
        assert item["displayName"] in prompt


def test_提示词列出每一种世界能执行的命令() -> None:
    """除了一条客户端还表达不了的，白名单里每一条命令提示词都得讲。

    从前这里写死五个名字，于是 villager.carry 加进 COMMAND_LINES 时没有任何
    测试红——把那一行从提示词里删掉，全套照旧绿。提交信息却说「三处一起」。
    写死的表只钉住写表那天，所以这里从白名单问。
    """
    prompt = build_system_prompt(TEMPLATES)
    # `npc.setSchedule` 是合法的世界命令，但客户端与世界都还没有对应的意图，
    # 写进提示词就是让模型去说一件世界办不到的事（见下面那条）。
    expressible = sorted(set(COMMAND_CHECKS) - {"npc.setSchedule"})
    assert expressible, "白名单数不出来了——COMMAND_CHECKS 的形状变了"
    for command in expressible:
        assert command in prompt, f"提示词没讲 {command}"


def test_提示词不列世界办不到的命令() -> None:
    """`npc.setSchedule` 在白名单里，但客户端与世界都还没有这条意图。

    把它写进提示词，等于让模型去说一件世界办不到的事——用户看到「听懂了」，
    世界什么也没做。白名单管合法性，提示词管能力声明，两层不能混。
    """
    prompt = build_system_prompt(TEMPLATES)
    assert "npc.setSchedule" not in prompt


def test_提示词禁止模型自己改数() -> None:
    # 把「潮位调到 5」悄悄改成 1 再回「办好了」，是这套设计最怕的失败。
    assert "不要自己改数" in build_system_prompt(TEMPLATES)
    assert "越界就照实输出" in build_system_prompt(TEMPLATES)


def test_提示词把时长上限写出来() -> None:
    prompt = build_system_prompt(TEMPLATES)
    assert "120000" in prompt


def test_提示词把收那条路讲出来() -> None:
    """`remove` 是渡有仪式减法那一侧，提示词不讲，模型就走不到它。

    加 `remove` 的那次只改了 schema、wire 与 rules 三处，提示词里那句仍是
    「或收回（carries 给 [] 就是两手空空）」——正好在教模型用**整锅换上**
    去表达收一件。用户说「收回她的鞋」，模型答 carries:["shoes"]，
    她提着的灯跟着消失，而用户只要收鞋。

    上面那条 `test_提示词列出每一种世界能执行的命令` 只数命令**名**，
    args 写成什么样它一声不响。所以形状在这里单独钉。
    """
    prompt = build_system_prompt(TEMPLATES)
    assert '"remove"' in prompt, "提示词没讲 remove——模型只会给，不会收"
    # 两个键必须且只能给一个：这是 schema 与 rules 同一条规矩，提示词得说。
    assert "必须且只能给一个" in prompt
    # 那一句话不许回来：它把「放下一切」说成了「收一件」的办法。
    assert "carries 给 [] 就是两手空空" not in prompt


def test_提示词说清carries是整锅换上() -> None:
    """「给她一双鞋」与「收走她一双鞋」在 schema 里是两条路，提示词不能混。

    `setCarries` 是整体替换。提示词若只写「给她一件通行凭证」，
    模型会把所有交接都翻成 carries——包括收回。那句话必须在提示词里。
    """
    prompt = build_system_prompt(TEMPLATES)
    assert "整锅换上" in prompt, "提示词没说出 carries 是替换——模型会拿它表达减法"
    assert "durationMs" in prompt


def test_提示词说清了毫秒换算() -> None:
    # 「潮水按住十分钟」→ `durationMs: 60000`：十分钟被当成一分钟，
    # 而 60000 在上限之内，白名单完全合法地放行了。用户要十分钟，拿到一分钟。
    #
    # 这不是模型算错一次，是提示词从没说过单位怎么换。钉住这句，
    # 下一个人「精简提示词」时至少会看见一个红着的原因。
    prompt = build_system_prompt(TEMPLATES)
    assert "600000" in prompt, "提示词没写十分钟是多少毫秒——模型会自己折算一个"


def test_提示词不许把表里没有的现象换成邻居() -> None:
    # 「把天气改成下雪」→ `value: "rain"`。雪、雾、风、彩虹这个世界都没有。
    # 注意这一条**不是提示词的错**：天气那行从改之前就写着「表里没有的现象不许
    # 往邻居身上靠」，而且指名道姓举的就是「把天气改成下雪」这个例子。模型是在
    # 一句写着它名字的禁令上犯的事。所以这条断言钉的是「别把那句禁令精简掉」，
    # 不是「本轮修好了它」——后者从来没有发生过。
    # 用户要雪，拿到一场雨，还被告知「办好了」。
    prompt = build_system_prompt(TEMPLATES)
    assert "雪" in prompt and "不许往邻居身上靠" in prompt, (
        "提示词又允许把世界没有的现象往最近一档靠了——那正是「下雪」被换成雨的原因"
    )


def test_提示词说清永久不是可省略() -> None:
    # 「潮位永久停在满潮」→ `durationMs: 120000`。「可省略（省略时取上限）」
    # 被读成「永久 = 能多长就多长」，于是用户要「一直」，拿到两分钟。
    prompt = build_system_prompt(TEMPLATES)
    assert "永久" in prompt, "提示词没提「永久」——它会和「可省略」混在一起"
    assert "偷偷换成" in prompt, "提示词没点明不许把永久偷换成上限"


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
