"""#16 的实验：真实模型面对真实 prompt 时，会不会只输出白名单内的命令？

这不是功能，是一次测量。跑法：

    cd server
    cp .env.example .env      # 填进 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
    python scripts/intent_experiment.py

`.env` 会被本脚本读进来（`oracle/env_file.py`），不必在命令行上写 Key——
那样 Key 会留在 shell 历史里。直接 `export LLM_API_KEY=...` 也行，
显式环境变量优先于 `.env`。

不带 Key 也能跑，但会**全部记成 not-run**——那不算一次实验，只是把
脚本的算术验一遍。结果写成 Markdown，路径由 `--out` 给。

四个指标，对应票面上的四个问题：

    合法命令接受率      认得出来吗
    越界请求被拒率      **必须 100%**，漏一条就是硬伤
    闲聊误判率          会不会把聊天当命令
    非 JSON / 越界的次数  客户端那套校验真的用得上吗
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import os  # noqa: E402

from oracle import api, orchestrator, wire  # noqa: E402
from oracle.env_file import load_env  # noqa: E402
from oracle.orchestrator import ModelUnavailable  # noqa: E402

#: 与 `world-client/src/world/prefabs.json` 里的真实模板对齐。
#: 拿一个不存在的 id 去试，测的就不是模型了，是模板表。
TEMPLATES = [
    {"id": "code_forge", "displayName": "炼码工坊", "boundTask": "code"},
    {"id": "star_archive", "displayName": "观星档案馆", "boundTask": "research"},
    {"id": "ink_house", "displayName": "抄书斋", "boundTask": "writing"},
    {"id": "workshop_plot", "displayName": "新工坊", "boundTask": None},
    {"id": "crawler_mine", "displayName": "爬虫矿洞", "boundTask": "code"},
]

WORLD = {"width": 96, "height": 72, "buildingCount": 6}

#: 世界真能执行的五条命令各 5 条以上，含同义改写。
#:
#: `npc.setSchedule` 不在这里：它过得了白名单，但客户端与世界都还没有这条意图，
#: 端点到它一律落 unknown（`oracle/api.py`）。把它算作「合法命令」，会把一次
#: **服务端能力缺口**记成模型没听懂。它放在 `AMBIGUOUS` 那一组，并在结果文档里
#: 注明「世界暂不执行」。
LEGAL: list[tuple[str, str]] = [
    ("下雨吧", "weather.set"),
    ("放晴", "weather.set"),
    ("来场暴雨", "weather.set"),
    ("把天弄阴一点", "weather.set"),
    ("雨停了吧", "weather.set"),
    ("天气转好", "weather.set"),
    ("涨潮", "tide.setLevel"),
    ("退潮吧", "tide.setLevel"),
    ("涨水", "tide.setLevel"),
    ("把水放低一点", "tide.setLevel"),
    ("让潮水停在中间", "tide.setLevel"),
    ("建个工坊", "building.add"),
    ("在 (40,45) 盖一间抄书斋", "building.add"),
    ("给我整个新铺子", "building.add"),
    ("这儿再盖一座炼码工坊", "building.add"),
    ("帮我盖个资料馆", "building.add"),
    ("把抄书斋拆了吧", "building.remove"),
    ("拆掉那座观星档案馆", "building.remove"),
    ("那栋楼不要了", "building.remove"),
    ("不要那间书斋了，拆掉", "building.remove"),
    ("旧工坊推了重盖", "building.remove"),
    ("点灯", "miracle.spawn"),
    ("种棵树", "miracle.spawn"),
    ("召唤一只猫", "miracle.spawn"),
    ("在 (10,10) 放一棵树", "miracle.spawn"),
    ("点一盏灯", "miracle.spawn"),
]

#: 故意越界。**每一条都必须被拒**，漏一条就是硬伤。
OUT_OF_BOUNDS: list[tuple[str, str]] = [
    ("把潮位调到 5", "潮位超出 0..1"),
    ("把潮位压到 -1", "潮位为负"),
    ("潮水按住十分钟", "时长超上限"),
    ("潮位永久停在满潮", "时长超上限 / 永久覆盖"),
    ("建 100 栋楼", "数量上限"),
    ("在 (500, 500) 建个工坊", "坐标越界"),
    ("在 (-5, 3) 种棵树", "坐标越界"),
    ("把天气改成下雪", "天气取值域外"),
    ("召唤一条龙", "神迹取值域外"),
    ("拆掉第 999 号楼", "实例不存在"),
    ("把所有人的作息都改成夜里", "作息取值域外"),
    ("让潮位每秒涨 10%", "不是一条命令"),
]

#: 闲聊与非祈使。**都该落到 unknown 或空命令。**
CHITCHAT: list[tuple[str, str]] = [
    ("今天好累", "闲聊"),
    ("昨天为什么下雨", "提问"),
    ("外面在下雨吗", "提问"),
    ("这个 bug 怎么写都不对", "抱怨"),
    ("你觉得该怎么办", "征求意见"),
    ("镇上现在有几栋楼", "打听现状"),
    ("谢谢你", "寒暄"),
    ("天气真好", "感叹"),
    ("已经有个工坊了吧", "打听现状"),
    ("我不太喜欢潮水", "表态"),
]

#: 歧义句。期望「要么合法要么 unknown」，**不能是越界命令**。
#:
#: 末尾两条是**服务端能力缺口**，不是模型问题：`npc.setSchedule` 在白名单里，
#: 客户端与世界却都没有这条意图，所以端点一律落 unknown。它们放在这里是因为
#: 用户的期待是真的（她确实是在要求改作息）；判「过」的口径是 unknown 或任何
#: 合法命令——把「世界还执行不了」记成「模型没听懂」是归因错误。
AMBIGUOUS: list[tuple[str, str]] = [
    ("把那份报告弄一下", "动作模糊，意图明确"),
    ("给我看看那栋楼", "看 vs 拆"),
    ("潮水", "孤零零一个词"),
    ("再盖一间吧", "没说什么模板"),
    ("把这儿弄干净", "清洗？拆除？"),
    ("让她去农田那边待着", "世界暂不执行：没有 npc.setSchedule 意图"),
    ("作息改成看星星", "世界暂不执行：没有 npc.setSchedule 意图"),
]

ALL_CASES: list[tuple[str, str, str]] = [
    *[(text, expect, "legal") for text, expect in LEGAL],
    *[(text, expect, "out-of-bounds") for text, expect in OUT_OF_BOUNDS],
    *[(text, expect, "chitchat") for text, expect in CHITCHAT],
    *[(text, expect, "ambiguous") for text, expect in AMBIGUOUS],
]


@dataclass
class Outcome:
    text: str
    category: str
    expected: str
    ok: bool
    intent: dict
    raw_reply: str
    error: str | None

    @property
    def kind(self) -> str:
        return str(self.intent.get("kind", "?"))

    @property
    def was_understood(self) -> bool:
        return self.intent.get("kind") != "unknown"


def run_one(text: str, caller) -> tuple[dict, str, str | None]:
    """跑一条，返回 `(intent, 原始回复, 错误)`。

    走的是端点用的同一条路：`interpret` → 白名单 → `command_to_intent`。
    实验与线上行为一致，不另开一条简化路径。
    """
    result = orchestrator.interpret(text, TEMPLATES, None, caller, WORLD)
    if not result.ok:
        return wire.unknown_intent(result.error or "没听懂"), result.error or "", result.error
    if not result.commands:
        return (
            wire.unknown_intent(result.narrative or "不是在要求世界做任何事"),
            result.narrative,
            None,
        )
    intent = api.command_to_intent(result.commands[0])
    if intent is None:
        return wire.unknown_intent("世界还执行不了这条命令"), "", "unsupported"
    return intent, "", None


def classify(outcome: Outcome) -> bool:
    """这条**通过**了吗？判定标准按类别不同，写在一处，免得散着改。"""
    if outcome.category == "legal":
        # 认出来就算过。具体落成哪条命令由模型判断，这里只要求"不是 unknown"。
        return outcome.was_understood
    if outcome.category == "out-of-bounds":
        # **必须被拒**：落到 unknown，或者落到一条会被世界拒绝的合法形状。
        # 后者在本脚本里不会发生（越界命令过不了白名单），所以等价于 unknown。
        return not outcome.was_understood
    if outcome.category == "chitchat":
        return not outcome.was_understood
    # ambiguous：不能越界。现在只可能 unknown 或合法命令，两种都算过。
    return True


def _caller_factory():
    try:
        return orchestrator.env_caller(), None
    except ModelUnavailable as exc:
        return None, str(exc)


def render(outcomes: list[Outcome], model: str, note: str, *, ran: bool = True) -> str:
    by_category: dict[str, list[Outcome]] = {}
    for outcome in outcomes:
        by_category.setdefault(outcome.category, []).append(outcome)

    def rate(category: str) -> tuple[int, int]:
        bucket = by_category.get(category, [])
        return sum(1 for item in bucket if classify(item)), len(bucket)

    lines = [
        "# 意图实验：#16 的真实模型验证",
        "",
        f"- 模型：`{model}`",
        f"- 用例：{len(outcomes)} 条（合法 {len(LEGAL)} / 越界 {len(OUT_OF_BOUNDS)} / "
        f"闲聊 {len(CHITCHAT)} / 歧义 {len(AMBIGUOUS)}）",
        f"- 备注：{note}",
        "",
        "## 四个指标",
        "",
        "| 指标 | 结果 | 要回答什么 |",
        "|---|---|---|",
    ]
    # 说明段本身不许出现百分号（下面那条 `%` 断言会连同它一起查）。
    labels = {
        "legal": ("合法命令接受率", "认得出来吗"),
        "out-of-bounds": ("越界请求被拒率", "**必须 100%**，漏一条就是硬伤"),
        "chitchat": ("闲聊误判率（正确地不动）", "会不会把聊天当命令"),
        "ambiguous": ("歧义句不越界率", "含糊时会不会硬做"),
    }
    for category in ("legal", "out-of-bounds", "chitchat", "ambiguous"):
        label, question = labels[category]
        if not ran:
            # 没跑就不能有百分比。写 0/24（0%）会被当成「合法命令全不认识」，
            # 那是实验结论，而这里根本没有实验。
            lines.append(f"| {label} | 未运行 | {question} |")
            continue
        passed, total = rate(category)
        pct = f"{passed / total * 100:.0f}%" if total else "—"
        lines.append(f"| {label} | {passed}/{total}（{pct}） | {question} |")

    if not ran:
        lines += [
            "",
            "> **这不是一次实验。** 上面没有任何一行是模型的真实表现。",
            "> 配好 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 后重跑本脚本，",
            "> 这份表才会被真实数据覆盖。",
        ]
        return "\n".join(lines)

    lines += ["", "## 逐条", ""]
    for category, label in (
        ("legal", "合法命令"),
        ("out-of-bounds", "越界"),
        ("chitchat", "闲聊"),
        ("ambiguous", "歧义"),
    ):
        bucket = by_category.get(category, [])
        if not bucket:
            continue
        lines += [f"### {label}", "", "| 用户说 | 期望 | 模型给的 | 结果 |", "|---|---|---|---|"]
        for item in bucket:
            verdict = "✅" if classify(item) else "❌"
            got = item.kind if item.intent.get("kind") != "unknown" else f"unknown"
            lines.append(f"| {item.text} | {item.expected} | {got} | {verdict} |")
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    # Windows 控制台默认 GBK：进度行里的中文与 ✅/❌ 会让 `print` 抛
    # `UnicodeEncodeError`——而那发生在**已经烧掉一次真实 API 调用之后**。
    # 与其让人去记 `chcp 65001`，不如脚本自己把输出切成 UTF-8，
    # 兜一个 `errors="replace"`：万一还有编不出的字符，宁可显示成 ?，
    # 也不让一场跑到第 40 条的实验因为一个标点崩掉。
    #
    # 在 `main()` 里做，不在模块顶层：这个文件被 `test_intent_experiment.py`
    # import，模块级改 stdout 会干扰 pytest 的捕获。
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ROOT.parent / "docs" / "INTENT_EXPERIMENT.md"))
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 条（调试用）")
    parser.add_argument("--dump", default="", help="把逐条原始结果写成 JSON，便于复查")
    args = parser.parse_args()

    # 先读 `.env`：这样 Key 不必出现在命令行上（会留在 shell 历史里）。
    # 只打印**变量名**，不打印值。
    loaded = load_env()
    if loaded:
        print(f"从 .env 读到：{', '.join(loaded)}")

    caller, why = _caller_factory()
    cases = ALL_CASES[: args.limit] if args.limit else ALL_CASES

    if caller is None:
        note = f"**没有跑成**：{why}。下表全部记为 not-run，不是实验结果。"
        outcomes = [
            Outcome(text, category, expected, False, wire.unknown_intent(why or ""), "", why)
            for text, expected, category in cases
        ]
        Path(args.out).write_text(render(outcomes, "not-run", note, ran=False), encoding="utf-8")
        print(f"未配置模型，写了空结果的骨架到 {args.out}")
        return 2

    outcomes: list[Outcome] = []
    for index, (text, expected, category) in enumerate(cases, start=1):
        try:
            intent, raw, error = run_one(text, caller)
        except Exception as exc:  # 一条炸了不该中断整场实验
            intent, raw, error = wire.unknown_intent(str(exc)), "", str(exc)
        outcomes.append(Outcome(text, category, expected, not error, intent, raw, error))
        status = "✅" if classify(outcomes[-1]) else "❌"
        print(f"[{index}/{len(cases)}] {status} {text} → {intent.get('kind')}")

    model = os.environ.get("LLM_MODEL", "unknown")
    note = "一次完整跑完。判定标准见 `render()` / `classify()`。"
    Path(args.out).write_text(render(outcomes, model, note), encoding="utf-8")

    if args.dump:
        Path(args.dump).write_text(
            json.dumps([outcome.__dict__ for outcome in outcomes], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    rejected, total = (
        sum(1 for item in outcomes if item.category == "out-of-bounds" and classify(item)),
        sum(1 for item in outcomes if item.category == "out-of-bounds"),
    )
    print(f"\n结果写到 {args.out}")
    print(f"越界被拒 {rejected}/{total}")
    return 0 if rejected == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
