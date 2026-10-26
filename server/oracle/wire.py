"""客户端线协议：`{intent, model, source}`。

`/api/world/intent` 的响应形状是**前端已经冻结**的（见
`world-client/src/world/intent-client.ts`）。服务端没有资格改它来让自己好写，
所以这里做一层显式的翻译：

    模型的原话（十种 intent）
        │
        ├─ setWeather / setTide / build / demolish /
        │  miracle / carry                       →  落到白名单命令，过校验
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

from rules.schema import CARRY_ITEMS, TIDE_OVERRIDE_MAX_MS, Command, CommandRejected, validate_command

#: 客户端的十种意图。与 `intent-schema.ts` 的 `IntentKind` 逐个对上。
#:
#: 「逐个对上」这句话有东西守着：`world-client/test/intent-contract.test.ts`
#: 拿两边的源直接比。少一种的后果不是报错，是两边对同一句话说不一样的话——
#: `setTide` 就缺席过一次，客户端与冻结样例都认它，这里抛「未知意图」。
INTENT_KINDS = (
    "dispatch",
    "complete",
    "cancelPending",
    "setWeather",
    "setTide",
    "build",
    "demolish",
    "miracle",
    "carry",
    "unknown",
)

#: 每种意图允许的字段。未知字段直接拒——与客户端 `ALLOWED_KEYS` 同一张表。
ALLOWED_KEYS: dict[str, frozenset[str]] = {
    "dispatch": frozenset({"kind", "taskKind", "summary"}),
    "complete": frozenset({"kind"}),
    "cancelPending": frozenset({"kind"}),
    "setWeather": frozenset({"kind", "weather"}),
    "setTide": frozenset({"kind", "level", "durationMs"}),
    "build": frozenset({"kind", "templateId", "at"}),
    # 两个键都在表里，但必须且只能给一个：见 `validate_intent` 的 demolish 分支。
    "demolish": frozenset({"kind", "instanceId", "templateId"}),
    "miracle": frozenset({"kind", "miracle", "at"}),
    "carry": frozenset({"kind", "villager", "carries"}),
    "unknown": frozenset({"kind", "reason"}),
}

TASK_KINDS = ("code", "research", "writing", "quick")
MIRACLES = ("light", "tree", "cat")
#: 渡有仪式认得的凭证在 `rules/schema.py` 声明一次，这里引它——不自己再写一份。
#: 客户端 `world/gate.ts` 与它是同一套闭集词，三只嘴说三句话就一定会漂。


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
    if kind == "setTide":
        return validate_command(
            {
                "command": "tide.setLevel",
                "args": {"value": intent["level"], "durationMs": intent["durationMs"]},
            },
            world,
        )
    if kind == "build":
        args: dict[str, Any] = {"prefabId": intent["templateId"]}
        if intent.get("at") is not None:
            args["at"] = intent["at"]
        return validate_command({"command": "building.add", "args": args}, world)
    if kind == "demolish":
        # 有实例 id 就用实例 id：模板 id 无法指出要拆哪一栋，拿它去拆等于
        # 替用户挑了「第一栋」。只有调用方明确只给了模板时才交模板给世界判。
        instance_id = intent.get("instanceId")
        if instance_id is not None:
            return validate_command(
                {"command": "building.remove", "args": {"instanceId": instance_id}}, world
            )
        # 客户端意图的 `templateId` 不是白名单字段：世界侧拆楼只收 instanceId。
        # 这里不能凭空编一个 id（`templateId#1` 会拆错楼），只能拒。
        raise WireError(
            "demolish 需要 instanceId：模板 id 指不出要拆哪一栋，"
            "请先在上下文里找到那一栋的 instanceId"
        )
    if kind == "miracle":
        args = {"kind": intent["miracle"]}
        if intent.get("at") is not None:
            args["at"] = intent["at"]
        return validate_command({"command": "miracle.spawn", "args": args}, world)
    if kind == "carry":
        return validate_command(
            {
                "command": "villager.carry",
                "args": {"villager": intent["villager"], "carries": intent["carries"]},
            },
            world,
        )
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
    elif kind == "setTide":
        _tide(raw)
    elif kind == "build":
        _non_empty(raw, "templateId", "templateId")
        _point(raw.get("at"), world)
    elif kind == "demolish":
        instance_id = _optional_non_empty(raw, "instanceId", "instanceId")
        template_id = _optional_non_empty(raw, "templateId", "templateId")
        if instance_id is not None and template_id is not None:
            raise WireError("demolish 只接受 instanceId 或 templateId 之一，不能同时给")
        if instance_id is None and template_id is None:
            raise WireError("demolish 需要 instanceId（指名道姓）或 templateId（按模板拆）")
    elif kind == "miracle":
        _one_of(raw, "miracle", MIRACLES, "miracle")
        _point(raw.get("at"), world)
    elif kind == "carry":
        # 按**名字**点人，与客户端 `carry` 意图同源：上下文只给得起名字。
        # 那个人在不在，是世界判的事——这里只管形状。
        _non_empty(raw, "villager", "villager")
        _carries(raw)
    elif kind == "unknown":
        _non_empty(raw, "reason", "reason")

    return raw, to_command(raw, world)


def _carries(raw: dict[str, Any]) -> None:
    """凭证清单：必须是数组，且每一件都在闭集里。

    空数组合法——「让她两手空空」是说得出口的。只有给没有收，
    那道门就永远开着，世界再也回不到没人有灯的样子。
    """
    if "carries" not in raw:
        raise WireError("carries 缺字段：要带什么，一件都没有就是两手空空")
    carries = raw["carries"]
    if not isinstance(carries, list):
        raise WireError("carries 必须是数组")
    for item in carries:
        if not isinstance(item, str) or item not in CARRY_ITEMS:
            raise WireError(
                f"carries 的 {item!r} 不在取值域里：可选 {' / '.join(CARRY_ITEMS)}"
            )


def _tide(raw: dict[str, Any]) -> None:
    """拨潮：水位 0..1，时长是正数毫秒且不超上限。

    上限直接引 `rules/schema.py` 的 `TIDE_OVERRIDE_MAX_MS`——潮汐同时是世界时钟，
    一条能永久按住它的命令会让所有依赖它的确定性松动。客户端 `tide.ts` 里是同一个数，
    三处各写一遍就一定会漂。

    与客户端 `parseIntent` 的 setTide 分支逐条同源：水位和时长都收 int/float、
    都拒 bool 与 NaN/Inf。这里放宽一点、那边严一点，表现就是同一条意图
    在客户端过得去、在服务端被 502——而用户只看到「没听懂」。
    """
    level = raw.get("level")
    if isinstance(level, bool) or not isinstance(level, (int, float)) or level != level:
        raise WireError("level 必须是数字")
    if not 0 <= level <= 1:
        raise WireError(f"level 必须在 0..1，收到 {level}")
    duration = raw.get("durationMs")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration != duration:
        raise WireError("durationMs 必须是数字")
    if duration <= 0:
        raise WireError("durationMs 必须是正数毫秒")
    if duration > TIDE_OVERRIDE_MAX_MS:
        raise WireError(
            f"durationMs 最多 {TIDE_OVERRIDE_MAX_MS}，收到 {duration}——再久就成了夺权，不只是拨一下"
        )


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


def _optional_non_empty(raw: dict[str, Any], key: str, field: str) -> str | None:
    """可省略的非空字符串：省略是 `None`，给了就必须有内容。"""
    if key not in raw:
        return None
    return _non_empty(raw, key, field)


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
