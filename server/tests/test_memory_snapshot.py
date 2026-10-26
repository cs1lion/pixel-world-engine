"""每日快照：从事件日志派生，可重新生成，且不重复落档。

核心验收是「能从事件日志重新生成，与落档内容一致」。这条只有快照是日志的
**纯函数**时才成立，所以这里最重要的两条测试是：

- 同一份日志 derive 两次，字节相同。
- 日志没变时再 write 一次，文件不动（`written is False`）。
"""

from __future__ import annotations

import pytest

from events.log import EventLog
from memory.paths import MemoryLayout
from memory.snapshot import (
    DAY_MS,
    SnapshotError,
    day_of,
    day_window,
    days_present,
    derive,
    write_snapshot,
)


def make_log() -> EventLog:
    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload={"change": "building.built", "instanceId": "wave_house#1", "prefabId": "wave_house", "displayName": "叠浪楼", "summary": "为抄书斋那条活而建"}, at=1_000)
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=2_000)
    log.append(kind="world.changed", actor="world", payload={"change": "tide", "level": 0.8, "until": 90_000}, at=3_000)
    log.append(kind="world.changed", actor="world", payload={"change": "miracle", "miracle": "lamp", "at": {"x": 5, "y": 6}}, at=4_000)
    # 第二天的事：用来验证按日切窗。
    log.append(kind="world.changed", actor="world", payload={"change": "building.removed", "instanceId": "old#1", "displayName": "旧工坊"}, at=DAY_MS + 500)
    return log


@pytest.fixture
def layout(tmp_path):
    layout = MemoryLayout.at(tmp_path)
    layout.ensure()
    return layout


# ------------------------------------------------------------------ 切日


def test_世界日序号按天切窗():
    assert day_of(0) == 0
    assert day_of(DAY_MS - 1) == 0
    assert day_of(DAY_MS) == 1
    assert day_window(1) == (DAY_MS, 2 * DAY_MS)


def test_只有当天的事件进当天快照(layout):
    text = derive(make_log(), 0)
    assert "叠浪楼" in text
    assert "旧工坊" not in text
    text1 = derive(make_log(), 1)
    assert "旧工坊" in text1
    assert "叠浪楼" not in text1


def test_days_present_列出日志里出现过的每一天():
    assert days_present(make_log()) == [0, 1]
    assert days_present(EventLog(":memory:")) == []
    assert days_present(make_log()) == [0, 1]
    assert days_present(EventLog(":memory:")) == []


# ------------------------------------------------------------------ 可重新生成


def test_同一份日志derive两次字节相同(layout):
    log = make_log()
    assert derive(log, 0) == derive(log, 0)


def test_快照落盘后重新生成内容一致(layout):
    """验收条件：「每日快照能从事件日志重新生成，与落档内容一致」。"""
    log = make_log()
    first = write_snapshot(layout, log, 0)
    assert first.written is True
    on_disk = first.path.read_text(encoding="utf-8")
    assert on_disk == derive(log, 0)


def test_日志没变时重跑不写文件(layout):
    """「不重复落档」不是空话：重跑一次不该让 git status 多一行改动。"""
    log = make_log()
    write_snapshot(layout, log, 0)
    before = layout.entry_path(0).read_bytes()
    second = write_snapshot(layout, log, 0)
    assert second.written is False
    assert layout.entry_path(0).read_bytes() == before


def test_日志变了才重写(layout):
    log = make_log()
    write_snapshot(layout, log, 0)
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "storm"}, at=5_000)
    second = write_snapshot(layout, log, 0)
    assert second.written is True
    assert "storm" in layout.entry_path(0).read_text(encoding="utf-8")


def test_逐条记忆不被快照冲掉(layout):
    """快照与逐条记忆两条路不相交——这是 entries/ 与 events/ 分开的理由。"""
    from memory import MemoryDraft
    from memory.writer import MemoryWriter

    log = make_log()
    writer = MemoryWriter(layout, log)
    written = writer.write(
        MemoryDraft(kind="event", title="我记下的一件事", body="正文", source="direct_observation", evidence=(1,), at=1_500)
    )
    write_snapshot(layout, log, 0)
    write_snapshot(layout, log, 0)
    assert written.path.is_file()
    assert "我记下的一件事" in written.path.read_text(encoding="utf-8")


# ------------------------------------------------------------------ 内容形态


def test_快照按小节归类(layout):
    text = derive(make_log(), 0)
    assert "# 世界日 0" in text
    for label in ("天气", "潮水", "盖了起来", "神迹"):
        assert f"## {label}" in text
    assert "- #2 rain" in text
    assert "- #3 潮位 0.8（到 90000 失效）" in text


def test_快照说得出是哪一栋(layout):
    """只有 summary 读不出是哪一栋，而快照是给人扫的。"""
    text = derive(make_log(), 0)
    assert "- #1 叠浪楼：为抄书斋那条活而建" in text


def test_快照只转述payload里已有的字段(layout):
    """不添词。`_describe` 说的是日志里写着的事，不是它猜的事。"""
    text = derive(make_log(), 0)
    assert "为抄书斋那条活而建" in text
    assert "潮位 0.8" in text
    # 神迹那一行说的是日志里的 kind 值，不是它编的一个名字。
    assert "- #4 lamp" in text


def test_空白的一天也有快照(layout):
    log = EventLog(":memory:")
    log.append(kind="task.arrived", actor="feed", payload={"taskId": "t"}, at=10)
    text = derive(log, 5)
    assert "什么都没发生" in text
    result = write_snapshot(layout, log, 5)
    assert result.event_count == 0


def test_世界日序号非法被拒(layout):
    with pytest.raises(SnapshotError):
        write_snapshot(layout, make_log(), -1)
    with pytest.raises(SnapshotError):
        write_snapshot(layout, make_log(), True)
