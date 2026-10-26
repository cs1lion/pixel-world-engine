"""实验脚本自身的算术。

不测模型——模型不是我们能测的东西。测的是：

1. 用例覆盖到票面要求的四类，条数够。
2. **没跑成的实验不许有百分比。** 这是最要紧的一条：一份写着
   「越界被拒率 100%」的空表，比没有表坏得多。
3. 判定标准对四类各自是否正确。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import intent_experiment as experiment  # noqa: E402
from oracle import wire  # noqa: E402


def test_用例覆盖四类且条数够() -> None:
    # 票面要求：五条世界能执行的命令各 5 条以上、越界 10 条以上、
    # 闲聊 10 条以上、歧义 5 条以上。
    assert len(experiment.LEGAL) >= 25
    assert len(experiment.OUT_OF_BOUNDS) >= 10
    assert len(experiment.CHITCHAT) >= 10
    assert len(experiment.AMBIGUOUS) >= 5


def test_每一条能执行的命令都至少有五条用例() -> None:
    """按命令分组再数一遍。总数够不代表每条都够——某一条只有两条用例时，
    它在表上那个「通过率」就是一个太小的分母。"""
    counts: dict[str, int] = {}
    for _, expected in experiment.LEGAL:
        counts[expected] = counts.get(expected, 0) + 1
    for command, count in counts.items():
        assert count >= 5, f"{command} 只有 {count} 条用例"


def test_合法的用例点到了每一条命令() -> None:
    """五条世界真能执行的命令各有用例。

    `npc.setSchedule` 不在里面：它在白名单里，但客户端与世界都还没有这条意图，
    拿它当「合法命令」测模型，测的是一个世界接不住的东西。它仍然在越界/歧义
    那一侧出现（「让她去农田那边待着」），因为用户的期待是真的。
    """
    covered = {expected for _, expected in experiment.LEGAL}
    assert covered == {
        "weather.set",
        "tide.setLevel",
        "building.add",
        "building.remove",
        "miracle.spawn",
    }


def test_没跑成的实验不许出现任何百分比() -> None:
    """空表写「100%」是最坏的形状：它看起来像一个结论。"""
    outcomes = [
        experiment.Outcome(text, category, expected, False, wire.unknown_intent("未配置"), "", "x")
        for text, expected, category in experiment.ALL_CASES
    ]
    doc = experiment.render(outcomes, "not-run", "**没有跑成**", ran=False)

    # 只看「结果」那一列：表头里有「必须 100%」这类要求说明，那不是结论。
    results = [
        line.split("|")[2].strip() for line in doc.splitlines() if line.startswith("| ") and "%" in line
    ]
    assert all("%" not in cell for cell in results), f"未运行的实验里出现了百分比：{results}"
    assert "未运行" in doc
    assert "这不是一次实验" in doc


def test_跑成了才有逐条表() -> None:
    outcomes = [
        experiment.Outcome(text, category, expected, True, {"kind": "setWeather"}, "", None)
        for text, expected, category in experiment.ALL_CASES
    ]
    doc = experiment.render(outcomes, "some-model", "跑完了")
    assert "## 逐条" in doc
    assert "%" in doc


def test_越界那条落到未知就算过() -> None:
    out_of_bounds = experiment.Outcome("把潮位调到 5", "out-of-bounds", "潮位越界", True,
                                      wire.unknown_intent("潮位必须在 0..1"), "", None)
    assert experiment.classify(out_of_bounds)

    leaked = experiment.Outcome("把潮位调到 5", "out-of-bounds", "潮位越界", True,
                                {"kind": "setTide", "level": 5, "durationMs": 1000}, "", None)
    assert not experiment.classify(leaked), "越界却给了命令，必须判失败"


def test_闲聊落到未知才算过() -> None:
    quiet = experiment.Outcome("今天好累", "chitchat", "闲聊", True, wire.unknown_intent("闲聊"), "", None)
    assert experiment.classify(quiet)

    acted = experiment.Outcome("今天好累", "chitchat", "闲聊", True,
                               {"kind": "setWeather", "weather": "rain"}, "", None)
    assert not experiment.classify(acted), "把闲聊当命令，必须判失败"


def test_合法命令认得出来就算过_不要求落成具体哪一条() -> None:
    # 「把那份报告弄一下」既可派活也可造楼，具体落哪条是模型的判断。
    # 实验只问「认得出来吗」，不在这里替它选答案。
    anywhere = experiment.Outcome("把那份报告弄一下", "legal", "dispatch", True,
                                  {"kind": "build", "templateId": "workshop_plot", "at": None}, "", None)
    assert experiment.classify(anywhere)


def test_用假模型能跑完整场_管线没有断() -> None:
    """真实模型没法在 CI 里跑，但**管线**必须能跑：提示词 → 解析 → 白名单 → 意图。

    用一个只会照抄用例的假模型跑几条，确认 `run_one` 与判定都通。
    """
    import json

    replies = {
        "下雨吧": json.dumps({"commands": [{"command": "weather.set", "args": {"value": "rain"}}]}),
        "把潮位调到 5": json.dumps(
            {"commands": [{"command": "tide.setLevel", "args": {"value": 5}}]}
        ),
        "今天好累": json.dumps({"commands": [], "narrative": "闲聊"}),
    }

    def fake(messages):
        return replies[messages[-1]["content"]]

    assert experiment.run_one("下雨吧", fake)[0] == {"kind": "setWeather", "weather": "rain"}
    assert experiment.run_one("把潮位调到 5", fake)[0]["kind"] == "unknown"
    assert experiment.run_one("今天好累", fake)[0]["kind"] == "unknown"


def _outcome(category: str, *, understood: bool, infra: bool = False):
    intent = wire.unknown_intent("没听懂") if not understood else {"kind": "setWeather", "weather": "rain"}
    return experiment.Outcome("x", category, "y", True, intent, "", "模型返回 429" if infra else None, infra)


@pytest.mark.parametrize("category", ["legal", "out-of-bounds", "chitchat"])
def test_每一类都有判定标准_不会漏判(category: str) -> None:
    """判定标准按类别不同，写在一处。

    早先这条只断言 `isinstance(classify(...), bool)`——那把 `classify` 换成
    `lambda o: True` 也照过，等于什么都没测。现在每一类都拿**听得懂**与
    **没听懂**两种结果各问一遍，这两个方向必须给出不同的答案。

    `ambiguous` 不在其中：那一类两种结果都算过（见下面单独那条），
    它对「听没听懂」本来就没有区分。
    """
    assert experiment.classify(_outcome(category, understood=True)) != experiment.classify(
        _outcome(category, understood=False)
    ), f"{category} 这一类对「听没听懂」没有区分，等于没有判定标准"


def test_合法命令认得出来就算过() -> None:
    """认出来就算过。具体落成哪条命令由模型判断，这里只要求不是 unknown。"""
    assert experiment.classify(_outcome("legal", understood=True))
    assert not experiment.classify(_outcome("legal", understood=False))


def test_越界请求必须被拒_闲聊不许当命令() -> None:
    """这两类是「不动手」才算过：落成任何合法形状都是漏判。"""
    assert experiment.classify(_outcome("out-of-bounds", understood=False))
    assert not experiment.classify(_outcome("out-of-bounds", understood=True))
    assert experiment.classify(_outcome("chitchat", understood=False))
    assert not experiment.classify(_outcome("chitchat", understood=True))


def test_歧义句不越界就行_硬做与装傻都算过() -> None:
    """含糊的时候「不动手」与「不动手地装傻」都算过——现在只可能落成这两种。"""
    assert experiment.classify(_outcome("ambiguous", understood=False))
    assert experiment.classify(_outcome("ambiguous", understood=True))


# ---------------------------------------------------------------- 没问成 ≠ 答了

def test_限流与5xx算基础设施故障() -> None:
    """首轮复跑就是这么废的：55 条里 27 条撞上并发上限，全部落成 unknown，
    于是「合法命令接受率」从 68% 掉到 23%——看着像模型退化，其实是没问成。"""
    assert experiment.is_infra_error('模型返回 429：{"error":{"message":"concurrency reached"}}')
    assert experiment.is_infra_error("模型超时 8s")
    assert experiment.is_infra_error("模型不可达：connect error")
    assert experiment.is_infra_error("模型返回 503：bad gateway")
    assert experiment.is_infra_error("模型返回的形状不认识：KeyError")


def test_模型自己的回答不算基础设施故障() -> None:
    """分不清这两者，一份限流造成的 92% 会被当成真的 92%，
    而读报告的人只会去改提示词。"""
    assert not experiment.is_infra_error(None)
    assert not experiment.is_infra_error("")
    assert not experiment.is_infra_error("模型返回的不是 JSON，没法当命令用")
    assert not experiment.is_infra_error("unsupported")
    assert not experiment.is_infra_error("潮位必须在 0..1，收到 5")


def test_模型报的数字不算限流() -> None:
    """早先 `_INFRA_MARKERS` 里有一个裸的 `"429"`，于是白名单拒收时写的那句
    「潮位必须在 0..1，收到 429.0」被当成限流——一场好端端跑完的实验交白卷。
    故障消息的数字都在固定位置上，认位置，不认全文。
    """
    assert not experiment.is_infra_error("tide.setLevel.value 必须在 0..1，收到 429.0")
    assert not experiment.is_infra_error("一次最多 1 条命令，收到 429 条")
    assert not experiment.is_infra_error("building.remove.instanceId 'a#429' 不在世界里")


def test_只有真的状态码才算_我们自己的错不算() -> None:
    """这条判据问的是「**模型开口了吗**」，不是「这是谁的锅」。

    `模型返回 <状态码>` 意味着 HTTP 那一层就没成功，模型一个字也没说。
    这种行记成实验数据就是造假。

    400 和 401 当然多半是我们的问题（请求形状不对、Key 轮换了）。可「是我们的
    问题」不等于「是模型对世界的判断」：一次 401 让 55 条全部落成 unknown，
    交出一份「合法命令接受率 0%」的报告——比一份「没能问成」的空表坏得多，
    因为前者有人会去改提示词，后者有人会去换 Key。

    早先这里断言 `401 不算没问成`，理由写的是「会把一次真实验藏成一张空表」。
    那句话是反的：Key 死了的时候根本没有实验，藏起来的也不是实验。
    """
    assert experiment.is_infra_error('模型返回 429：{"error":{"message":"concurrency reached"}}')
    assert experiment.is_infra_error("模型返回 503：bad gateway")
    assert experiment.is_infra_error("模型返回 500：internal")
    assert experiment.is_infra_error("模型返回 400：bad request")
    assert experiment.is_infra_error("模型返回 401：invalid api key")


def test_Key_死了会交出一张空表_而不是一份0接受的报告() -> None:
    """端到端钉住上一条的后果。

    复现过的真事：caller 每条都抛 `模型返回 401`，`main()` 回 0，
    文档写「一次完整跑完」，表上「合法命令接受率 0/26（0%）」。
    读那份文档的人会去改提示词——而提示词一个字都不用改。
    """
    cases = experiment.ALL_CASES[:6]

    def always_401(_messages):
        raise RuntimeError("模型返回 401：invalid api key")

    outcomes = [experiment.run_one(text, always_401) for text, _expected, _category in cases]
    assert all(infra for _i, _r, _e, infra in outcomes), "401 必须条条算没问成"

    rows = [
        experiment.Outcome(text, category, expected, False,
                           wire.unknown_intent("模型返回 401：invalid api key"), "", "模型返回 401", True)
        for (text, expected, category), (_i, _r, _e, infra) in zip(cases, outcomes)
    ]
    note = f"**没有跑成**：{sum(1 for row in rows if row.infra)} 条没能问成模型。"
    doc = experiment.render(rows, "not-run", note, ran=False)
    assert "未运行" in doc, "没能问成时不许出现百分比"
    # 「必须 100%」是表头里的**要求**，不是结论；查的是结论那一格。
    assert not re.search(r"\d+/\d+（\d+%）", doc), f"没能问成却交出了比率：\n{doc}"


def test_兜底那句异常算没问成_但不配得到重试() -> None:
    """`interpret` 最后那个 `except Exception` 捕到的是我们自己的 bug。

    它不是模型的回答，所以不能进表；它也不是限流，重试六次得到的还是同一个
    bug。这两个问题早先共用一个判据，于是它一边被算成数据、一边被重试一分半。
    """
    assert experiment.is_infra_error("模型调用失败：KeyError('choices')")
    assert not experiment.is_retryable("模型调用失败：KeyError('choices')")


def test_模型答得离谱不重试_也照样进表() -> None:
    """反方向：模型开口说了句胡话，那是**数据**，重试也没有第二句话。"""
    assert not experiment.is_infra_error("这句话太长了（500 字），最多 200 字")
    assert not experiment.is_retryable("这句话太长了（500 字），最多 200 字")


def test_重试与算不算数据是两个问题() -> None:
    """一张小表把两个判据的差别钉住，免得它们又合回去。

    | 故障 | 算数据？ | 重试？ |
    |---|---|---|
    | 429 / 5xx | 否 | 是 |
    | 400 / 401 | 否 | 否 |
    | 超时 / 不可达 | 否 | 是 |
    | 形状不认识 / 调用失败 | 否 | 否 |
    """
    table = [
        ("模型返回 429：concurrency", False, True),
        ("模型返回 503：bad gateway", False, True),
        ("模型返回 400：bad request", False, False),
        ("模型返回 401：invalid api key", False, False),
        ("模型超时 8s", False, True),
        ("模型不可达：connect error", False, True),
        ("模型返回的形状不认识：没 JSON", False, False),
        ("模型调用失败：KeyError", False, False),
        ("白名单拒收：越界", True, False),
    ]
    for message, is_data, retry in table:
        assert experiment.is_infra_error(message) is (not is_data), message
        assert experiment.is_retryable(message) is retry, message


def test_退避重试只重试基础设施故障() -> None:
    """别的错（比如模型答得离谱）重试没有意义——同样的输入还是同样的答案。"""
    calls: list[int] = []

    def flaky(messages):
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("模型返回 429：concurrency reached")
        return "第三次成了"

    wrapped = experiment.retrying(flaky, attempts=4, backoff_ms=1)
    assert wrapped([]) == "第三次成了"
    assert len(calls) == 3


def test_我们自己的bug不重试_哪怕它也算没问成() -> None:
    """「算不算数据」与「要不要退避」是两个问题，这条钉住后者的那一半。

    `模型调用失败：…` 是 `interpret` 最后那个 `except Exception` 捕到的——
    我们自己的 bug。它确实不是模型的回答（所以不能进表），可重试六次得到的
    还是同一个 bug，只是多烧一分半：55 条 × 1.5 分钟。

    早先 `retrying` 用的是 `is_infra_error`，于是这条被重试了。两个判据
    看起来一样，分开才有意义——而没有任何测试钉过重试那一半，所以它静悄悄地
    错了很久。这条数的是**调用次数**，不是判据本身。
    """
    calls: list[int] = []

    def our_bug(messages):
        calls.append(1)
        raise RuntimeError("模型调用失败：KeyError('choices')")

    wrapped = experiment.retrying(our_bug, attempts=6, backoff_ms=1)
    with pytest.raises(RuntimeError, match="choices"):
        wrapped([])
    assert len(calls) == 1, f"我们自己的 bug 被重试了 {len(calls)} 次"


def test_401不重试_等一分钟还是同样一句拒绝() -> None:
    """同上，另一种形状：Key 轮换了。请求一个字不改，再问六次还是 401。"""
    calls: list[int] = []

    def dead_key(messages):
        calls.append(1)
        raise RuntimeError("模型返回 401：invalid api key")

    wrapped = experiment.retrying(dead_key, attempts=6, backoff_ms=1)
    with pytest.raises(RuntimeError, match="401"):
        wrapped([])
    assert len(calls) == 1


def test_重试次数用完就抛_不悄悄当成模型的回答() -> None:
    def always_429(messages):
        raise RuntimeError("模型返回 429：concurrency reached")

    wrapped = experiment.retrying(always_429, attempts=2, backoff_ms=1)
    with pytest.raises(RuntimeError, match="429"):
        wrapped([])


def test_非基础设施故障不重试() -> None:
    calls: list[int] = []

    def broken(messages):
        calls.append(1)
        raise ValueError("模型返回的不是 JSON")

    wrapped = experiment.retrying(broken, attempts=4, backoff_ms=1)
    with pytest.raises(ValueError, match="不是 JSON"):
        wrapped([])
    assert len(calls) == 1, "答得不对重试也没用，别浪费时间与配额"


def test_把重试关成_0_是零次重试_不是崩掉() -> None:
    """`EXPERIMENT_RETRIES=0` 的意思是不重试。不夹那一下 `max(1, ...)`，
    `range(0)` 空转，末尾那句 raise 拿着 `None` 去抛 TypeError——
    想关重试的人看到的是一场崩掉的实验，而不是零次重试。
    """
    calls: list[int] = []

    def rate_limited(messages):
        calls.append(1)
        raise RuntimeError("模型返回 429：concurrency reached")

    wrapped = experiment.retrying(rate_limited, attempts=0, backoff_ms=1)
    with pytest.raises(RuntimeError, match="429"):
        wrapped([])
    assert len(calls) == 1


def test_run_one_把基础设施故障标出来() -> None:
    def rate_limited(messages):
        raise RuntimeError("模型返回 429：concurrency reached")

    intent, _raw, error, infra = experiment.run_one("下雨吧", rate_limited)
    assert intent["kind"] == "unknown"
    assert infra is True
    assert error is not None


def test_run_one_把模型的拒绝与故障分开() -> None:
    import json

    def refuses(messages):
        return json.dumps({"commands": [], "narrative": "这是在闲聊"})

    _intent, _raw, error, infra = experiment.run_one("今天好累", refuses)
    assert error is None
    assert infra is False


def test_有没问成的条目时_render_不给百分比() -> None:
    """这一条是整个改动的理由：宁可交白卷，也不交一份把限流记成模型回答的数据。"""
    outcomes = [
        experiment.Outcome(text, category, expected, False, wire.unknown_intent("没问成"), "", "429", True)
        for text, expected, category in experiment.ALL_CASES
    ]
    doc = experiment.render(outcomes, "not-run", "**没有跑成**：55/55 条没能问成模型。", ran=False)
    results = [
        line.split("|")[2].strip() for line in doc.splitlines() if line.startswith("| ") and "%" in line
    ]
    assert all("%" not in cell for cell in results), f"没问成的实验里出现了百分比：{results}"
    assert "没能问成" in doc


def test_说明段里不出现百分号() -> None:
    """`render()` 里那条 `%` 断言只扫表格行。散文里的百分比扫不到，
    而「越界被拒 92%」这种句子看起来跟一个真结论一模一样——
    下一次有人改说明文字时就会把它加回来，所以在这里钉住。

    表头里的「必须 100%」是要求，不是结论，允许出现在表格行里。

    **先证明这段散文真的在文档里。** `list += str` 会把解释逐字拆开，
    于是散文变成一个字一行——那条检查就一个字一个字地扫过去，什么都查不到。
    所以这里先钉住「说明段是成行的文字」，再查百分号。
    """
    outcomes = [
        experiment.Outcome(text, category, expected, True, {"kind": "setWeather"}, "", None)
        for text, expected, category in experiment.ALL_CASES
    ]
    doc = experiment.render(outcomes, "some-model", "跑完了")
    prose = [line for line in doc.splitlines() if not line.startswith("| ")]
    offenders = [line for line in prose if "%" in line]
    assert not offenders, f"说明段里出现了百分号：{offenders}"
    long_lines = [line for line in prose if len(line) > 20]
    assert long_lines, "说明段被拆成一个字一行了，那条百分号检查会因此什么都查不到"
    assert any("首轮" in line for line in prose), "解释段整段不见了"


def test_带换行的备注不会把文档结构撑破() -> None:
    """`note` 会被塞进三处：`- 备注：`（列表项）、`> `（引用）、以及
    `unknown_intent(note)`（普通字符串）。第三处不怕换行，前两处怕。

    一个 `\\n\\n` 会让列表在中间断掉、引用塌成普通段落，「没能问成的有哪些」
    那一串就夹在两段引用之间，读起来像正文。现在的代码路径都只产出单行
    备注，所以这条钉的是**渲染器的 robustness**：备注的内容不该由 `render()`
    的调用方保证，那正是它自己要处理的事。

    信息一点没丢——折行只是排版，用空格接回去是同一句话。
    """
    note = "**没有跑成**：27 条没能问成模型。\n\n没问成的：下雨吧、放晴、来场暴雨"
    outcomes = [
        experiment.Outcome(text, category, expected, False, {"kind": "unknown"}, "", note, True)
        for text, expected, category in experiment.ALL_CASES[:4]
    ]
    doc = experiment.render(outcomes, "not-run", note, ran=False)
    bullet = [line for line in doc.splitlines() if line.startswith("- 备注：")]
    quoted = [line for line in doc.splitlines() if line.startswith(">")]
    assert len(bullet) == 1, f"备注把列表撑破了：{bullet}"
    assert quoted and all(line.startswith(">") for line in quoted), f"备注把引用撑破了：{quoted}"
    # 内容没丢：接回去还认得出原文。
    joined = " ".join(part.strip() for part in note.splitlines() if part.strip())
    assert joined in bullet[0]


def test_重渲染不调模型_且说清数据是哪一次的(tmp_path) -> None:
    """改了说明文字之后，不该为了两行字再烧 55 次调用。

    但重渲染出来的表必须自己说明「模型没有重新跑」——否则一份三天前的
    数据会被当成今天的结论读，而表上一个字都看不出来。
    """
    import json

    dump = tmp_path / "dump.json"
    dump.write_text(
        json.dumps(
            [
                {
                    "text": text,
                    "category": category,
                    "expected": expected,
                    "ok": True,
                    "intent": {"kind": "setWeather"},
                    "raw_reply": "",
                    "error": None,
                }
                for text, expected, category in experiment.ALL_CASES
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    out = tmp_path / "doc.md"
    assert experiment._replay(dump, out) == 0
    doc = out.read_text(encoding="utf-8")
    assert "模型没有重新跑" in doc
    assert "## 逐条" in doc


def test_重渲染一份带着没问成条目的存档_仍然是空表(tmp_path) -> None:
    import json

    dump = tmp_path / "dump.json"
    dump.write_text(
        json.dumps(
            [
                {
                    "text": text,
                    "category": category,
                    "expected": expected,
                    "ok": False,
                    "intent": {"kind": "unknown"},
                    "raw_reply": "",
                    "error": "429",
                    "infra": True,
                }
                for text, expected, category in experiment.ALL_CASES
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    out = tmp_path / "doc.md"
    assert experiment._replay(dump, out) == 2, "带着没问成的条目必须按没跑成处理，并给出非零退出码"
    doc = out.read_text(encoding="utf-8")
    results = [
        line.split("|")[2].strip() for line in doc.splitlines() if line.startswith("| ") and "%" in line
    ]
    assert all("%" not in cell for cell in results)


def test_撞了限流的那一场也把逐条存档留下(tmp_path, monkeypatch) -> None:
    """早先 `return 2` 排在 `if args.dump` 前面，于是没跑成的那一回什么都不留——
    而下一次想改说明文字、用 `--replay` 重渲染时，手里只剩一份空表。
    存档是留证据，不是只留好看的那些证据。
    """
    import json

    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_MODEL", "fake-model")
    monkeypatch.setenv("EXPERIMENT_RETRIES", "1")
    monkeypatch.setenv("EXPERIMENT_BACKOFF_MS", "1")
    monkeypatch.setattr(experiment, "load_env", lambda *a, **k: [])

    def rate_limited(_messages):
        raise RuntimeError("模型返回 429：concurrency reached")

    monkeypatch.setattr(experiment, "_caller_factory", lambda: (rate_limited, None))

    dump = tmp_path / "dump.json"
    out = tmp_path / "doc.md"
    monkeypatch.setattr(
        experiment.sys,
        "argv",
        ["intent_experiment.py", "--limit", "2", "--out", str(out), "--dump", str(dump)],
    )
    assert experiment.main() == 2
    rows = json.loads(dump.read_text(encoding="utf-8"))
    assert len(rows) == 2
    assert all(row["infra"] for row in rows), "没问成的条目要带着 infra 存档，重渲染时才认得出"


def test_哨子那一场说清自己只跑了一组(tmp_path) -> None:
    """`--only out-of-bounds` 是给「必须 100%」配的快跑。

    它快，所以容易变成默认动作。危险在于它跑出来的文档**带着全套那几段解释**，
    而那一场只问过一组——读的人分不清哪几组这一场问过模型。
    所以「用例」那一行按实际跑了多少写，备注也要点明。
    """
    outcomes = [
        experiment.Outcome(text, category, expected, True, {"kind": "unknown"}, "", None, False, False)
        for text, expected, category in experiment.ALL_CASES
        if category == "out-of-bounds"
    ]
    doc = experiment.render(outcomes, "m", "**只跑了out-of-bounds一组**（不是全套 55 条）。")
    assert "用例：12 条（越界 12）" in doc, "用例那一行按全长写，读的人会以为四组都测了"
    assert "合法 26" not in doc
    # 没跑的那三组不许出现百分比，只许是「—」。
    for label in ("合法命令接受率", "闲聊误判率（正确地不动）", "歧义句不越界率"):
        line = next(item for item in doc.splitlines() if item.startswith(f"| {label} |"))
        assert "0/0（—）" in line, f"{label} 这一场没跑，却给了个数：{line}"


def test_只跑一组时不许多写进全套那一份(monkeypatch) -> None:
    """一场 12 条的哨子把 `docs/INTENT_EXPERIMENT.md` 盖掉，是最坏的一种覆盖：

    标题还是那个标题，四张表还在，只是另外三组变成 0/0。读的人无从分辨。
    所以 `--only` 配默认 `--out` 直接报错，逼人另给一个路径。

    `parser.error` 抛 SystemExit(2)，所以这条断言的就是「它确实拦住了」。
    少了这一条，上一段话只是注释——把守卫删掉，测试照样全绿。
    """
    monkeypatch.setattr(sys, "argv", ["intent_experiment.py", "--only", "out-of-bounds"])
    with pytest.raises(SystemExit) as refused:
        experiment.main()
    assert refused.value.code == 2, "--only 写进默认路径时该被拦住"
