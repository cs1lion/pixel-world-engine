"""实验脚本自身的算术。

不测模型——模型不是我们能测的东西。测的是：

1. 用例覆盖到票面要求的四类，条数够。
2. **没跑成的实验不许有百分比。** 这是最要紧的一条：一份写着
   「越界被拒率 100%」的空表，比没有表坏得多。
3. 判定标准对四类各自是否正确。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import intent_experiment as experiment  # noqa: E402
from oracle import wire  # noqa: E402


def test_用例覆盖四类且条数够() -> None:
    # 票面要求：六条命令各 5 条以上、越界 10 条以上、闲聊 10 条以上、歧义 5 条以上。
    assert len(experiment.LEGAL) >= 24
    assert len(experiment.OUT_OF_BOUNDS) >= 10
    assert len(experiment.CHITCHAT) >= 10
    assert len(experiment.AMBIGUOUS) >= 5


def test_合法的用例点到了每一条命令() -> None:
    covered = {expected for _, expected in experiment.LEGAL}
    assert covered == {
        "weather.set",
        "tide.setLevel",
        "building.add",
        "building.remove",
        "miracle.spawn",
        "npc.setSchedule",
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


@pytest.mark.parametrize("category", ["legal", "out-of-bounds", "chitchat", "ambiguous"])
def test_每一类都有判定标准_不会漏判(category: str) -> None:
    outcome = experiment.Outcome("x", category, "y", True, wire.unknown_intent("z"), "", None)
    assert isinstance(experiment.classify(outcome), bool)
