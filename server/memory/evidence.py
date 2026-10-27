"""证据链：写入前先证明「这事真的发生过」。

这是 SPEC §4.7 三条铁律里最重的一条的执行层。原文是「每条 entry 必须带 source
与证据链」「没有依据时，宁可不写」——写在文档里，它是一句承诺；写在这里，
它是一次**查询**：引用的 id 有一个不在日志里，整条记忆就被拒。

**为什么值得专门开一个模块。** 「有据可查」是整个记忆层唯一不可妥协的东西：
世界可以忘事，不可以记错事。而记错事最常见的来源不是 bug，是调用方
（或模型）编了一条看似合理的证据 id。所以校验必须是查询，不是格式检查。

**为什么只翻页、不给 EventLog 加 `get(id)`。** `EventLog.read` 的 `since`
是排他游标，天生适合顺序翻页；而 `get(id)` 要用主键查，等于给只增日志开一个
随机读的口子。这里要的是一次性核对一批 id，翻页到覆盖最大 id 就停，
用的全是现有公开 API。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from events.log import MAX_LIMIT, EventLog, WorldEvent

#: 「世界自己做过什么」在日志里的 kind。证据至少要引用一条这样的事件——
#: 记忆记的是世界发生过什么，而日志里只有这一种是在说这件事。
#:
#: 只认这一种不是过度收紧：交付、建造、拆除、神迹、天气、拨潮全是 `world.changed`。
#: 真要引用别的 kind（比如上游来了一单），改这一行常量，不用动校验逻辑。
#: （2026-10-28：上面那串是**列举，不是清单**——`WORLD_CHANGE_CHECKS` 今天是七种，
#: 漏说的第七种是 `world.vitals`（一天结束时那四个标量）。它落成的 kind 同样是
#: `world.changed`，所以「证据至少要引用一条世界自己做成的事」对它也成立。
#: 别把这串当成可引用事件的全集。）
WORLD_FACT_KIND = "world.changed"


class EvidenceError(ValueError):
    """证据链不成立。API 层转成 422。"""


@dataclass(frozen=True)
class EvidenceCheck:
    """一次核对的结果。通过时带着被引用的事件，供写进 frontmatter 供人审。"""

    events: tuple[WorldEvent, ...]

    @property
    def ids(self) -> tuple[int, ...]:
        return tuple(event.id for event in self.events)

    @property
    def kinds(self) -> tuple[str, ...]:
        return tuple(event.kind for event in self.events)


def _collect(log: EventLog, wanted: Iterable[int]) -> dict[int, WorldEvent]:
    """翻页把想要的 id 捞出来。翻到日志末尾或找齐就停。"""
    wanted_set = set(wanted)
    found: dict[int, WorldEvent] = {}
    since = 0
    while len(found) < len(wanted_set):
        page = log.read(since=since, limit=MAX_LIMIT)
        if not page:
            break
        for event in page:
            if event.id in wanted_set:
                found[event.id] = event
        if page[-1].id >= log.latest_id():
            break
        since = page[-1].id
    return found


def check_evidence(log: EventLog, evidence: tuple[int, ...]) -> EvidenceCheck:
    """核对一批事件 id。查不到、或没有一条是世界自己做过的事，都拒。"""
    found = _collect(log, evidence)
    missing = sorted(set(evidence) - set(found))
    if missing:
        listed = "、".join(str(item) for item in missing)
        raise EvidenceError(
            f"证据链指向的事件不存在：{listed}。"
            "记忆只能记下已经发生过的事，不能引用没发生过的事"
        )
    events = tuple(found[item] for item in sorted(found))
    if not any(event.kind == WORLD_FACT_KIND for event in events):
        raise EvidenceError(
            f"证据链里没有一条 {WORLD_FACT_KIND}："
            "记忆记的是世界做过什么，至少引用一件世界自己做成的事"
        )
    return EvidenceCheck(events=events)


__all__ = ["EvidenceCheck", "EvidenceError", "WORLD_FACT_KIND", "check_evidence"]
