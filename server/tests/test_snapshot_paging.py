"""快照的翻页。

这些测试守的不是「能读出来」，而是「一条都不少」。
早先的实现在 `page[-1].at >= 当天上界` 时提前收工，那等于假设 `at` 随 id
单调——日志没有这条保证。于是掺一条 id 更大、`at` 更小的事件，
那一天就会被安静地判成「什么都没发生」，而快照本该是日志的纯函数。

少列一条是遗憾，编一次是撒谎。所以这里按**最不利的形状**测：
一页装不下的量、跨天的量、以及顺序乱了的量。
"""

from __future__ import annotations

import pytest

from events.log import EventLog, MAX_LIMIT
from memory.paths import MemoryLayout
from memory.snapshot import (
    DAY_MS,
    MAX_PAGE,
    MAX_LISTED,
    SnapshotError,
    day_of,
    day_window,
    days_present,
    derive,
    events_of_day,
    render,
    write_snapshot,
    write_snapshots,
)


def make_log(count: int, *, at) -> EventLog:
    log = EventLog(":memory:")
    for index in range(count):
        log.append(
            kind="world.changed",
            actor="world",
            payload={"change": "weather", "weather": "rain", "n": index},
            at=at(index),
        )
    return log


@pytest.fixture
def layout(tmp_path):
    layout = MemoryLayout.at(tmp_path)
    layout.ensure()
    return layout


# ------------------------------------------------------------------ 翻页边界


def test_一天超过一页也一条不少():
    # MAX_PAGE 与 MAX_LIMIT 必须一致：写大了日志会直接拒，写小了翻的遍数白翻。
    assert MAX_PAGE == MAX_LIMIT
    log = make_log(MAX_PAGE * 2 + 137, at=lambda index: index * 10)
    assert len(events_of_day(log, 0)) == MAX_PAGE * 2 + 137


def test_跨天时各归各的一天():
    log = make_log(50, at=lambda index: index * DAY_MS // 25)  # 25 条一天，跨两天
    assert days_present(log) == [0, 1]
    assert len(events_of_day(log, 0)) == 25
    assert len(events_of_day(log, 1)) == 25


def test_空日志没有天():
    assert days_present(EventLog(":memory:")) == []
    assert events_of_day(EventLog(":memory:"), 0) == []


# ------------------------------------------------------------------ 乱序


def test_at_比_id_小的事件不被吞掉():
    """这就是当初那个 bug 的形状：后面发生的事，`at` 反而更早。

    日志不保证 `at` 随 id 单调（`read` 只按 id 排序）。快照翻到当天上界
    就停的话，这一条会被算进「已经过了窗口」的那一页，然后被忘掉。
    """
    day_one = DAY_MS
    log = make_log(MAX_PAGE + 10, at=lambda index: day_one + index)
    log.append(
        kind="world.changed",
        actor="world",
        payload={"change": "weather", "weather": "snow", "n": "迟到的那条"},
        at=5,  # 第 0 天，但 id 比第 1 天的全部事件都大
    )

    assert days_present(log) == [0, 1]
    late = events_of_day(log, 0)
    assert len(late) == 1
    assert late[0].payload["n"] == "迟到的那条"
    # 第 1 天那条也不能因为多读了一页就少。
    assert len(events_of_day(log, 1)) == MAX_PAGE + 10


def test_快照不把乱序的那天写成空():
    log = make_log(MAX_PAGE + 5, at=lambda index: DAY_MS + index)
    log.append(
        kind="world.changed",
        actor="world",
        payload={"change": "weather", "weather": "snow"},
        at=7,
    )
    text = derive(log, 0)
    assert "这一天什么都没发生" not in text
    assert "snow" in text


def test_全部重生成只翻一遍日志(layout):
    """三十天重生成不该翻三十遍全量。

    用一个数读取次数的日志来看：分桶一次，之后各写各的。
    """
    class CountingLog(EventLog):
        def __init__(self) -> None:
            super().__init__(":memory:")
            self.reads = 0

        def read(self, **kwargs):  # type: ignore[override]
            self.reads += 1
            return super().read(**kwargs)

    log = CountingLog()
    # 第 0 天装满一页还多，第 1 天再来几条——两个都要翻，页数才看得出来。
    for index in range(MAX_PAGE + 3):
        log.append(
            kind="world.changed",
            actor="world",
            payload={"change": "weather", "weather": "rain"},
            at=index,
        )
    log.append(
        kind="world.changed",
        actor="world",
        payload={"change": "weather", "weather": "rain"},
        at=DAY_MS + 1,
    )

    days = [0, 1]
    write_snapshots(layout, log, days)
    shared = log.reads
    assert shared >= 1

    log.reads = 0
    for day in days:
        write_snapshot(layout, log, day)
    per_day = log.reads

    # 一天一遍的话，读取次数正好是天数倍。分桶之后不是。
    assert per_day == shared * len(days), f"shared={shared} per_day={per_day}"
    assert shared < per_day


# ------------------------------------------------------------------ 条数诚实


def test_列不下的那天说清列了多少(layout):
    """说「共 1200 条」然后列 200 条是诚实的；说「共 200 条」是瞒。"""
    log = make_log(MAX_LISTED + 37, at=lambda index: index * 10)
    text = render(0, events_of_day(log, 0))
    assert f"event_count: {MAX_LISTED + 37}" in text
    assert f"这一天有 {MAX_LISTED + 37} 条，下面列前 {MAX_LISTED} 条。" in text
    # 真列出来的确实只有 MAX_LISTED 条。
    assert sum(1 for line in text.splitlines() if line.startswith("- #")) == MAX_LISTED


def test_write_snapshot_报的条数与文件里一致(layout):
    """`SnapshotResult.event_count` 与 frontmatter 里的 `event_count` 是一个数。"""
    log = make_log(MAX_LISTED + 5, at=lambda index: index * 10)
    result = write_snapshot(layout, log, 0)
    text = result.path.read_text(encoding="utf-8")
    assert f"event_count: {result.event_count}" in text


def test_装得下的那一天不说列了多少(layout):
    log = make_log(3, at=lambda index: index * 10)
    text = render(0, events_of_day(log, 0))
    assert "下面列前" not in text
    assert "event_count: 3" in text


# ------------------------------------------------------------------ 纯度


def test_derive_是日志的纯函数():
    log = make_log(40, at=lambda index: index * 100)
    assert derive(log, 0) == derive(log, 0)
    # 换个方向再读一遍，字节一样。
    assert derive(log, 0) == render(0, events_of_day(log, 0))


def test_day_of_与_day_window_互为反函数():
    for day in (0, 1, 7, 1000):
        start, end = day_window(day)
        assert day_of(start) == day
        assert day_of(end - 1) == day
        assert day_of(end) == day + 1


def test_非法日序号被拒(layout):
    log = make_log(1, at=lambda index: 0)
    for hostile in (-1, True, 1.0, "0", None):
        with pytest.raises(SnapshotError):
            write_snapshot(layout, log, hostile)
