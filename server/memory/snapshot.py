"""每日快照：从事件日志**派生**，不单独落档。

「能重新生成，与落档内容一致」这条验收，只有快照是日志的**纯函数**时才成立。
所以这里没有任何一处读墙钟、读随机数、读当前目录——同一份日志进来，
出去的字节一模一样。也因此：

- 已存在的文件内容相同 → **不写**。`write_snapshot` 返回 `unchanged`。
  重跑一次快照不该让 `git status` 多一行改动，那会让「不重复落档」变成空话。
- 内容不同 → 覆盖写。差异只可能来自日志真的变了，那不是丢数据。

**为什么按世界日序号切。** 事件的 `at` 是世界时间（固定步长推进的毫秒数），
一天就是 24 个世界小时。用 `floor(at / DAY_MS)` 切，切点是纯函数；
换成日历日期就得引入墙钟，同一份日志在不同时区会切出不同的天。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from events.log import EventLog, WorldEvent
from memory.evidence import WORLD_FACT_KIND
from memory.paths import MemoryLayout

#: 一个世界日：24 个世界小时。世界时间本来就是固定步长推进的毫秒数，
#: 这里只是给它一个「天」的长度，不引入任何新的时钟。
DAY_MS = 24 * 60 * 60 * 1000

#: 一天之内最多列多少条。快照是给人读的一天概要，不是日志的镜像——
#: 真到了上千条的那天，人要看的是日志，不是这个文件。
MAX_LISTED = 200


class SnapshotError(ValueError):
    """快照参数不合法。"""


def day_of(at: float) -> int:
    """世界时间落在第几个世界日。"""
    return int(at // DAY_MS)


def day_window(day: int) -> tuple[float, float]:
    """第 `day` 个世界日的时间窗 `[from, to)`。"""
    return day * DAY_MS, (day + 1) * DAY_MS


@dataclass(frozen=True)
class SnapshotResult:
    """一次快照写入的结果。"""

    day: int
    path: Path
    relative: str
    written: bool
    event_count: int

    def to_json(self) -> dict[str, object]:
        return {
            "day": self.day,
            "path": self.relative,
            "written": self.written,
            "eventCount": self.event_count,
        }


def _change_of(event: WorldEvent) -> str:
    """一条 `world.changed` 事件说的是哪件世界改变。

    没有 `change` 字段的事件（上游来的 `task.*` 之类）归到「其他」——
    快照不猜它们是什么。
    """
    if event.kind != WORLD_FACT_KIND:
        return "其他"
    change = event.payload.get("change")
    return change if isinstance(change, str) and change else "其他"


#: 「世界改变」→ 人在快照里看到的小节标题。次序固定，所以快照的段落顺序稳定。
_SECTIONS: tuple[tuple[str, str], ...] = (
    ("weather", "天气"),
    ("tide", "潮水"),
    ("building.built", "盖了起来"),
    ("building.removed", "拆掉了"),
    ("miracle", "神迹"),
    ("task.delivered", "交付"),
    ("其他", "其他"),
)


def _describe(event: WorldEvent) -> str:
    """一条事件的一句话。只转述 payload 里已经有的字段，不添词。

    楼要连名字一起说：只有 summary 的「为抄书斋那条活而建」读不出是哪一栋，
    而快照是给人扫的，不是给机器 diff 的。
    """
    payload = event.payload
    name = _text_of(payload, "displayName") or _text_of(payload, "name")
    summary = _text_of(payload, "summary")
    if name is not None and summary is not None:
        return f"{name}：{summary}"
    if name is not None:
        return name
    if summary is not None:
        return summary
    for key in ("weather", "title"):
        value = _text_of(payload, key)
        if value is not None:
            return value
    if "level" in payload:
        until = payload.get("until")
        # until 是世界时间，和事件自己的 at 同一个钟，可以直接说。
        return f"潮位 {payload['level']}（到 {until} 失效）" if until is not None else f"潮位 {payload['level']}"
    for key in ("miracle", "instanceId", "prefabId"):
        value = _text_of(payload, key)
        if value is not None:
            return value
    return _change_of(event)


def _text_of(payload: dict[str, object], key: str) -> str | None:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def events_of_day(log: EventLog, day: int) -> list[WorldEvent]:
    """第 `day` 个世界日里的全部事件，按 id 升序。

    翻页读全量再按窗口筛。日志是只增的，`read` 又只给排他游标，
    没有按时间查的入口——为了一个纯函数的快照去给日志加时间索引，
    是把读路径搞复杂；翻页到当天的上界就停，量级和客户端追日志一样。
    """
    start, end = day_window(day)
    found: list[WorldEvent] = []
    since = 0
    while True:
        page = log.read(since=since, limit=1000)
        if not page:
            break
        for event in page:
            if start <= event.at < end:
                found.append(event)
        if page[-1].at >= end or page[-1].id >= log.latest_id():
            break
        since = page[-1].id
    return found


def derive(log: EventLog, day: int) -> str:
    """第 `day` 个世界日的快照文本。日志的纯函数。"""
    events = events_of_day(log, day)[:MAX_LISTED]
    start, end = day_window(day)
    # 时间窗写成整数：`8.64e+07` 虽然等价，但这份文件是给人读的，
    # 而人读的是 `86400000`。
    head = "\n".join(
        [
            "---",
            f"day: {day}",
            f"from_ms: {start}",
            f"to_ms: {end}",
            f"event_count: {len(events)}",
            "---",
        ]
    )
    lines: list[str] = [
        head,
        "",
        f"# 世界日 {day}",
        "",
        f"由事件日志派生，不要手改。世界时间 {start}–{end} 毫秒，共 {len(events)} 条。",
        "",
    ]
    if not events:
        lines += ["这一天什么都没发生。", ""]
        return "\n".join(lines)

    for change, label in _SECTIONS:
        picked = [event for event in events if _change_of(event) == change]
        if not picked:
            continue
        lines += [f"## {label}", ""]
        for event in picked:
            lines.append(f"- #{event.id} {_describe(event)}")
        lines.append("")
    return "\n".join(lines)


def write_snapshot(layout: MemoryLayout, log: EventLog, day: int) -> SnapshotResult:
    """生成并落盘第 `day` 个世界日的快照。内容相同就不写。"""
    if isinstance(day, bool) or not isinstance(day, int) or day < 0:
        raise SnapshotError(f"世界日序号必须是非负整数，收到 {day!r}")
    path = layout.entry_path(day)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = derive(log, day)
    current = ""
    if path.exists():
        current = path.read_text(encoding="utf-8")
    written = current != text
    if written:
        path.write_text(text, encoding="utf-8", newline="\n")
    return SnapshotResult(
        day=day,
        path=path,
        relative=_relative(layout, path),
        written=written,
        event_count=len(events_of_day(log, day)),
    )


def days_present(log: EventLog) -> list[int]:
    """日志里出现过的全部世界日，升序。"""
    days: set[int] = set()
    since = 0
    while True:
        page = log.read(since=since, limit=1000)
        if not page:
            break
        for event in page:
            days.add(day_of(event.at))
        if page[-1].id >= log.latest_id():
            break
        since = page[-1].id
    return sorted(days)


def _relative(layout: MemoryLayout, path: Path) -> str:
    return path.resolve().relative_to(layout.root.resolve()).as_posix()


__all__ = [
    "DAY_MS",
    "MAX_LISTED",
    "SnapshotError",
    "SnapshotResult",
    "day_of",
    "day_window",
    "days_present",
    "derive",
    "events_of_day",
    "write_snapshot",
]
