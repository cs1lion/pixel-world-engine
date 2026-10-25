"""事件日志的三条硬约束：只增不改、id 单调、at 是世界时间。"""

from __future__ import annotations

import sqlite3

import pytest

from events.log import (
    MAX_LIMIT,
    EventLog,
    EventValidationError,
    append_many,
)


@pytest.fixture()
def log() -> EventLog:
    with EventLog() as instance:
        yield instance


def _append(log: EventLog, *, kind: str = "world.changed", at: float = 0.0, **payload: object):
    return log.append(kind=kind, actor="world", payload=payload, at=at)


# --------------------------------------------------------------- 只增不改


def test_只能追加_类上没有修改或删除的方法(log: EventLog) -> None:
    for forbidden in ("update", "delete", "remove", "set", "edit"):
        assert not hasattr(log, forbidden), f"EventLog 不该有 {forbidden} 方法"


def test_直接对表发_UPDATE_被数据库拦住(log: EventLog) -> None:
    _append(log)
    # 绕过类、直接拿连接——这是「约定」与「保证」的分界线。
    with pytest.raises(sqlite3.DatabaseError, match="只增日志"):
        with log._conn:
            log._conn.execute("UPDATE world_events SET actor = 'tampered' WHERE id = 1")


def test_直接对表发_DELETE_被数据库拦住(log: EventLog) -> None:
    _append(log)
    with pytest.raises(sqlite3.DatabaseError, match="只增日志"):
        with log._conn:
            log._conn.execute("DELETE FROM world_events WHERE id = 1")


def test_被拦下之后日志内容不变(log: EventLog) -> None:
    _append(log, marker="原始")
    with pytest.raises(sqlite3.DatabaseError):
        with log._conn:
            log._conn.execute("UPDATE world_events SET payload = '{}' WHERE id = 1")
    assert log.read()[0].payload == {"marker": "原始"}


# --------------------------------------------------------------- id 单调


def test_id_从_1_开始并严格递增(log: EventLog) -> None:
    ids = [_append(log).id for _ in range(5)]
    assert ids == [1, 2, 3, 4, 5]


def test_since_是排他的_不重不漏(log: EventLog) -> None:
    for _ in range(5):
        _append(log)
    first = log.read(since=0, limit=2)
    assert [event.id for event in first] == [1, 2]
    rest = log.read(since=first[-1].id, limit=100)
    assert [event.id for event in rest] == [3, 4, 5]
    # 断点续读拼起来必须等于从头读一遍。
    assert [e.id for e in first + rest] == [e.id for e in log.read(since=0, limit=100)]


def test_since_等于最新_id_时返回空(log: EventLog) -> None:
    for _ in range(3):
        _append(log)
    assert log.read(since=3) == []


def test_latest_id_空日志为_0(log: EventLog) -> None:
    assert log.latest_id() == 0
    _append(log)
    assert log.latest_id() == 1


# --------------------------------------------------------------- 校验


@pytest.mark.parametrize("kind", ["weather", "Weather.Set", "world", "world.", ".changed", ""])
def test_kind_必须是小写点分名(log: EventLog, kind: str) -> None:
    with pytest.raises(EventValidationError, match="kind"):
        log.append(kind=kind, actor="world", payload={}, at=0.0)


@pytest.mark.parametrize("kind", ["world.changed", "task.settled", "oracle.command.rejected"])
def test_合法的_kind_通过(log: EventLog, kind: str) -> None:
    assert _append(log, kind=kind).kind == kind


@pytest.mark.parametrize("actor", ["", "   ", None, 123])
def test_actor_必须是非空字符串(log: EventLog, actor: object) -> None:
    with pytest.raises(EventValidationError, match="actor"):
        log.append(kind="world.changed", actor=actor, payload={}, at=0.0)


def test_actor_超长被拒(log: EventLog) -> None:
    with pytest.raises(EventValidationError, match="64"):
        log.append(kind="world.changed", actor="x" * 65, payload={}, at=0.0)


@pytest.mark.parametrize("at", [-1, "0", None, True, float("nan"), float("inf")])
def test_at_必须是有限非负数(log: EventLog, at: object) -> None:
    with pytest.raises(EventValidationError, match="at"):
        log.append(kind="world.changed", actor="world", payload={}, at=at)


def test_at_是浮点毫秒_原样存回(log: EventLog) -> None:
    event = _append(log, at=12345.5)
    assert log.read()[0].at == 12345.5
    assert event.at == 12345.5


def test_payload_必须是对象(log: EventLog) -> None:
    for bad in ([1, 2], "text", 3, None):
        with pytest.raises(EventValidationError, match="payload"):
            log.append(kind="world.changed", actor="world", payload=bad, at=0.0)


def test_payload_不可序列化被拒(log: EventLog) -> None:
    with pytest.raises(EventValidationError, match="序列化"):
        log.append(kind="world.changed", actor="world", payload={"x": object()}, at=0.0)


def test_payload_存的是快照_调用方之后改字典不影响日志(log: EventLog) -> None:
    payload = {"level": 0.5}
    log.append(kind="tide.overridden", actor="oracle", payload=payload, at=0.0)
    payload["level"] = 0.9  # 写完之后改
    assert log.read()[0].payload == {"level": 0.5}


def test_payload_超限被拒(log: EventLog) -> None:
    big = {"blob": "x" * (64 * 1024)}
    with pytest.raises(EventValidationError, match="字节"):
        log.append(kind="world.changed", actor="world", payload=big, at=0.0)


def test_校验失败不留下半条事件(log: EventLog) -> None:
    with pytest.raises(EventValidationError):
        log.append(kind="bad", actor="world", payload={}, at=0.0)
    assert log.count() == 0
    assert log.latest_id() == 0


# --------------------------------------------------------------- 读的参数


@pytest.mark.parametrize("since", [-1, "0", 1.5, True])
def test_since_参数类型被查(log: EventLog, since: object) -> None:
    with pytest.raises(EventValidationError, match="since"):
        log.read(since=since)


@pytest.mark.parametrize("limit", [0, -1, MAX_LIMIT + 1, "10", True])
def test_limit_参数类型被查(log: EventLog, limit: object) -> None:
    with pytest.raises(EventValidationError, match="limit"):
        log.read(limit=limit)


def test_读是有序的(log: EventLog) -> None:
    for index in range(10):
        _append(log, n=index)
    events = log.read(since=0, limit=100)
    assert [e.payload["n"] for e in events] == list(range(10))


# --------------------------------------------------------------- 批量


def test_批量追加按顺序落地(log: EventLog) -> None:
    written = append_many(
        log,
        [
            {"kind": "world.changed", "actor": "world", "payload": {"n": 1}, "at": 1.0},
            {"kind": "world.changed", "actor": "world", "payload": {"n": 2}, "at": 2.0},
        ],
    )
    assert [e.id for e in written] == [1, 2]
    assert [e.payload["n"] for e in log.read()] == [1, 2]


def test_批量里有一条不合法_整批不入库(log: EventLog) -> None:
    with pytest.raises(EventValidationError):
        append_many(
            log,
            [
                {"kind": "world.changed", "actor": "world", "payload": {}, "at": 0.0},
                {"kind": "BAD", "actor": "world", "payload": {}, "at": 0.0},
            ],
        )
    assert log.count() == 0, "第三条越界不能让前两条先落地"


def test_批量空列表是合法的空操作(log: EventLog) -> None:
    assert append_many(log, []) == []
    assert log.count() == 0


# --------------------------------------------------------------- 持久化


def test_文件库关掉再开_事件还在(tmp_path) -> None:
    path = tmp_path / "events.db"
    with EventLog(str(path)) as first:
        first.append(kind="world.changed", actor="world", payload={"n": 1}, at=5.0)
    with EventLog(str(path)) as second:
        events = second.read()
        assert len(events) == 1
        assert events[0].payload == {"n": 1}
        # id 接着往下数，不从 1 重来。
        assert second.append(kind="world.changed", actor="world", payload={}, at=6.0).id == 2
