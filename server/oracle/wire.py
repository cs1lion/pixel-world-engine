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

import math
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
    "carry": frozenset({"kind", "villager", "carries", "remove"}),
    "unknown": frozenset({"kind", "reason"}),
}

TASK_KINDS = ("code", "research", "writing", "quick")
MIRACLES = ("light", "tree", "cat")
#: 渡有仪式认得的凭证在 `rules/schema.py` 声明一次，这里引它——不自己再写一份。
#: 客户端 `world/gate.ts` 与它是同一套闭集词，三只嘴说三句话就一定会漂。


class WireError(ValueError):
    """模型的回复不是一份合法意图。

    2026-10-28 补记：这句原来写「端点把它转成 502」。**服务端没有 502。**
    `oracle/api.py` 冻结的失败面是三行——503（没配 Key）/ 422（请求形状不对）/
    200 + unknown（模型没听懂或给的命令越界）。把不存在的状态码写在一个异常类上，
    下一个照它写代码的人会去返回一个端点永远不返回的东西。

    2026-10-28 二次补记：**上面那段原来还接着写「`WireError` 由 `interpret()`
    接住后走 `_failure(...)` → `ok: false` → `_envelope` → HTTP 200 + unknown」，
    而那条路今天不存在。** `interpret()` 的 `try` 只包着 `caller(...)`，
    `WireError` 不可能从那儿抛出来；`parse_reply()` 走的是 `validate_commands`
    → `validate_command`（`rules/schema.py`），抛的是 `CommandRejected`，
    在 `parse_reply` 里被接住落 `_failure`。而 `validate_intent` **在生产与脚本里
    没有调用方**——调用方全在 `server/tests/test_intent_api.py`；`to_command` 只被
    `validate_intent` 调（`wire.py` 内那一处），跟着一起走不到端点（`api.py` 只用
    `wire.unknown_intent`）。所以那句话描述的是一条「本该如此」的设计，不是今天
    跑着的代码——**照它推端点行为会推错。**
    """


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
        # 给与收是两条路：给是整锅换上，收是世界从她现有的里减。
        # 「收回她的鞋」走 carries: [] 会把她手里的灯一起拿走——用户要的
        # 只是一双鞋。收走那条走 remove，两个键必须且只能给一个。
        args: dict[str, Any] = {"villager": intent["villager"]}
        if "remove" in intent:
            args["remove"] = intent["remove"]
        else:
            args["carries"] = intent["carries"]
        return validate_command({"command": "villager.carry", "args": args}, world)
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
        has_carries = "carries" in raw
        has_remove = "remove" in raw
        if has_carries and has_remove:
            raise WireError("carry 只能给 carries 或 remove 之一，不能同时给")
        if not has_carries and not has_remove:
            raise WireError("carry 需要 carries（给她什么）或 remove（收走什么）")
        _carry_list(raw, "carries" if has_carries else "remove")
    elif kind == "unknown":
        _non_empty(raw, "reason", "reason")

    return raw, to_command(raw, world)


def _carry_list(raw: dict[str, Any], field: str) -> None:
    """凭证清单：必须是数组，且每一件都在闭集里。

    两个方向对空数组的态度相反，这是**刻意的**：

    - `carries: []` 合法——「让她放下手的一切」是说得出口的。只有给没有收，
      那道门就永远开着，世界再也回不到没人有灯的样子。
    - `remove: []` 拒——一件都不收，那句话就是没说话。减法的空集不是「不变」，
      是「这句白说了」；放它过，用户会看到一次什么也没发生的「办好了」。

    调用方（`carry` 那一支）已经断定这个键在，所以这里不查缺字段——
    `carries` 与 `remove` 必须且只能给一个是那边的事，这边只管值。

    与客户端 `readCarryList` 逐条同源——两边的错话不一样，用户看到的就是
    「同样一句话，换个入口就换种拒法」。
    """
    carries = raw[field]
    if not isinstance(carries, list):
        raise WireError(f"{field} 必须是数组")
    for item in carries:
        if not isinstance(item, str) or item not in CARRY_ITEMS:
            raise WireError(
                f"{field} 的 {item!r} 不在取值域里：可选 {' / '.join(CARRY_ITEMS)}"
            )
    if field == "remove" and not carries:
        raise WireError("remove 至少要有一件：一件都不收，那句话就是没说话")


def _tide(raw: dict[str, Any]) -> None:
    """拨潮：水位 0..1，时长是正数毫秒且不超上限。

    上限直接引 `rules/schema.py` 的 `TIDE_OVERRIDE_MAX_MS`——潮汐同时是世界时钟，
    一条能永久按住它的命令会让所有依赖它的确定性松动。客户端 `tide.ts` 里是同一个数，
    三处各写一遍就一定会漂。

    与客户端 `parseIntent` 的 setTide 分支逐条同源。`isfinite` 同时挡 NaN 与 Inf：
    只写 `level != level`（NaN 自反）会让 `inf` 一路漏到取值域那句，
    说法变成「必须在 0..1，收到 inf」——客户端对同一条说的是「必须是数字」。
    两边的错话不一样，用户看到的就是「同样一句话，换个入口就换种拒法」。
    """
    level = raw.get("level")
    if isinstance(level, bool) or not isinstance(level, (int, float)) or not math.isfinite(level):
        raise WireError("level 必须是数字")
    if not 0 <= level <= 1:
        raise WireError(f"level 必须在 0..1，收到 {level}")
    duration = raw.get("durationMs")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration):
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
