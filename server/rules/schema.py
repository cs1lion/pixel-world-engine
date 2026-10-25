"""规则层：命令的白名单与校验。

这是 LLM 与世界之间唯一的闸门。模型说什么不重要，**过得了这里才算数**。

三条与 `world-client/src/world/intent-schema.ts` 同源的原则：

1. **只认六条命令。** 不在表里的一律拒，并在错误里列出表里有什么——
   拒一条命令而不说可选什么，模型下次还会犯同一个错。
2. **未知字段直接拒。** 模型多写 `confidence`、多带一个 `count`，说明它对形状的
   理解已经偏了。静默丢掉会让它一直错下去。
3. **只管形状，不管可行性。** 「那栋楼有没有人在干活」「迷雾揭没揭」是世界自己
   判的事（在 `Simulation` 里）。这里只回答「这份 JSON 是不是一条合法命令」。

校验是**纯函数**：同样的输入永远同样的结果，不读时钟、不碰日志、不联网。
所以整套白名单可以离线单测，也可以在实验里对 60 条真实语句逐条复核。

错误码是稳定的字符串，不是中文句子。调用方（端点、实验脚本、将来的世界）
按码分支，句子只给人看。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

#: 潮位覆盖的时长上限，与 `world-client/src/world/tide.ts` 的
#: `TIDE_OVERRIDE_MAX_MS` 必须一致。理由见那个文件：潮汐同时是世界时钟，
#: 覆盖只能是一次「拨一下」，不能是夺权。
TIDE_OVERRIDE_MAX_MS = 2 * 60_000

#: 世界里最多能有多少栋楼。
#:
#: 这个数不是拍脑袋的容量——`setup.ts` 的地图是 96×72，铺满之后没有空地可走，
#: 镇子会变成一个实心方块。上限的作用是让「建 100 栋楼」在**规则层**就被拒，
#: 而不是等世界一栋一栋建到没地方。
MAX_BUILDINGS = 40

WEATHERS = ("clear", "rain", "storm")
MIRACLES = ("light", "tree", "cat")
#: 作息名。世界侧目前只有这一套日常，别的名字世界不认识。
SCHEDULES = ("altar", "garden", "promenade", "shelter")


@dataclass(frozen=True)
class CommandRejected(ValueError):
    """一条命令没通过白名单。`code` 给程序，`message` 给人。"""

    code: str
    message: str

    def __str__(self) -> str:  # pragma: no cover - 只为日志好看
        return f"{self.code}: {self.message}"


@dataclass(frozen=True)
class Command:
    """校验过的命令。`name` + `args`，没有多余字段。"""

    name: str
    args: dict[str, Any]

    def to_json(self) -> dict[str, Any]:
        return {"command": self.name, **self.args}


def _fail(code: str, message: str) -> None:
    raise CommandRejected(code, message)


def _only(args: dict[str, Any], allowed: set[str], path: str) -> None:
    extra = set(args) - allowed
    if extra:
        _fail(
            "unexpected-field",
            f"{path} 有不认识的字段：{', '.join(sorted(extra))}；只接受 {', '.join(sorted(allowed))}",
        )


def _number(args: dict[str, Any], key: str, path: str) -> float:
    if key not in args:
        _fail("missing-field", f"{path} 缺字段 {key}")
    value = args[key]
    # bool 是 int 的子类：True 不该被当成 1。
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail("type-mismatch", f"{path}.{key} 必须是数字")
    if value != value or value in (float("inf"), float("-inf")):  # NaN / Inf
        _fail("type-mismatch", f"{path}.{key} 必须是有限数字")
    return float(value)


def _integer(args: dict[str, Any], key: str, path: str) -> int:
    if key not in args:
        _fail("missing-field", f"{path} 缺字段 {key}")
    value = args[key]
    if isinstance(value, bool) or not isinstance(value, int):
        _fail("type-mismatch", f"{path}.{key} 必须是整数")
    return value


def _text(args: dict[str, Any], key: str, path: str) -> str:
    if key not in args:
        _fail("missing-field", f"{path} 缺字段 {key}")
    value = args[key]
    if not isinstance(value, str):
        _fail("type-mismatch", f"{path}.{key} 必须是字符串")
    text = value.strip()
    if text == "":
        _fail("empty-value", f"{path}.{key} 不能为空")
    return text


def _one_of(args: dict[str, Any], key: str, allowed: tuple[str, ...], path: str) -> str:
    value = _text(args, key, path)
    if value not in allowed:
        _fail(
            "out-of-domain",
            f"{path}.{key} 的 {value!r} 不在取值域里：可选 {' / '.join(allowed)}",
        )
    return value


# ------------------------------------------------------------------ 六条命令


def _weather_set(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"value"}, "weather.set")
    return {"value": _one_of(args, "value", WEATHERS, "weather.set")}


def _tide_set_level(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    """潮位是**有期限的覆盖**，所以必须带时长。

    没给时长就落不了——一条"永久按住潮汐"的命令本身就不该存在。
    `durationMs` 可省略，省略时回落到上限；给了就必须在 `(0, 上限]` 里。
    """
    _only(args, {"value", "durationMs"}, "tide.setLevel")
    level = _number(args, "value", "tide.setLevel")
    if level < 0 or level > 1:
        _fail("out-of-range", f"tide.setLevel.value 必须在 0..1，收到 {level}")

    duration = args.get("durationMs", TIDE_OVERRIDE_MAX_MS)
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        _fail("type-mismatch", "tide.setLevel.durationMs 必须是数字")
    if duration <= 0:
        _fail("out-of-range", "tide.setLevel.durationMs 必须是正数毫秒")
    if duration > TIDE_OVERRIDE_MAX_MS:
        _fail(
            "duration-too-long",
            f"tide.setLevel.durationMs 最多 {TIDE_OVERRIDE_MAX_MS}，收到 {duration}——"
            "再久就成了夺权，不只是拨一下",
        )
    return {"value": level, "durationMs": int(duration)}


def _point(args: dict[str, Any], key: str, path: str, world: dict[str, Any]) -> dict[str, int]:
    if key not in args:
        _fail("missing-field", f"{path} 缺字段 {key}")
    value = args[key]
    if not isinstance(value, dict):
        _fail("type-mismatch", f"{path}.{key} 必须是 {{x, y}}")
    _only(value, {"x", "y"}, f"{path}.{key}")
    x = _integer(value, "x", f"{path}.{key}")
    y = _integer(value, "y", f"{path}.{key}")

    width = world.get("width")
    height = world.get("height")
    if isinstance(width, int) and isinstance(height, int):
        if not (0 <= x < width and 0 <= y < height):
            _fail(
                "out-of-range",
                f"{path}.{key} ({x}, {y}) 在世界之外：范围是 0..{width - 1} × 0..{height - 1}",
            )
    return {"x": x, "y": y}


def _building_add(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"prefabId", "at"}, "building.add")
    prefab_id = _text(args, "prefabId", "building.add")

    # 数量上限：世界已经满了就不再收。这一条让「建 100 栋楼」在规则层被拒，
    # 而不是让世界一栋栋建到没地方走。
    count = world.get("buildingCount")
    if isinstance(count, int) and count >= MAX_BUILDINGS:
        _fail(
            "building-limit",
            f"世界已经有 {count} 栋楼了，上限是 {MAX_BUILDINGS} 栋",
        )
    return {"prefabId": prefab_id, "at": _point(args, "at", "building.add", world)}


def _building_remove(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"instanceId"}, "building.remove")
    return {"instanceId": _text(args, "instanceId", "building.remove")}


def _miracle_spawn(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"kind", "at"}, "miracle.spawn")
    kind = _one_of(args, "kind", MIRACLES, "miracle.spawn")
    if "at" in args:
        return {"kind": kind, "at": _point(args, "at", "miracle.spawn", world)}
    return {"kind": kind}


def _npc_set_schedule(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"id", "schedule"}, "npc.setSchedule")
    return {
        "id": _text(args, "id", "npc.setSchedule"),
        "schedule": _one_of(args, "schedule", SCHEDULES, "npc.setSchedule"),
    }


#: 白名单：命令名 → 校验函数。不在表里的一律拒收。
COMMAND_CHECKS: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "weather.set": _weather_set,
    "tide.setLevel": _tide_set_level,
    "building.add": _building_add,
    "building.remove": _building_remove,
    "miracle.spawn": _miracle_spawn,
    "npc.setSchedule": _npc_set_schedule,
}


def validate_command(raw: Any, world: dict[str, Any] | None = None) -> Command:
    """校验一条命令。返回 `Command`，不合法抛 `CommandRejected`。

    `world` 是世界的**摘要**（尺寸、已有楼数），只用来判越界，不改任何状态。
    省略时跳过依赖世界的检查（尺寸、数量），形状类检查照做。
    """
    world = world or {}

    if not isinstance(raw, dict):
        _fail("not-an-object", "命令必须是 JSON 对象")

    name = raw.get("command")
    if not isinstance(name, str):
        _fail("missing-field", "命令缺 command 字段")
    check = COMMAND_CHECKS.get(name)
    if check is None:
        allowed = "、".join(sorted(COMMAND_CHECKS))
        _fail("unknown-command", f"不认识的命令 {name!r}；白名单：{allowed}")

    args = raw.get("args")
    if not isinstance(args, dict):
        _fail("missing-field", f"{name} 缺 args 对象")
    extra = set(raw) - {"command", "args"}
    if extra:
        _fail(
            "unexpected-field",
            f"命令信封有不认识的字段：{', '.join(sorted(extra))}",
        )

    return Command(name=name, args=check(args, world))


def validate_commands(raw: Any, world: dict[str, Any] | None = None) -> list[Command]:
    """校验一串命令。**一条不合法就整串拒**，不做部分接受。

    部分接受是最坏的形状：模型给三条、世界办了两条，用户看到的世界
    既不是他说的、也不是模型说的那个。
    """
    if not isinstance(raw, list):
        _fail("not-an-array", "命令必须是数组")
    return [validate_command(item, world) for item in raw]
