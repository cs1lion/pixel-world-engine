"""客户端线协议：`{intent, model, source}`。

`/api/world/intent` 的响应形状是**前端已经冻结**的（见
`world-client/src/world/intent-client.ts`）。服务端没有资格改它来让自己好写，
所以这里做一层显式的翻译：

    模型的原话（八种 intent）
        │
        ├─ setWeather / build / demolish / miracle  →  落到白名单命令，过校验
        ├─ dispatch / complete / cancelPending      →  不是世界改变，原样放行
        └─ unknown / 任何解析失败                    →  unknown

为什么 dispatch / complete / cancelPending 不过白名单：白名单管的是**世界改变**
（改天气、动地形、拨潮汐）。这三种是活的生命周期，世界自己结算时还要再判一次
可行性（有没有活可交付、排队满没满）。把它们塞进命令表会让那张表混进两种
完全不同的事实。

`weather.set` → `setWeather` 这一层映射本身是有价值的：它让「模型说什么」
与「世界认什么」分开演进——加一种命令时，要改的是这里的一行，而不是提示词、
校验器、和世界三处。
"""

from __future__ import annotations

from typing import Any

from rules.schema import Command, CommandRejected, validate_command

#: 客户端的八种意图。与 `intent-schema.ts` 的 `IntentKind` 逐个对上。
INTENT_KINDS = (
    "dispatch",
    "complete",
    "cancelPending",
    "setWeather",
    "build",
    "demolish",
    "miracle",
    "unknown",
)

#: 每种意图允许的字段。未知字段直接拒——与客户端 `ALLOWED_KEYS` 同一张表。
ALLOWED_KEYS: dict[str, frozenset[str]] = {
    "dispatch": frozenset({"kind", "taskKind", "summary"}),
    "complete": frozenset({"kind"}),
    "cancelPending": frozenset({"kind"}),
    "setWeather": frozenset({"kind", "weather"}),
    "build": frozenset({"kind", "templateId", "at"}),
    "demolish": frozenset({"kind", "templateId"}),
    "miracle": frozenset({"kind", "miracle", "at"}),
    "unknown": frozenset({"kind", "reason"}),
}

TASK_KINDS = ("code", "research", "writing", "quick")
MIRACLES = ("light", "tree", "cat")


class WireError(ValueError):
    """模型的回复不是一份合法意图。端点把它转成 502：模型没能给出可用的答案。"""


def to_command(intent: dict[str, Any], world: dict[str, Any] | None = None) -> Command | None:
    """把一份**已通过形状检查**的意图翻成白名单命令。

    返回 `None` 表示这条意图不是世界改变（dispatch / complete / cancelPending
    / unknown），没有命令可过。越界时抛 `CommandRejected`。
    """
    world = world or {}
    kind = intent["kind"]

    if kind == "setWeather":
        return validate_command(
            {"command": "weather.set", "args": {"value": intent["weather"]}}, world
        )
    if kind == "build":
        args: dict[str, Any] = {"prefabId": intent["templateId"]}
        if intent.get("at") is not None:
            args["at"] = intent["at"]
        return validate_command({"command": "building.add", "args": args}, world)
    if kind == "demolish":
        return validate_command(
            {"command": "building.remove", "args": {"instanceId": intent["templateId"]}}, world
        )
    if kind == "miracle":
        args = {"kind": intent["miracle"]}
        if intent.get("at") is not None:
            args["at"] = intent["at"]
        return validate_command({"command": "miracle.spawn", "args": args}, world)
    return None


def validate_intent(raw: Any, world: dict[str, Any] | None = None) -> tuple[dict[str, Any], Command | None]:
    """校验一份意图，返回 `(intent, command)`。不合法抛 `WireError` / `CommandRejected`。

    与客户端 `parseIntent` 的检查**同源**：未知意图、未知字段、枚举外取值、
    非整数坐标、空字符串，逐条一致。这里不重复实现它们——但确实要再查一遍，
    因为服务端不能假设请求来自那个客户端。

    区别：`build` 的 `templateId` 这里**不查注册表**。模板表由请求方发来，
    服务端不知道世界能建什么；那是客户端 `parseIntent` 的活。服务端只保证
    「这条命令的形状与取值范围是对的」。
    """
    if not isinstance(raw, dict):
        raise WireError("意图必须是对象")

    kind = raw.get("kind")
    if not isinstance(kind, str) or kind not in INTENT_KINDS:
        raise WireError(f"未知意图 {kind!r}：可选 {' / '.join(INTENT_KINDS)}")

    allowed = ALLOWED_KEYS[kind]
    extra = set(raw) - allowed
    if extra:
        raise WireError(
            f"意图 {kind!r} 不接受字段 {', '.join(sorted(extra))}："
            f"只接受 {', '.join(sorted(allowed))}"
        )

    if kind == "dispatch":
        _one_of(raw, "taskKind", TASK_KINDS, "taskKind")
        _non_empty(raw, "summary", "summary")
    elif kind == "setWeather":
        _one_of(raw, "weather", ("clear", "rain", "storm"), "weather")
    elif kind == "build":
        _non_empty(raw, "templateId", "templateId")
        _point(raw.get("at"), world)
    elif kind == "demolish":
        _non_empty(raw, "templateId", "templateId")
    elif kind == "miracle":
        _one_of(raw, "miracle", MIRACLES, "miracle")
        _point(raw.get("at"), world)
    elif kind == "unknown":
        _non_empty(raw, "reason", "reason")

    return raw, to_command(raw, world)


def _one_of(raw: dict[str, Any], key: str, allowed: tuple[str, ...], field: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str):
        raise WireError(f"{field} 必须是字符串")
    if value not in allowed:
        raise WireError(f"{field} 的 {value!r} 不在取值域里：可选 {' / '.join(allowed)}")
    return value


def _non_empty(raw: dict[str, Any], key: str, field: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str):
        raise WireError(f"{field} 必须是字符串")
    text = value.strip()
    if text == "":
        raise WireError(f"{field} 不能为空")
    return text


def _point(value: Any, world: dict[str, Any] | None) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise WireError("at 必须是 { x, y } 或省略")
    extra = set(value) - {"x", "y"}
    if extra:
        raise WireError(f"at 不接受字段 {', '.join(sorted(extra))}")
    for axis in ("x", "y"):
        if axis not in value:
            raise WireError(f"at.{axis} 缺字段")
        number = value[axis]
        if isinstance(number, bool) or not isinstance(number, int):
            raise WireError(f"at.{axis} 必须是整数格坐标")
    x, y = value["x"], value["y"]
    world = world or {}
    width, height = world.get("width"), world.get("height")
    if isinstance(width, int) and isinstance(height, int) and not (
        0 <= x < width and 0 <= y < height
    ):
        raise WireError(
            f"at ({x}, {y}) 在世界之外：范围是 0..{width - 1} × 0..{height - 1}"
        )


def unknown_intent(reason: str) -> dict[str, Any]:
    """一个诚实的「没听懂」。**永远带着原因**——空的 reason 用户看不懂。"""
    return {"kind": "unknown", "reason": reason if reason.strip() else "这句话没有对应的世界命令"}


__all__ = [
    "ALLOWED_KEYS",
    "CommandRejected",
    "INTENT_KINDS",
    "WireError",
    "to_command",
    "unknown_intent",
    "validate_intent",
]
