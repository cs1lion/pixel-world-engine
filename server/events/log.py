"""事件日志：只增不改的世界变化记录。

这条日志是世界的**唯一事实来源**（#5 之后世界从它投影出状态）。因此它必须满足
三条硬约束，任何一条破了，确定性回放就没了：

1. **只增不改。** 没有 update，没有 delete。不是「不提供方法」，是数据库层面
   用触发器拦住——方法可以绕过，触发器不能。
2. **id 单调递增。** 用 SQLite 的 `AUTOINCREMENT`，即使将来有人手工删行，
   新 id 也不会回退到已被用过的值。
3. **`at` 是世界时间，不是墙钟。** 世界有自己的一根时钟（固定步长推进的
   毫秒数），回放时按 `at` 重放，跟服务器什么时候写进这条日志无关。
   墙钟会让同一份日志在不同机器上重放出不同结果。

字段就五个，与 #12 票面一致：`id / at / kind / actor / payload`。
不额外加 `recorded_at` 之类——需要墙钟时由调用方自己记在 payload 里，
而不是让日志多一个「看起来方便、实际不可回放」的字段。
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from dataclasses import dataclass
from typing import Any, Iterable

#: `kind` 的形状：至少两段的小写点分名字，如 `world.changed` / `task.settled`。
#:
#: 这里**不冻结具体有哪些 kind**——#5 #6 #7 会陆续加。只约束命名形状：
#: 分段的命名空间能防止「weather」和「setWeather」这种同义异名混进同一条日志，
#: 又不至于让每加一种事件都要改一次服务端。
_KIND_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")

#: `payload` 序列化后的字节上限。一条事件大到这个量级，多半是把整个世界塞进去了，
#: 那不是事件，那是存档。拦住它，免得日志被单条撑爆。
_PAYLOAD_LIMIT_BYTES = 64 * 1024

#: `actor` 的长度上限。actor 是个标识符，不是一段话。
_ACTOR_LIMIT = 64

#: 单次读取的条数上限。客户端一次要更多说明它在做全量扫描，那是另一个接口的事。
MAX_LIMIT = 1000
DEFAULT_LIMIT = 200


class EventValidationError(ValueError):
    """事件形状不合法。API 层转成 422，不做静默修正。"""


@dataclass(frozen=True)
class WorldEvent:
    """一条已写入的事件。不可变——日志里的事件在内存里也不该能被改。"""

    id: int
    at: float
    kind: str
    actor: str
    payload: dict[str, Any]

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "at": self.at,
            "kind": self.kind,
            "actor": self.actor,
            "payload": self.payload,
        }


def _check_kind(kind: Any) -> str:
    if not isinstance(kind, str) or not _KIND_PATTERN.match(kind):
        raise EventValidationError(
            f"kind 必须是小写点分名（如 world.changed），收到 {kind!r}"
        )
    return kind


def _check_actor(actor: Any) -> str:
    if not isinstance(actor, str) or not actor.strip():
        raise EventValidationError(f"actor 必须是非空字符串，收到 {actor!r}")
    if len(actor) > _ACTOR_LIMIT:
        raise EventValidationError(f"actor 最长 {_ACTOR_LIMIT} 字符，收到 {len(actor)}")
    return actor


def _check_at(at: Any) -> float:
    # bool 是 int 的子类，单独挡掉：`True` 当世界时间显然是调用方写错了。
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        raise EventValidationError(f"at 必须是数字（世界时间 ms），收到 {at!r}")
    # `isinstance(x, int)` 收任意精度的整数，`float()` 只到 1.8e308。中间那一大段
    # （10**400）过了上面那道检查，却在这一行炸 OverflowError——它不是
    # EventValidationError，API 层那个转 422 的处理器接不住，于是回 500。
    # 「不做静默修正」包括不许把形状错升级成服务端错。
    try:
        value = float(at)
    except OverflowError:
        raise EventValidationError(
            f"at 太大，转不成世界时间：{at}。世界时间以毫秒计，没有这么大的数"
        ) from None
    if value != value or value in (float("inf"), float("-inf")):
        raise EventValidationError(f"at 必须是有限数，收到 {at!r}")
    if value < 0:
        raise EventValidationError(f"at 不能为负（世界时间从 0 开始），收到 {value}")
    return value


def _check_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise EventValidationError(f"payload 必须是对象，收到 {type(payload).__name__}")
    # 先序列化一次：既验可序列化，也量大小。存的是这次序列化的结果，
    # 不存调用方的对象引用——否则调用方之后改字典，日志就跟着变了。
    try:
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise EventValidationError(f"payload 不可序列化为 JSON：{error}") from error
    if len(encoded.encode("utf-8")) > _PAYLOAD_LIMIT_BYTES:
        raise EventValidationError(f"payload 超过 {_PAYLOAD_LIMIT_BYTES} 字节")
    # 再解回来：得到一份深拷贝，且保证存进去的东西就是能读出来的东西。
    return json.loads(encoded)


class EventLog:
    """SQLite 支撑的只增日志。

    线程安全：FastAPI 的同步端点跑在线程池里，所以连接开成
    `check_same_thread=False` 并用一把锁串行化写入。事件日志的写入本来就该串行
    ——id 的单调性依赖它。
    """

    def __init__(self, path: str = ":memory:") -> None:
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock, self._conn:
            # WAL：读不挡写。日志是只增的，读多写少，这个模式最合适。
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS world_events (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    at      REAL    NOT NULL,
                    kind    TEXT    NOT NULL,
                    actor   TEXT    NOT NULL,
                    payload TEXT    NOT NULL
                )
                """
            )
            # 只增不改的**执行层**保证。上面那层「类上不提供 update/delete」
            # 只是约定，任何人拿到连接就能绕过去；触发器绕不过去。
            for op in ("UPDATE", "DELETE"):
                self._conn.execute(
                    f"""
                    CREATE TRIGGER IF NOT EXISTS world_events_no_{op.lower()}
                    BEFORE {op} ON world_events
                    BEGIN
                        SELECT RAISE(ABORT, 'world_events 是只增日志，不能 {op.lower()}');
                    END
                    """
                )

    # ------------------------------------------------------------------ 写

    def append(self, *, kind: str, actor: str, payload: dict[str, Any], at: float) -> WorldEvent:
        """追加一条事件，返回写入后的形态（含服务端分配的 id）。

        校验在写之前全部做完：半条事件不入库。
        """
        kind = _check_kind(kind)
        actor = _check_actor(actor)
        at = _check_at(at)
        payload = _check_payload(payload)

        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        with self._lock, self._conn:
            cursor = self._conn.execute(
                "INSERT INTO world_events (at, kind, actor, payload) VALUES (?, ?, ?, ?)",
                (at, kind, actor, encoded),
            )
            event_id = int(cursor.lastrowid)
        return WorldEvent(id=event_id, at=at, kind=kind, actor=actor, payload=payload)

    # ------------------------------------------------------------------ 读

    def read(self, *, since: int = 0, limit: int = DEFAULT_LIMIT) -> list[WorldEvent]:
        """读 `id > since` 的事件，按 id 升序，最多 `limit` 条。

        `since` 是**排他**的：客户端把上次读到的最后一条 id 传回来，
        拿到的就是严格更新的那些。这样断点续读不会重复也不会漏。
        """
        if isinstance(since, bool) or not isinstance(since, int):
            raise EventValidationError(f"since 必须是整数，收到 {since!r}")
        if since < 0:
            raise EventValidationError(f"since 不能为负，收到 {since}")
        if isinstance(limit, bool) or not isinstance(limit, int):
            raise EventValidationError(f"limit 必须是整数，收到 {limit!r}")
        if limit < 1:
            raise EventValidationError(f"limit 至少为 1，收到 {limit}")
        if limit > MAX_LIMIT:
            raise EventValidationError(f"limit 最多 {MAX_LIMIT}，收到 {limit}")

        with self._lock:
            rows = self._conn.execute(
                "SELECT id, at, kind, actor, payload FROM world_events "
                "WHERE id > ? ORDER BY id ASC LIMIT ?",
                (since, limit),
            ).fetchall()
        return [
            WorldEvent(
                id=int(row["id"]),
                at=float(row["at"]),
                kind=str(row["kind"]),
                actor=str(row["actor"]),
                payload=json.loads(row["payload"]),
            )
            for row in rows
        ]

    def latest_id(self) -> int:
        """当前最大 id；空日志为 0。客户端据此判断自己是不是追平了。"""
        with self._lock:
            row = self._conn.execute("SELECT COALESCE(MAX(id), 0) AS latest FROM world_events").fetchone()
        return int(row["latest"])

    def count(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) AS n FROM world_events").fetchone()
        return int(row["n"])

    # ------------------------------------------------------------- 生命周期

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def __enter__(self) -> "EventLog":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def append_many(log: EventLog, events: Iterable[dict[str, Any]]) -> list[WorldEvent]:
    """批量追加。任何一条不合法就整体不入库——日志不接受半批。

    先全部校验，再一次性写入。不这么做的话，「第三条越界」会让前两条已经落地，
    调用方重试时又把它们写一遍，日志里就有了重复事件。
    """
    prepared: list[tuple[str, str, dict[str, Any], float]] = []
    for index, item in enumerate(events):
        if not isinstance(item, dict):
            raise EventValidationError(f"第 {index} 条不是对象")
        prepared.append(
            (
                _check_kind(item.get("kind")),
                _check_actor(item.get("actor")),
                _check_payload(item.get("payload")),
                _check_at(item.get("at")),
            )
        )
    if not prepared:
        return []
    encoded = [
        (at, kind, actor, json.dumps(payload, ensure_ascii=False, sort_keys=True))
        for kind, actor, payload, at in prepared
    ]
    with log._lock, log._conn:
        ids: list[int] = []
        for at, kind, actor, body in encoded:
            cursor = log._conn.execute(
                "INSERT INTO world_events (at, kind, actor, payload) VALUES (?, ?, ?, ?)",
                (at, kind, actor, body),
            )
            ids.append(int(cursor.lastrowid))
    return [
        WorldEvent(id=event_id, at=at, kind=kind, actor=actor, payload=payload)
        for event_id, (kind, actor, payload, at) in zip(ids, prepared)
    ]
