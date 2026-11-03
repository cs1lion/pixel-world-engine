"""造物账本的只增 JSONL 存储。

**这不是 v5 存档的一部分。** 每个世界一本：

    data/creation-ledger/<worldId>.jsonl

目录可以用 `PIXEL_WORLD_CREATION_LEDGER_DIR` 改。文件一行一条 JSON，
只追加；类上没有 update / delete / rewrite，也没有「补写上一行」的入口。

三条硬约束与事件日志同一套：

1. **只增不改**：历史行永远不动；读出来的记录与写进去的逐字段相同。
2. **序号单调**：`seq` 从文件里最后一个序号接着数，重启不从 1 重来。
3. **时间不倒退**：`recordedAt` 由服务端盖章，且新值不小于上一个写入值。
   世界时间（记录里的 `at`）可以因回拨而倒退；那是世界的事，账本的写盘
   顺序不该跟着倒退。

去重键是 `recordId`：客户端重试同一条记录时必须复用同一个 id，服务端跳过
第二条。这是「不丢、不重复」里「不重复」的那一半。
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

#: 账本格式版本。与客户端 `CREATION_LEDGER_VERSION` 同源，两边各写一份。
LEDGER_VERSION = 1

#: 三种记录。`creation` 一件造物一条；另外两种用 `proposalId` 挂回去。
RECORD_KINDS = ("creation", "landing", "observation")

#: 落地后第几个世界日观测。与客户端 `OBSERVATION_WINDOW_DAYS` 同一个 7。
OBSERVATION_WINDOW_DAYS = 7

#: 拒绝原因可以按哪一项查。与 `src/creator/ledger.ts` 的 `GateName` 逐字一致。
GATE_NAMES = (
    "schema",
    "placement",
    "coverage",
    "pathfinding",
    "collision",
    "constraint",
    "traceability",
    "invariant",
    "replay",
    "fuse",
)

OBSERVATION_STATUSES = ("still_present", "removed", "modified", "missing")

#: worldId 要能直接当文件名。只收小写 ASCII、数字、连字符、下划线。
_WORLD_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")

#: 记录 id 的上限。UUID + 前缀绰绰有余；再长就是调用方在拼别的东西。
MAX_RECORD_ID_CHARS = 200


class CreationLedgerError(ValueError):
    """记录形状不对。API 层转成 422。"""


def safe_world_id(world_id: object) -> str:
    if not isinstance(world_id, str) or _WORLD_ID.fullmatch(world_id) is None:
        raise CreationLedgerError(
            "worldId 必须是 1–64 位小写 ASCII 字母/数字/-/_（要直接当文件名）"
        )
    return world_id


def _require(record: dict[str, Any], key: str, kinds: type | tuple[type, ...], path: str) -> Any:
    if key not in record:
        raise CreationLedgerError(f"{path} 缺字段 {key}")
    value = record[key]
    types = kinds if isinstance(kinds, tuple) else (kinds,)
    if isinstance(value, bool) and int in types:
        raise CreationLedgerError(f"{path}.{key} 不能是布尔值")
    if not isinstance(value, types):
        raise CreationLedgerError(f"{path}.{key} 类型不对：{type(value).__name__}")
    return value


def validate_record(record: object) -> dict[str, Any]:
    """只查**契约字段**，不替调用方补默认值。

    宽松解析会让两端的理解悄悄分叉：客户端以为漏填的项会有默认值，服务端
    以为没填就是没测。账本里「没测」与「测了满分」是两件事，不能合成一件。
    """
    if not isinstance(record, dict):
        raise CreationLedgerError("记录必须是对象")

    for forbidden in ("seq", "recordedAt"):
        if forbidden in record:
            raise CreationLedgerError(f"记录里不能自带 {forbidden}：那是服务端盖的章")

    kind = _require(record, "kind", str, "record")
    if kind not in RECORD_KINDS:
        raise CreationLedgerError(f"kind 必须是 {RECORD_KINDS} 之一，收到 {kind!r}")

    version = _require(record, "ledgerVersion", int, "record")
    if version != LEDGER_VERSION:
        raise CreationLedgerError(f"ledgerVersion 必须是 {LEDGER_VERSION}，收到 {version}")

    record_id = _require(record, "recordId", str, "record")
    if record_id.strip() == "" or len(record_id) > MAX_RECORD_ID_CHARS:
        raise CreationLedgerError(f"recordId 必须非空且不超过 {MAX_RECORD_ID_CHARS} 字符")
    if any(char in record_id for char in ("\n", "\r", "\x00")):
        raise CreationLedgerError("recordId 不能含换行或 NUL")

    safe_world_id(_require(record, "worldId", str, "record"))
    day = _require(record, "day", int, "record")
    if day < 0:
        raise CreationLedgerError("day 必须 >= 0")
    at = _require(record, "at", (int, float), "record")
    if not math.isfinite(float(at)) or float(at) < 0:
        raise CreationLedgerError("at 必须是有限非负数")

    # 观测记录不重复模板字段：它靠 `proposalId` 挂回 creation。
    if kind in ("creation", "landing"):
        _require(record, "templateId", str, "record")

    if kind == "creation":
        _validate_creation(record)
    elif kind == "landing":
        _validate_landing(record)
    else:
        _validate_observation(record)

    return dict(record)


def _validate_creation(record: dict[str, Any]) -> None:
    verdict = _require(record, "verdict", str, "creation")
    if verdict not in ("accepted", "rejected"):
        raise CreationLedgerError("creation.verdict 必须是 accepted/rejected")
    origin = _require(record, "origin", str, "creation")
    if origin not in ("manual", "auto", "oracle", "world"):
        raise CreationLedgerError("creation.origin 必须是 manual/auto/oracle/world")
    _require(record, "templateName", str, "creation")
    _require(record, "templateKind", str, "creation")
    if record.get("intentText") is not None:
        _require(record, "intentText", str, "creation")
    target = _require(record, "target", dict, "creation")
    _require(target, "x", int, "creation.target")
    _require(target, "y", int, "creation.target")
    gates = _require(record, "gates", list, "creation")
    if len(gates) == 0:
        raise CreationLedgerError("creation.gates 不能是空表：一条造物至少要有 schema 与 placement")
    for index, gate in enumerate(gates):
        _validate_gate(gate, f"creation.gates[{index}]")
    _validate_ladder(_require(record, "ladder", dict, "creation"))
    _validate_replay(_require(record, "replay", dict, "creation"))
    if record.get("rejection") is not None:
        _validate_rejection(record["rejection"], "creation.rejection")
    if record.get("rejectionGate") is not None:
        gate_name = _require(record, "rejectionGate", str, "creation")
        if gate_name not in GATE_NAMES:
            raise CreationLedgerError(f"creation.rejectionGate 不在门禁闭集里：{gate_name!r}")
    overrides = _require(record, "overrides", list, "creation")
    if any(item not in GATE_NAMES for item in overrides):
        raise CreationLedgerError("creation.overrides 里有不认识的门外项")
    if record.get("landing") is not None:
        raise CreationLedgerError("creation.landing 必须是 null：落地由单独的 landing 记录补")


def _validate_landing(record: dict[str, Any]) -> None:
    _require(record, "proposalId", str, "landing")
    landed = _require(record, "landed", bool, "landing")
    building_id = record.get("buildingId")
    if building_id is not None and not isinstance(building_id, str):
        raise CreationLedgerError("landing.buildingId 必须是字符串或 null")
    if not landed and building_id is not None:
        raise CreationLedgerError("landing.landed=false 时 buildingId 必须是 null")
    gates = _require(record, "gates", list, "landing")
    for index, gate in enumerate(gates):
        _validate_gate(gate, f"landing.gates[{index}]")
    _validate_replay(_require(record, "replay", dict, "landing"))
    if record.get("failure") is not None:
        _validate_rejection(record["failure"], "landing.failure")


def _validate_observation(record: dict[str, Any]) -> None:
    _require(record, "proposalId", str, "observation")
    due_day = _require(record, "dueDay", int, "observation")
    if due_day < 0:
        raise CreationLedgerError("observation.dueDay 必须 >= 0")
    status = _require(record, "status", str, "observation")
    if status not in OBSERVATION_STATUSES:
        raise CreationLedgerError(f"observation.status 必须是 {OBSERVATION_STATUSES} 之一")
    _require(record, "detail", str, "observation")


def _validate_gate(gate: object, path: str) -> None:
    if not isinstance(gate, dict):
        raise CreationLedgerError(f"{path} 必须是对象")
    name = _require(gate, "name", str, path)
    if name not in GATE_NAMES:
        raise CreationLedgerError(f"{path}.name 不在门禁闭集里：{name!r}")
    phase = _require(gate, "phase", str, path)
    if phase not in ("proposal", "landing"):
        raise CreationLedgerError(f"{path}.phase 必须是 proposal/landing")
    # observed 可以是 null（没测）、布尔、数字或熔断动作字符串。
    if "observed" not in gate:
        raise CreationLedgerError(f"{path} 缺字段 observed")
    threshold = _require(gate, "threshold", str, path)
    if threshold == "":
        raise CreationLedgerError(f"{path}.threshold 不能是空串")
    passed = gate.get("passed")
    if passed is not None and not isinstance(passed, bool):
        raise CreationLedgerError(f"{path}.passed 必须是布尔或 null")
    reason = _require(gate, "reason", str, path)
    if reason not in ("pass", "below_requirement", "not_measured", "not_applicable"):
        raise CreationLedgerError(f"{path}.reason 不在闭集里：{reason!r}")


def _validate_ladder(ladder: dict[str, Any]) -> None:
    level = _require(ladder, "level", int, "ladder")
    if level < 0 or level > 4:
        raise CreationLedgerError("ladder.level 必须在 0–4")
    _require(ladder, "levelName", str, "ladder")
    _require(ladder, "targetLevel", int, "ladder")
    _require(ladder, "isFused", bool, "ladder")
    action = _require(ladder, "action", str, "ladder")
    if action not in ("allow", "requireReview", "downgrade", "isolate", "not_applicable"):
        raise CreationLedgerError(f"ladder.action 不在闭集里：{action!r}")
    _require(ladder, "reason", str, "ladder")
    _require(ladder, "metrics", dict, "ladder")


def _validate_replay(replay: dict[str, Any]) -> None:
    _require(replay, "seed", str, "replay")
    for key in ("eventFrom", "eventTo", "dayFrom", "dayTo"):
        _require(replay, key, int, "replay")
    fingerprint = _require(replay, "fingerprint", str, "replay")
    if fingerprint == "":
        raise CreationLedgerError("replay.fingerprint 不能是空串")


def _validate_rejection(value: object, path: str) -> None:
    if not isinstance(value, dict):
        raise CreationLedgerError(f"{path} 必须是对象或 null")
    gate = _require(value, "gate", str, path)
    if gate not in GATE_NAMES:
        raise CreationLedgerError(f"{path}.gate 不在门禁闭集里")
    _require(value, "threshold", str, path)
    kind = _require(value, "kind", str, path)
    if kind not in ("below_requirement", "not_measured"):
        raise CreationLedgerError(f"{path}.kind 必须是 below_requirement/not_measured")
    _require(value, "detail", str, path)
    if "observed" not in value:
        raise CreationLedgerError(f"{path} 缺字段 observed")


@dataclass(frozen=True)
class AppendOutcome:
    record: dict[str, Any]
    duplicate: bool


class CreationLedgerStore:
    """一个目录里若干本 JSONL。同一进程内用一把锁串行化写。"""

    def __init__(
        self,
        root: Path,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._clock = clock if clock is not None else (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._ids: dict[str, dict[str, dict[str, Any]]] = {}
        self._last_seq: dict[str, int] = {}
        self._last_stamp: dict[str, str] = {}

    def path_for(self, world_id: str) -> Path:
        return self.root / f"{safe_world_id(world_id)}.jsonl"

    def append(self, record: dict[str, Any]) -> AppendOutcome:
        validated = validate_record(record)
        world_id = validated["worldId"]
        with self._lock:
            self._load(world_id)
            incoming_id = validated["recordId"]
            existing = self._ids[world_id].get(incoming_id)
            if existing is not None:
                return AppendOutcome(record=existing, duplicate=True)

            stored = {
                **validated,
                "seq": self._last_seq[world_id] + 1,
                "recordedAt": self._stamp(world_id),
            }
            line = json.dumps(stored, ensure_ascii=False, separators=(",", ":"))
            path = self.path_for(world_id)
            with open(path, "a", encoding="utf-8", newline="\n") as handle:
                handle.write(line + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            self._ids[world_id][incoming_id] = stored
            self._last_seq[world_id] = stored["seq"]
            self._last_stamp[world_id] = stored["recordedAt"]
            return AppendOutcome(record=stored, duplicate=False)

    def read(
        self,
        world_id: str,
        *,
        day: int | None = None,
        template: str | None = None,
        reject: str | None = None,
    ) -> list[dict[str, Any]]:
        world_id = safe_world_id(world_id)
        with self._lock:
            self._load(world_id)
            records = list(self._ids[world_id].values())
        records.sort(key=lambda item: item["seq"])
        if day is None and template is None and reject is None:
            return records

        # 过滤以**造物（creation）**为单位：先找出命中的提案，再把它们的
        # landing / observation 一并带回去。只按每一行自己的字段过滤，会把
        # 落地与观测记录漏掉，读出来就折不成「每件造物一条」。
        matched = [
            item
            for item in records
            if item.get("kind") == "creation"
            and (day is None or item.get("day") == day)
            and (template is None or item.get("templateId") == template)
            and (
                reject is None
                or (
                    isinstance(item.get("rejection"), dict)
                    and item["rejection"].get("gate") == reject
                )
            )
        ]
        ids = {item["recordId"] for item in matched}
        return [
            item
            for item in records
            if item["recordId"] in ids or item.get("proposalId") in ids
        ]

    def count(self, world_id: str, kind: str | None = None) -> int:
        records = self.read(world_id)
        if kind is None:
            return len(records)
        return sum(1 for item in records if item.get("kind") == kind)

    def bytes(self, world_id: str) -> int:
        path = self.path_for(world_id)
        return path.stat().st_size if path.exists() else 0

    # ---------------------------------------------------------------- 内部

    def _load(self, world_id: str) -> None:
        if world_id in self._ids:
            return
        path = self.path_for(world_id)
        records: list[dict[str, Any]] = []
        last_seq = 0
        last_stamp = ""
        if path.exists():
            with open(path, "r", encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, start=1):
                    if line.strip() == "":
                        continue
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError as error:
                        raise CreationLedgerError(
                            f"{path.name} 第 {line_number} 行不是合法 JSON：{error}"
                        ) from error
                    if not isinstance(parsed, dict):
                        raise CreationLedgerError(f"{path.name} 第 {line_number} 行不是对象")
                    records.append(parsed)
                    last_seq = max(last_seq, int(parsed.get("seq", 0)))
                    last_stamp = max(last_stamp, str(parsed.get("recordedAt", "")))
        self._ids[world_id] = {item["recordId"]: item for item in records}
        self._last_seq[world_id] = last_seq
        self._last_stamp[world_id] = last_stamp

    def _stamp(self, world_id: str) -> str:
        now = self._clock().astimezone(timezone.utc)
        text = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        previous = self._last_stamp.get(world_id, "")
        return text if text >= previous else previous
