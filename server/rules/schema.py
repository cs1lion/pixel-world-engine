"""规则层：命令的白名单与校验。

这是 LLM 与世界之间唯一的闸门。模型说什么不重要，**过得了这里才算数**。

三条与 `world-client/src/world/intent-schema.ts` 同源的原则：

1. **只认七条命令。** 不在表里的一律拒，并在错误里列出表里有什么——
   拒一条命令而不说可选什么，模型下次还会犯同一个错。
2. **未知字段直接拒。** 模型多写 `confidence`、多带一个 `count`，说明它对形状的
   理解已经偏了。静默丢掉会让它一直错下去。
3. **只管形状，不管可行性。** 「那栋楼有没有人在干活」「迷雾揭没揭」是世界自己
   判的事（在 `Simulation` 里）。这里只回答「这份 JSON 是不是一条合法命令」。
   唯一的例外是**点名了世界之外的东西**：坐标越界、楼数超上限、实例不存在。
   这些不是「这件事现在办不办得到」，而是「你说的那个东西不在这儿」——
   与形状错误同类，放在这里一次拦掉，别让世界再答第二遍。

校验是**纯函数**：同样的输入永远同样的结果，不读时钟、不碰日志、不联网。
所以整套白名单可以离线单测，也可以在实验里对 55 条真实语句逐条复核。

#: 2026-10-28 补记：上面这句原来写「60 条」。全仓只有这一处写 60——
#: `docs/INTENT_EXPERIMENT.md`、`docs/adr/ADR_BUILDING_AT_OPTIONAL.md`、
#: 以及 `scripts/intent_experiment.py` 自己的注释（十几处）都写 55。
#: 55 是 `LEGAL 26 + OUT_OF_BOUNDS 12 + CHITCHAT 10 + AMBIGUOUS 7`
#: （`scripts/intent_experiment.py` 里那四个列表）。这个数会随用例增减而漂，
#: 别照抄这一段，去数那四个列表。

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
#: 镇子会变成一个实心方块。
#:
#: 2026-10-28 补记：这里原来写「上限的作用是让『建 100 栋楼』在**规则层**就被拒」。
#: 规则层没有「数量」这个概念——`building.add` 的 args 只接受 `prefabId` 与 `at`，
#: 模型真写 `count: 100` 会被 `_only` 以 `unexpected-field` 拒，那是「字段不认识」，
#: 不是「数量超上限」。真正的机制在 `_building_add` 里：拿世界**当前**楼数与 40 比。
#: 连带一个测不到的用例：实验的越界组有一条 `("建 100 栋楼", "数量上限")`，
#: 它跑在一份 6 栋楼的世界上，永远撞不到 `building-limit`。
MAX_BUILDINGS = 40

WEATHERS = ("clear", "rain", "storm")
MIRACLES = ("light", "tree", "cat")
#: 作息名。世界侧目前只有这一套日常，别的名字世界不认识。
SCHEDULES = ("altar", "garden", "promenade", "shelter")
#: 渡有仪式认得的凭证。与 `world-client/src/world/gate.ts` 的 `CARRY_ITEMS`
#: 必须一致：区域声明的 `requires` 与角色带着的 `carries` 是**同一套闭集词**。
#: 两边各写一遍就一定会漂，漂开的表现是「她明明带着灯，那道门就是不认」——
#: 只有截图才看得见的那种 bug。
CARRY_ITEMS = ("lamp", "shoes")


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
    # `isinstance(x, int)` 收的是**任意精度**的整数，而 `float()` 只吃得到 1.8e308。
    # 中间那一大段（比如 10**400）过了上面那道类型检查，却在这一行炸 OverflowError——
    # 它不是 CommandRejected，API 层接不住，于是线上协议多出第四种失败面：500。
    # 冻结的失败面只有三种（503 / 422 / 200+unknown），所以这里必须自己收口。
    try:
        number = float(value)
    except OverflowError:
        _fail(
            "type-mismatch",
            f"{path}.{key} 必须是有限数字，收到 {value}——这个数大到转不成世界时间",
        )
    if number != number or number in (float("inf"), float("-inf")):  # NaN / Inf
        _fail("type-mismatch", f"{path}.{key} 必须是有限数字")
    return number


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


# ------------------------------------------------------------------ 七条命令
#: 2026-10-28 补记：这个小节标题原来写「六条命令」，而它下面挂着 7 个校验函数，
#: 同一个文件第 7 行还写着「只认七条命令」——一份文件里隔 134 行自我矛盾，
#: 而且少数的那条正是 `npc.setSchedule`（下面第 320 行附近专门解释它为什么
#: 在白名单里却没有提示词条目）。照小节标题数白名单的人会少数一条。


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

    # 数量上限：世界已经满了就不再收。
    # 2026-10-28 补记：这一条原来写「让『建 100 栋楼』在规则层被拒，而不是让
    # 世界一栋栋建到没地方走」——它描述的是协议里表达不出来的请求。见
    # `MAX_BUILDINGS` 上面那段：一次「要 100 栋」没有字段可写。这里实际做的
    # 只有一件事：世界已经有 40 栋了，就不再收第 41 栋。
    count = world.get("buildingCount")
    if isinstance(count, int) and count >= MAX_BUILDINGS:
        _fail(
            "building-limit",
            f"世界已经有 {count} 栋楼了，上限是 {MAX_BUILDINGS} 栋",
        )
    if "at" not in args:
        # 用户没说地点。**世界自己挑**，不是模型挑——模型不知道哪儿空着，
        # 它挑的那个数要么被拒，要么落在别人家门口。省略 `at` 就是「随地」。
        #
        # 这一条是协议对齐，不是放宽：客户端 `intent-schema.ts` 的 build 意图
        # 早就写着 `at: GridPoint | null`，`readPoint(undefined)` 回 null。
        # 服务端却一直要求 `at` 必填，比它要对齐的那份协议更严。后果测出来了：
        # 合法用例里不说地点的那些，模型全部答 unknown——它没有坐标可填。
        #
        # 2026-10-28 补记：这一行原来写「55 条合法用例里 5 条」，两处都不对。
        # 55 是**全套**用例（26 合法 / 12 越界 / 10 闲聊 / 7 歧义），不是合法用例；
        # 不说地点的是 `building.add` 5 条里的 4 条（另 1 条给了 `(40,45)`）。
        # 更值得记的是：这不是新错——`docs/adr/ADR_BUILDING_AT_OPTIONAL.md`
        # 第 21-23 行已经为同一个错记过一次（「add 是 4 条不是 5 条，而括号里
        # 正好只列了 4 个例子，写着「5 条」」）。改掉的错从 ADR 回到了代码里，
        # 所以这里连数都不写了：那四个列表自己会说话。
        return {"prefabId": prefab_id}
    return {"prefabId": prefab_id, "at": _point(args, "at", "building.add", world)}


def _building_remove(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    """拆楼要点名一栋**存在**的楼。

    早先这里只查「instanceId 是不是非空字符串」。于是「拆掉第 999 号楼」——
    一个世界上根本没有的 id——能原样过闸，然后由世界在更后面说「没这一栋」。
    这不是严不严格的问题，是**两道闸门重复答同一个问题**：坐标越界在 `_point`
    里就拦了，实例不存在凭什么要放到世界那一层？

    拦的是「点名了世界之外的东西」，不是「这栋楼现在能不能拆」——后者
    （有没有人在里面干活）仍然是世界自己判的事，见模块开头第 3 条。

    没有建筑记录时跳过：证不明就不判，让世界照它自己的话说。
    """
    _only(args, {"instanceId"}, "building.remove")
    instance_id = _text(args, "instanceId", "building.remove")

    known = world.get("buildingIds")
    if isinstance(known, (list, tuple, set)) and instance_id not in known:
        _fail("unknown-instance", f"building.remove.instanceId {instance_id!r} 不在世界里；{_known_buildings(known)}")
    return {"instanceId": instance_id}


def _known_buildings(known: "list[str] | tuple[str, ...] | set[str]") -> str:
    """拒收时把世界上有什么列出来。

    纪律同模块开头第 1 条：拒一条命令而不说可选什么，模型下次还会犯同一个错。
    楼多的时候不全列——四十个 id 会把错误消息撑成一段话，而模型要的只是
    「你编的那个不在，照现状里那些抄」。

    非字符串的条目不列：这句话是给模型看的，列一个它抄不出来的形状只会
    让它再编一个。`buildingIds` 的两个来源（客户端 `context.built`、日志投影）
    本来就只收字符串，所以这里防的是有人手搓一份世界摘要塞进来——
    校验器不该因为一句给人看的话就整个崩掉。
    """
    existing = sorted(item for item in known if isinstance(item, str))
    shown = "、".join(existing[:8])
    if not existing:
        return "现在一栋楼也没有"
    if len(known) > 8:
        return f"现有 {len(known)} 栋，前几栋是 {shown} 等"
    return f"现有的是 {shown}"


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


def _villager_carry(args: dict[str, Any], world: dict[str, Any]) -> dict[str, Any]:
    """给谁什么凭证，或从谁手里收走什么（渡有仪式）。

    **按名字点人，不按 id。** 喂给模型的上下文里只有名字（客户端
    `intent-context.ts` 的 `busy` 是 `{name, taskKind}`），叫 id 就是
    `demolish` 那个 bug 重演：模型手里没有 id 可填，只能编一个。
    那个人在不在，是世界判的事——这里只管形状。

    凭证逐件查，不整锅端：收下 `lamp` 放过 `torch` 比整条拒更难查。

    `carries` 是完整清单（空数组＝「让她两手空空」），`remove` 是减法。
    两者必须且只能给一个——混着给，世界不知道该照哪句办。要有 `remove`
    是因为说话的人未必知道她此刻带着什么：离线规则没有名册也没有她的兜，
    「收回她的鞋」翻不成一个完整的最终清单，硬翻成空清单会把灯一起拿走。
    """
    _only(args, {"villager", "carries", "remove"}, "villager.carry")
    villager = _text(args, "villager", "villager.carry")

    has_carries = "carries" in args
    has_remove = "remove" in args
    if has_carries and has_remove:
        _fail("conflicting-fields", "villager.carry 只能给 carries 或 remove 之一，不能同时给")
    if not has_carries and not has_remove:
        _fail("missing-field", "villager.carry 需要 carries（给她什么）或 remove（收走什么）")

    field = "carries" if has_carries else "remove"
    carries = args[field]
    if not isinstance(carries, list):
        _fail("type-mismatch", f"villager.carry.{field} 必须是数组")
    for item in carries:
        if not isinstance(item, str) or item not in CARRY_ITEMS:
            _fail(
                "out-of-domain",
                f"villager.carry.{field} 的 {item!r} 不在取值域里：可选 {' / '.join(CARRY_ITEMS)}",
            )
    if field == "remove" and not carries:
        _fail("empty-list", "villager.carry.remove 至少要有一件：一件都不收，那句话就是没说话")
    return {"villager": villager, field: list(carries)}


#: 白名单：命令名 → 校验函数。不在表里的一律拒收。
#:
#: 七条都过这里。但「过得了白名单」不等于「世界认得这个意图」：
#: `npc.setSchedule` 目前客户端与世界都还没有对应的意图，所以提示词不列它
#: （`oracle/prompt.py`），端点收到它也会落 unknown（`oracle/api.py`）。
#: 两层各说各的实话：这里管「这条命令合法吗」，那里管「这个世界能执行吗」。
COMMAND_CHECKS: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "weather.set": _weather_set,
    "tide.setLevel": _tide_set_level,
    "building.add": _building_add,
    "building.remove": _building_remove,
    "miracle.spawn": _miracle_spawn,
    "npc.setSchedule": _npc_set_schedule,
    "villager.carry": _villager_carry,
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
