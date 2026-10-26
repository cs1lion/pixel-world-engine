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
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import os  # noqa: E402

from events.log import EventLog
from events.projection import world_summary
from events.world_changes import WORLD_CHANGED
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

#: 实验用的世界摘要。**由一只真日志投影出来**，不是手写的常量。
#:
#: 早先这里是 `{"width": 96, "height": 72, "buildingCount": 6}`——没有建筑 id 列表，
#: 于是「拆掉第 999 号楼」这条越界用例**根本测不到它要测的东西**：白名单没有
#: 实例可查，只能放行，然后实验记一个 ❌，看起来像模型的问题。
#: 事实上那是服务端答不出「世界上有哪些楼」（见 `docs/INTENT_EXPERIMENT.md`）。
#:
#: 现在摘要与端点走同一条路：`world_summary` 从事件日志投影。实验因此钉的是
#: 生产路径本身，而不是一份写着像真的常量。
_BUILDING_IDS = ("code_forge#1", "star_archive#1", "ink_house#1", "workshop_plot#1", "crawler_mine#1", "ferry#1")

#: 上面那几个 id 的显示名。`ferry#1` 不在模板表里（渡口是设定集落的，不是玩家建的），
#: 但客户端一样会把它报上来——所以这里照样要有它。
_BUILDING_NAMES = {
    "code_forge": "炼码工坊",
    "star_archive": "观星档案馆",
    "ink_house": "抄书斋",
    "workshop_plot": "新工坊",
    "crawler_mine": "爬虫矿洞",
    "ferry": "渡口",
}

#: 渡口算野外（客户端 `WILD_PREFABS`），其余算镇内。分组要与客户端一致，
#: 否则 `render_context` 少说一栋，模型就少一个能抄的 id。
_WILD_IDS = frozenset({"ferry#1"})


def _client_context() -> dict:
    """造一份客户端会发的现状——形状与 `world-client/src/world/intent-context.ts`
    的 `summarizeForIntent` 对齐（`built.town` / `built.wild`，各带 instanceId）。

    **只有 `--with-context` 用。** 默认那场故意不发：那是线上更严的一侧，
    见 `_WHY_IT_CHANGED` 里「这份实验比线上更严」。加上这个开关不是为了
    把数字变好看，是为了让那段话**能被验**——不然「线上客户端两样都会发，
    模型本来就有现成的实例 id 可抄」只是一句没人试过的断言。
    """
    entries = [
        {
            "instanceId": instance_id,
            "templateId": instance_id.split("#", 1)[0],
            "name": _BUILDING_NAMES[instance_id.split("#", 1)[0]],
        }
        for instance_id in _BUILDING_IDS
    ]
    return {
        "built": {
            "town": [e for e in entries if e["instanceId"] not in _WILD_IDS],
            "wild": [e for e in entries if e["instanceId"] in _WILD_IDS],
        },
        "busy": [],
        "queued": 0,
        "weather": "clear",
    }



def _world() -> dict:
    log = EventLog(":memory:")
    for index, instance_id in enumerate(_BUILDING_IDS):
        log.append(
            kind=WORLD_CHANGED,
            actor="world",
            payload={"change": "building.built", "instanceId": instance_id, "prefabId": "code_forge", "displayName": "工坊"},
            at=float(index),
        )
    return world_summary(log, {"width": 96, "height": 72})


WORLD = _world()

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
    #: **这条没能问成模型**，不是模型的回答。限流、超时、5xx 都算。
    #: 它必须与「模型答了 unknown」分开：后者是实验数据，前者是基础设施故障。
    #: 把故障记成数据，一份「越界被拒 92%」的报告就可能是限流造成的，
    #: 而读的人只会去改提示词。
    infra: bool = False
    #: 这一场**发没发客户端现状**。严格与线上两侧的合法组数字差 3 条
    #: （见 `_WHY_IT_CHANGED` 里「这份实验比线上更严」），所以哪一侧跑出来的
    #: 必须跟着每条存档走。少了它，`--replay` 重渲染时只能说一句
    #: 「从上次的 dump」，而读的人分不清这是 21/26 那一场还是 24/26 那一场。
    with_context: bool = False

    @property
    def kind(self) -> str:
        return str(self.intent.get("kind", "?"))

    @property
    def was_understood(self) -> bool:
        return self.intent.get("kind") != "unknown"


#: 算基础设施故障的消息形状。与 `orchestrator.env_caller` / `interpret` 抛的消息对齐。
#:
#: 429 是真实会遇到的一种：StepFun 的并发上限是 8，同机另开一个实验就会撞上。
#: 首轮复跑就这么废掉过——55 条里 27 条限流，全部落成 unknown，
#: 于是「合法命令接受率」从 68% 掉到 23%，看着像模型退化，其实是没问成。
#:
#: **按消息的语法判，不按数字子串判。** 早先这里列了一个裸的 `"429"`，
#: 于是模型自己报的一个数也能命中：白名单拒收时写的那句
#: 「潮位必须在 0..1，收到 429.0」被当成限流，一场好端端跑完的实验交白卷。
#: 故障消息里的数字都在**固定位置**上——`模型返回 <状态码>：<响应体>`——
#: 所以从那个位置取，别全文找。
_STATUS = re.compile(r"模型返回 (\d+)")

#: 重试/退避有意义的那几个状态码。429 是并发上限，5xx 是服务端自己的事。
#: 别的 4xx（400 请求形状不对、401 Key 错了）是**我们**的问题——
#: 等一分钟再问，还是同样一句拒绝。
_RETRYABLE_STATUS = frozenset({408, 409, 425, 429})

#: 没有状态码的那几种故障。它们是消息**开头**的固定字样，不会与模型的数字撞上。
_INFRA_MARKERS = ("模型超时", "模型不可达", "模型返回的形状不认识", "模型调用失败")

#: 其中「等一等会有不同结果」的那几种。超时与不可达都是网络上的事，
#: 而「形状不认识」与「模型调用失败」是**代码里的事**——重试六次得到的
#: 还是同一个 bug，只是多烧一分半。后者仍然算「没问成」（见 `is_infra_error`），
#: 只是不配得到重试。
_RETRYABLE_MARKERS = ("模型超时", "模型不可达")


def _status_of(error: str) -> int | None:
    """从故障消息里取状态码。取不到就 `None`。

    只认 `模型返回 <状态码>：<响应体>` 这个固定位置。别全文找数字——
    模型自己报的一个数（「潮位必须在 0..1，收到 429.0」）不该被当成状态码。
    """
    match = _STATUS.search(error)
    return None if match is None else int(match.group(1))


def is_infra_error(error: str | None) -> bool:
    """这条是**没问成**，不是模型的回答。

    判据只有一个问题：**模型开口了吗？** `模型返回 <状态码>` 意味着 HTTP 那一层
    就没成功，模型一个字也没说。这种行记成实验数据就是造假——一份「越界被拒
    0%」的报告可能只是一个过期的 Key，而读的人只会去改提示词。

    **任何 4xx/5xx 都算，包括 400 和 401。** 它们当然多半是我们的问题
    （请求形状不对、Key 轮换了），可「是我们的问题」不等于「是模型对世界的判断」。
    一次 401 让 55 条全部落成 unknown，交出一份「合法命令接受率 0%」的报告，
    比一份「没能问成」的空表坏得多：后者有人会去修，前者有人会去改提示词。

    要不要**重试**是另一个问题，由 `is_retryable` 回答。这两个问题早先共用
    一个判据，于是「不该重试的故障」被重试了六次，而「不该算数据的 401」
    被当成了数据。
    """
    if not error:
        return False
    if any(marker in error for marker in _INFRA_MARKERS):
        return True
    status = _status_of(error)
    return status is not None and status >= 400


def is_retryable(error: str | None) -> bool:
    """这条**等一等再问**会有不同结果吗？

    与 `is_infra_error` 分开：那个管「算不算数据」，这个管「要不要退避」。
    429 是并发上限，5xx 是服务端自己的事，超时与不可达是网络上的事——
    这几种等一会儿就过去了。别的 4xx（400 请求形状不对、401 Key 错了）
    是**我们**的问题，等一分钟再问还是同样一句拒绝；重试它们只是把一场
    实验拖长一分半，再交同一份白卷。
    """
    if not error:
        return False
    if any(marker in error for marker in _RETRYABLE_MARKERS):
        return True
    status = _status_of(error)
    if status is None:
        return False
    return status in _RETRYABLE_STATUS or 500 <= status < 600


def run_one(text: str, caller, context: dict | None = None) -> tuple[dict, str, str | None, bool]:
    """跑一条，返回 `(intent, 原始回复, 错误, 是不是基础设施故障)`。

    走的是端点用的同一条路：`interpret` → 白名单 → `command_to_intent`。
    实验与线上行为一致，不另开一条简化路径。

    `context` 默认 `None`（从严那一侧）。给了就是线上那一侧。
    """
    result = orchestrator.interpret(text, TEMPLATES, context, caller, WORLD)
    if not result.ok:
        error = result.error or "没听懂"
        return wire.unknown_intent(error), error, error, is_infra_error(error)
    if not result.commands:
        return (
            wire.unknown_intent(result.narrative or "不是在要求世界做任何事"),
            result.narrative,
            None,
            False,
        )
    intent = api.command_to_intent(result.commands[0])
    if intent is None:
        return wire.unknown_intent("世界还执行不了这条命令"), "", "unsupported", False
    return intent, "", None, False


def retrying(caller, attempts: int | None = None, backoff_ms: int | None = None):
    """限流时退避重试。

    **重试是实验的策略，不是端点的策略。** 线上一次 429 就该让用户看见
    「这句话没被听懂」，而不是让他在那儿等 30 秒。但实验里等一会儿是值得的——
    否则一条限流会被记成模型的回答，而那份数据是假的。

    次数与步长可用 `EXPERIMENT_RETRIES` / `EXPERIMENT_BACKOFF_MS` 覆盖。
    默认值按「同机另开一个实验」这种最常见的撞限流场景定：6 次、3 秒起倍退，
    单条最多能扛过约一分半的限流窗口。
    """
    if attempts is None:
        attempts = int(os.environ.get("EXPERIMENT_RETRIES", "6"))
    if backoff_ms is None:
        backoff_ms = int(os.environ.get("EXPERIMENT_BACKOFF_MS", "3000"))
    # `EXPERIMENT_RETRIES=0` 的意思是「一次都不重试」，不是「一次都不问」。
    # 不夹这一下，`range(0)` 空转，末尾那句 raise 会拿着 `None` 去抛
    # TypeError——把重试关掉的人看到的是一场崩掉的实验，而不是零次重试。
    attempts = max(1, attempts)

    def call(messages):
        delay = backoff_ms / 1000
        for attempt in range(1, attempts + 1):
            try:
                return caller(messages)
            except Exception as exc:  # noqa: BLE001 - 只挑等一等有用的重试，别的照抛
                if attempt == attempts or not is_retryable(str(exc)):
                    raise
                print(f"    ……{exc}，{delay:.0f}s 后重试（{attempt}/{attempts - 1}）")
                time.sleep(delay)
                delay *= 2
        raise AssertionError("到不了这里")  # pragma: no cover - 最后一圈不是 return 就是 raise

    return call


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


def _one_line(text: str) -> str:
    """折行折掉的说明在 Markdown 里会把列表与引用撑破，所以结构里只放单行版。

    `note` 同时被放进三处：`- 备注：{note}`（列表项）、`> {note}`（引用）、
    以及 `unknown_intent(note)`（一个普通字符串字段）。第三处不怕换行，前两处怕：
    一个 `\\n\\n` 会让列表在中间断掉、引用塌成普通段落，而「没能问成的有哪些」
    那一串就夹在两段引用之间，读起来像正文。

    信息一点没丢——折行只是排版，用空格接回去是同一句话。
    """
    return " ".join(part.strip() for part in text.splitlines() if part.strip())


def render(outcomes: list[Outcome], model: str, note: str, *, ran: bool = True) -> str:
    by_category: dict[str, list[Outcome]] = {}
    for outcome in outcomes:
        by_category.setdefault(outcome.category, []).append(outcome)

    def rate(category: str) -> tuple[int, int]:
        bucket = by_category.get(category, [])
        return sum(1 for item in bucket if classify(item)), len(bucket)

    # 「用例」那一行按**实际跑了多少**写，不按四张表的全长写。
    # 按全长写的话，`--only out-of-bounds` 跑出 12 条，那一行仍写着
    # 「55 条（合法 26 / 越界 12 / 闲聊 10 / 歧义 7）」——读的人以为四组都测了，
    # 而另外三组这一场根本没问过模型。少测不是错，把少测说成全都测了才是。
    counts = {category: len(items) for category, items in by_category.items()}
    ran_parts = [f"{label} {counts[key]}" for key, label in
                 (("legal", "合法"), ("out-of-bounds", "越界"), ("chitchat", "闲聊"), ("ambiguous", "歧义"))
                 if counts.get(key)]
    lines = [
        "# 意图实验：#16 的真实模型验证",
        "",
        f"- 模型：`{model}`",
        f"- 用例：{len(outcomes)} 条（{' / '.join(ran_parts)}）",
        f"- 备注：{_one_line(note)}",
        "",
        "## 四个指标",
        "",
        "| 指标 | 结果 | 要回答什么 |",
        "|---|---|---|",
    ]
    # 表以外的行不许出现百分号——`test_说明段里不出现百分号` 钉着这一条。
    # 表头里那句「必须 100%」是**要求**，不是结论，所以只查表以外的行。
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
        # 兜底那句要按**为什么没跑成**说。首版无论原因都写「配好 Key 再跑」，
        # 可 Key 明明是好的、只是撞了并发上限——照着那句话做的人会去查一个
        # 没坏的东西。原因已经在 `note` 里，这里只负责把人引过去。
        lines += [
            "",
            "> **这不是一次实验。** 上面没有任何一行是模型的真实表现。",
            f"> {_one_line(note)}",
            "> 按上面的原因处理完，重跑本脚本，这份表才会被真实数据覆盖。",
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

    # `append`，不是 `+=`。`list += str` 会把字符串**逐个字符**追加进去，
    # 于是这段解释被 `"\n".join` 拆成一个字一行——文档看着像乱码，
    # 而「说明段里不许出现百分号」那条检查也因此一个字符一个字符地扫过去，
    # 什么都没查到。两处都坏得很安静。
    lines.append(_WHY_IT_CHANGED)
    return "\n".join(lines)


#: 写在每次生成结果后面的解释。**手写、不随数据变**——数字会变，
#: 变的原因不会，而那才是下一次该改什么的依据。
#:
#: 这段不进上面的表：表里每一行都要能被复核，解释不能。
_WHY_IT_CHANGED = """
## 这条通过线是怎么补齐的

**首轮（2026-10-25）越界被拒 11/12。** 漏的是「拆掉第 999 号楼」：模型答了
`building.remove`，instanceId 编了一个世界上没有的值，而白名单只查
「是不是非空字符串」就放行了。

归因不在模型。模型确实说了句越界的话，但**服务端那时答不出「世界上有哪些楼」**——
`/api/world/intent` 手里的世界摘要只有客户端发来的 `worldSize`，没有建筑清单。
坐标越界在 `_point` 里就拦，实例存在与否没有理由放到世界那一层再答一遍。

补法是让服务端自己知道世界上有什么。**主源是客户端报的现状**（`context.built`）：
世界此刻有哪些楼只有世界自己知道，而客户端从模拟快照里直接搬过来。
日志投影是兜底——世界把建了什么写回了日志（`building.built` / `building.removed`），
`events/projection.py` 按 id 升序重放，投影出建筑集合。

**为什么日志只能兜底。** 日志记的是变更、不是快照：开局就有的楼（设定集落的）
从来没有 `building.built` 事件，只有运行时新建的才有。拿它当全集，
一个会话里第一条建筑记录往往是一次拆除——那一刻投影的口袋是空的，
于是之后每一句「拆掉它」都被拒，还附一句「现在一栋楼也没有」。

同一份摘要也让 `MAX_BUILDINGS` 那道上限第一次真的生效——此前 `buildingCount`
从来没有被传进白名单。

**证不明就不判。** 日志里没有任何建筑记录时跳过存在性检查，交给世界照它
自己的话说。把「没有记录」当成「世界上一栋楼也没有」，会让每一句合理的
「拆掉那栋楼」都被拒，而世界明明在好好地建楼拆楼。

## 这一轮修的是「悄悄换掉用户说的话」

第二轮（2026-10-27）复跑时，越界那一组**掉了**：三条越界用例被模型换成了一个
世界肯收的值，于是 200 + 成功，而用户要的根本不是那个。

| 用户说 | 模型换成了 | 为什么这是硬伤 |
|---|---|---|
| 潮位永久停在满潮 | `durationMs: 120000` | 用户要「一直」，拿到两分钟 |
| 把天气改成下雪 | `value: "rain"` | 用户要雪，拿到雨 |
| 潮水按住十分钟 | `durationMs: 60000` | 十分钟被当成一分钟，还在上限内 |

三条是同一个形状：**提示词邀请模型替用户改主意。** 潮位那行写着「durationMs
可省略（省略时取上限）」，模型就把「永久」读成「能多长就多长」；天气那行写着
「用户说的词不在表里，往最近的一档靠」，模型就把「雪」读成「雨」。纪律第 4 条
（越界就照实输出）在**用户给了明确数**的时候才生效，而这三句用户都没给数。

修法不是放宽白名单，是把提示词那几句话改对：可省略只管**用户没说时长**；
说几分钟就乘 60000（十分钟是 600000，超上限就让世界拒）；表里没有的现象
（雪、雾、风）不许往邻居身上靠。三处改完重跑，越界回到 12/12。

**这一轮真正该记住的是：闸门拦得住一个明确的越界数，拦不住一个被悄悄换过的数。**
白名单看到 `durationMs: 60000` 时它完全合法——错在到达它之前。

## 这份实验比线上更严

实验默认 `context` 是 `None`——模型看不到「已经建了：……instanceId=……」那一段，
服务端也不拿客户端的现状当摘要，只翻事件日志。线上客户端两样都会发，
所以模型本来就有现成的实例 id 可抄，白名单也对着一份更全的清单判。

这里是故意从严：**提示词是第一道闸，白名单是第二道**，只验第二道才说明它真的拦得住。

但「线上会更好」这句话不能只靠嘴说。`--with-context` 就是用来验它的：
同一份 55 条，把客户端的现状也发给模型。跑出来的差别全在合法组那 5 条
`building.remove` 上——严格模式下它们全部答 unknown（没有 id 可抄，
模型只能问），带上现状后能抄到 id 的 3 条就过了。剩下两条带上现状也过不了，
而那是**真的歧义**：「那栋楼不要了」对着六栋楼、「旧工坊推了重盖」是拆和盖两件事。

**所以那张缺口是实验设置造出来的，不是模型的。** 这个结论现在是跑出来的，
不是断言的。

## 没问成 ≠ 答了

首轮复跑时 55 条里 27 条撞上模型的并发上限（429），全部落成 `unknown`。
那一版的表写着「合法命令接受率 6/26」——比首轮的 15/22 掉了一半多，
看起来像模型退化。其实一个字的模型行为都没测到。

所以现在：撞上限流/超时/5xx 的条目标成 `infra`，**只要有一条没问成，
整场就不给百分比**，交一张 not-run 的空表。脚本带退避重试，但重试是实验的
策略，不是端点的——线上一次 429 就该让用户看见「这句话没被听懂」，
而不是让他在那儿等 30 秒。

读这份表之前先看「用例」那一行下面的备注写着什么。写着「没有跑成」，
上面每一个数字都不是模型的。

## 动完提示词，至少把哨子跑一遍

上面那条纪律是「要动提示词，动完必须重跑本脚本，不能只看单条」。难处在于
全套 55 条要烧一分多钟外加几十次调用，于是人会跳过它——而跳过的那几次，
恰恰就是本轮那三条偷换溜过去的原因。

所以有一个便宜的口子：

    cd server && python scripts/intent_experiment.py --only out-of-bounds --out /tmp/canary.md

12 条，只测越界那一组——表头写着它必须全过，漏一条就是硬伤。
它不快到能每次提交都跑，但快到**改完提示词顺手跑一遍**不心疼。`--only` 不许写进 `docs/INTENT_EXPERIMENT.md`：
那一份的位置是全套 55 条的，一场 12 条的哨子盖上去，标题还是那个标题，
另外三组变成 0/0，读的人无从分辨。

**哨子的数字不是全套的结论。** 它只回答「这一场越界的都拦住了吗」。
别把一份 12 条的报告当成 55 条的替代品——那一行会写明这一场跑了几条。

## 还不能回答的

- 合法命令接受率那一组剩下的缺口**只在严格模式下存在**，成因见上面那节。
  它是实验的 `context=None` 造出来的，不是提示词的问题——提示词那一侧
  （`building.add` 不说地点就省略 `at`）本轮已经修好并重跑了。
- `npc.setSchedule` 不进提示词：客户端与世界都还没有这条意图，
  写进去就是让模型去说一件世界办不到的事。
- 这条线只有 `step-5-preview` 一个模型的数字。换模型必须重跑，
  不要把这里的通过率当成模型的通用结论。
"""


def _dump_to(path: str, outcomes: list[Outcome]) -> None:
    """逐条原始结果存档。`--dump` 给了才写。

    **没跑成的那一场也要存。** 早先 `return 2` 排在 `if args.dump` 前面，
    于是撞了限流的那一回什么都不留——而下一次想改说明文字、用 `--replay`
    重渲染时，手里只剩一份空表。存档是留证据，不是只留好看的那些证据。
    """
    if not path:
        return
    # `newline="\n"`：Windows 上 `write_text` 默认会把 `\n` 写成 `\r\n`。
    # 这份文档是给人 review 的，换行符不该由跑脚本的那台机器决定——
    # 否则同一份数据在两个系统上跑出来，diff 里多出一整片换行符改动。
    Path(path).write_text(
        json.dumps([outcome.__dict__ for outcome in outcomes], ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="\n",
    )
    print(f"逐条存档到 {path}")


def _replay(source: Path, out: Path) -> int:
    """把 `--dump` 出来的 JSON 重新渲染成文档，一次模型都不调。"""
    rows = json.loads(source.read_text(encoding="utf-8"))
    outcomes = [
        Outcome(
            text=row["text"],
            category=row["category"],
            expected=row["expected"],
            ok=row["ok"],
            intent=row["intent"],
            raw_reply=row["raw_reply"],
            error=row["error"],
            infra=row.get("infra", False),
            with_context=row.get("with_context", False),
        )
        for row in rows
    ]
    # 备注要说清**这是哪一侧的数据**。同一批 55 条，带不带客户端现状，
    # 合法组能差 3 条；只说「从 dump 重渲染」的话，21/26 与 24/26 看起来一样可信。
    side = "带了客户端现状（线上那一侧）" if outcomes and outcomes[0].with_context else "没带客户端现状（故意从严那一侧）"
    note = f"由 --replay 从 --dump 重渲染，模型没有重新跑，{side}。数据日期见文件时间戳。"
    if any(item.infra for item in outcomes):
        # 带着没能问成的条目，就必须按没跑成渲染。只打印一句警告是不够的——
        # 表上照样会出现百分比，而读的人看不出来那里面有 27 条是限流。
        print("这份存档里有没能问成的条目，渲染成 not-run 的空表。")
        note = (
            f"**没有跑成**：这份存档里有 {sum(1 for item in outcomes if item.infra)} 条"
            "没能问成模型（限流、超时或 5xx），所以不给百分比。"
            f"{note}"
        )
        out.write_text(
            render(
                [
                    Outcome(item.text, item.category, item.expected, False,
                            wire.unknown_intent(note), "", note, True)
                    for item in outcomes
                ],
                "not-run", note, ran=False,
            ),
            encoding="utf-8",
        newline="\n",
        )
        print(f"从 {source} 重渲染到 {out}（没有调用模型）")
        return 2

    out.write_text(render(outcomes, os.environ.get("LLM_MODEL", "unknown"), note), encoding="utf-8", newline="\n")
    print(f"从 {source} 重渲染到 {out}（没有调用模型）")
    return 0


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
    parser.add_argument(
        "--replay",
        default="",
        help="从 --dump 出来的 JSON 重新渲染文档，不调模型。改了说明文字后用",
    )
    parser.add_argument(
        "--with-context",
        action="store_true",
        help=(
            "把客户端的现状也发给模型（线上那一侧）。默认不发，故意从严——"
            "见 _WHY_IT_CHANGED 里「这份实验比线上更严」。这个开关是用来"
            "验证那句话的，不是用来把数字变好看的。"
        ),
    )
    parser.add_argument(
        "--only",
        default="",
        choices=("", "legal", "out-of-bounds", "chitchat", "ambiguous"),
        help=(
            "只跑一组。`--only out-of-bounds` 是给「必须 100%」那条配的哨子："
            "12 条、一分钟出头，动完提示词顺手跑一遍。别拿它的数字当全套的结论——"
            "那一行会写明这一场跑了几条。"
        ),
    )
    args = parser.parse_args()

    # `--only` 不许写进默认路径。那一份是**全套 55 条**跑出来的证据，
    # 而一场 12 条的哨子把它盖掉，读的人看见的还是同样的标题、同样的四张表，
    # 分不清哪几组这一场问过模型。少测不是错，把少测的证据留在全套的位置上才是。
    if args.only and args.out == str(ROOT.parent / "docs" / "INTENT_EXPERIMENT.md"):
        parser.error(
            f"--only 只跑一组，别写进 {args.out}（那是全套 55 条的位置）。"
            "另给一个 --out，例如 --out /tmp/canary.md"
        )

    # 先读 `.env`：这样 Key 不必出现在命令行上（会留在 shell 历史里）。
    # 只打印**变量名**，不打印值。
    #
    # 读不动就当它不存在。`.env` 是给人看的配置文件，编辑器存成 GBK 就会解不开；
    # 那种当口真实跑法本来也跑不了（Key 没读进来），但 `--replay` 不该跟着陪葬——
    # 重渲染是改完说明文字之后的唯一出路，而它一个模型都不调。
    try:
        loaded = load_env()
    except (OSError, UnicodeDecodeError) as exc:
        print(f"读 .env 失败，当它不存在：{exc}")
        loaded = []
    if loaded:
        print(f"从 .env 读到：{', '.join(loaded)}")

    caller, why = _caller_factory()
    cases = ALL_CASES[: args.limit] if args.limit else ALL_CASES
    if args.only:
        cases = [case for case in cases if case[2] == args.only]

    if args.replay:
        # 从存档重渲染：不调模型、不看 Key。改了 `_WHY_IT_CHANGED` 之类的说明
        # 之后，不必为了两行字再烧一遍 55 次调用。
        return _replay(Path(args.replay), Path(args.out))

    if caller is None:
        note = f"**没有跑成**：{why}。下表全部记为 not-run，不是实验结果。"
        outcomes = [
            Outcome(text, category, expected, False, wire.unknown_intent(why or ""), "", why)
            for text, expected, category in cases
        ]
        Path(args.out).write_text(render(outcomes, "not-run", note, ran=False), encoding="utf-8", newline="\n")
        print(f"未配置模型，写了空结果的骨架到 {args.out}")
        return 2

    outcomes: list[Outcome] = []
    context = _client_context() if args.with_context else None
    for index, (text, expected, category) in enumerate(cases, start=1):
        try:
            intent, raw, error, infra = run_one(text, retrying(caller), context)
        except Exception as exc:  # 一条炸了不该中断整场实验
            intent, raw, error, infra = wire.unknown_intent(str(exc)), "", str(exc), is_infra_error(str(exc))
        outcomes.append(
            Outcome(text, category, expected, not error, intent, raw, error, infra, args.with_context)
        )
        status = "✅" if classify(outcomes[-1]) else "❌"
        mark = "（没问成）" if infra else ""
        print(f"[{index}/{len(cases)}] {status} {mark}{text} → {intent.get('kind')}")

    failed = [item for item in outcomes if item.infra]
    if failed:
        # **有一部分没问成，就不给百分比。** 一份 92% 的报告与一份 100% 的报告
        # 看起来一样可信，而前者可能只是限流。宁可交白卷，也不交一份
        # 把基础设施故障记成模型回答的数据——那是这套实验最容易被骗的地方。
        note = (
            f"**没有跑成**：{len(failed)}/{len(outcomes)} 条没能问成模型"
            f"（限流、超时或 5xx）。下表全部记为 not-run，不是实验结果。\n\n"
            f"没问成的：{'、'.join(item.text for item in failed[:10])}"
            + ("……" if len(failed) > 10 else "")
        )
        Path(args.out).write_text(
            render(
                [Outcome(item.text, item.category, item.expected, False,
                         wire.unknown_intent(note), "", note, True) for item in outcomes],
                "not-run", note, ran=False,
            ),
            encoding="utf-8",
        newline="\n",
        )
        print(f"\n{len(failed)} 条没问成，写了空结果的骨架到 {args.out}")
        print("重跑即可；脚本已带退避重试，撞上限流会自己等。")
        _dump_to(args.dump, outcomes)
        return 2

    model = os.environ.get("LLM_MODEL", "unknown")
    side = "带了客户端现状（线上那一侧）" if args.with_context else "没带客户端现状（故意从严那一侧）"
    note = f"一次完整跑完，{side}。判定标准见 `render()` / `classify()`。"
    if args.only:
        # 哨子那一场也要说清自己不是全套。下面 `_WHY_IT_CHANGED` 那几段
        # 通篇在讲 55 条怎么跑到今天的，而这一场只问了一组。
        note = (
            f"**只跑了{args.only}一组**（不是全套 55 条），{side}。"
            "下面「这条通过线是怎么补齐的」等段落说的是全套那一场，不是这一场。"
        )
    Path(args.out).write_text(render(outcomes, model, note), encoding="utf-8", newline="\n")
    _dump_to(args.dump, outcomes)

    rejected, total = (
        sum(1 for item in outcomes if item.category == "out-of-bounds" and classify(item)),
        sum(1 for item in outcomes if item.category == "out-of-bounds"),
    )
    print(f"\n结果写到 {args.out}")
    print(f"越界被拒 {rejected}/{total}")
    return 0 if rejected == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
