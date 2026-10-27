"""世界的回写：`POST /api/world/changes`。

**不是**把 `EventLog.append` 暴露成 HTTP。这里收的是「世界改了什么」，
由服务端决定怎么落成一条事件：

    { "at": 12000, "change": "task.delivered", "payload": { "taskId": "c_1", ... } }

三条约束，缺一条都拒收：

1. `change` 必须在白名单里（`WORLD_CHANGE_CHECKS`）。不在表里 → 422，指名是哪一条。
2. 每种 change 的**必填字段与取值域**单独校验，多带字段也拒——载荷形状是契约，
   宽松解析会让两端的理解悄悄分叉。
3. `kind` 由服务端写死成 `world.changed`。调用方说不了自己是什么类型的事件。

**为什么信封与载荷要分层。** 信封的 `at` 是世界时间（毫秒），而神迹的落点是
一个格子坐标。第一版把两者都叫 `at`，于是 `{"at": 1, "change": "miracle", "at": {"x":1}}`
要么被当成「世界时间是 1」而坐标丢失，要么被当成坐标而时间丢失——两种都静默。
分层之后这两个 `at` 各在各的位置，不会撞。

为什么值得开这个口子：只增日志是双向的线。世界读 `task.*` 决定干什么，
写 `world.changed` 记下做成了什么。少了后半段，记忆（#7）与规则引擎（#6）
就没有素材——它们要的是「世界发生过什么」，不是「上游要过什么」。

为什么仍然只开这一个口子：这条端点能写的**只有世界改变**这一种事实，
且每一种都有 schema。它不能伪造 `task.settled`，不能撤单，不能改历史——
`EventLog` 仍然没有 update/delete，触发器仍然拦着。
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from events.log import EventLog, EventValidationError

router = APIRouter()

#: 回写事件的 kind。服务端写死，调用方不能指定。
WORLD_CHANGED = "world.changed"
#: 回写事件的操作者。世界自己。
ACTOR = "world"

#: 信封只允许这两个键加 `payload`。多一个都说明调用方在猜协议。
_ENVELOPE_KEYS = {"at", "change", "payload"}


class WorldChangeError(ValueError):
    """回写载荷不合规。与 EventValidationError 分开：一个是事件本身坏了，
    一个是「你说的这件事世界做不出来」。"""


def _require(payload: dict[str, Any], key: str, kind: type | tuple[type, ...], path: str) -> Any:
    if key not in payload:
        raise WorldChangeError(f"{path} 缺字段 {key}")
    value = payload[key]
    kinds = kind if isinstance(kind, tuple) else (kind,)
    # bool 是 int 的子类，要单独挡：True 不该被当成 1。
    # 但只有**要求数字**时才挡——要求 bool 时它本来就合法。
    if isinstance(value, bool) and int in kinds:
        raise WorldChangeError(f"{path}.{key} 不能是布尔值")
    if not isinstance(value, kind):
        names = " / ".join(item.__name__ for item in kinds)
        raise WorldChangeError(f"{path}.{key} 必须是 {names}")
    return value


def _require_str(payload: dict[str, Any], key: str, path: str) -> str:
    value = _require(payload, key, str, path)
    if value.strip() == "":
        raise WorldChangeError(f"{path}.{key} 不能为空")
    return value


def _optional_str(payload: dict[str, Any], key: str, path: str) -> str | None:
    if key not in payload or payload[key] is None:
        return None
    return _require_str(payload, key, path)


def _only(payload: dict[str, Any], allowed: set[str], path: str) -> None:
    extra = set(payload) - allowed
    if extra:
        raise WorldChangeError(f"{path} 有不认识的字段：{', '.join(sorted(extra))}")


def _check_task_delivered(payload: dict[str, Any], path: str) -> None:
    _only(payload, {"taskId", "summary", "workerId", "source", "taskKind"}, path)
    _require_str(payload, "taskId", path)
    _require_str(payload, "summary", path)
    _require_str(payload, "workerId", path)
    source = _require_str(payload, "source", path)
    if source not in ("feed", "local"):
        raise WorldChangeError(f"{path}.source 必须是 feed 或 local，收到 {source!r}")
    task_kind = _require_str(payload, "taskKind", path)
    if task_kind not in ("code", "research", "writing", "quick"):
        raise WorldChangeError(f"{path}.taskKind 不认识：{task_kind!r}")


def _check_building_built(payload: dict[str, Any], path: str) -> None:
    _only(payload, {"instanceId", "prefabId", "displayName", "summary"}, path)
    _require_str(payload, "instanceId", path)
    _require_str(payload, "prefabId", path)
    _require_str(payload, "displayName", path)
    # summary 是「这栋楼为哪条活而建」；开局常驻的楼没有来由，允许 null。
    _optional_str(payload, "summary", path)


def _check_building_removed(payload: dict[str, Any], path: str) -> None:
    _only(payload, {"instanceId", "displayName"}, path)
    _require_str(payload, "instanceId", path)
    _require_str(payload, "displayName", path)


def _check_miracle(payload: dict[str, Any], path: str) -> None:
    _only(payload, {"miracle", "at"}, path)
    miracle = _require_str(payload, "miracle", path)
    if miracle not in ("lamp", "tree", "cat"):
        raise WorldChangeError(f"{path}.miracle 不认识：{miracle!r}")
    at = _require(payload, "at", dict, path)
    _only(at, {"x", "y"}, f"{path}.at")
    _require(at, "x", int, f"{path}.at")
    _require(at, "y", int, f"{path}.at")


def _check_weather(payload: dict[str, Any], path: str) -> None:
    _only(payload, {"weather"}, path)
    weather = _require_str(payload, "weather", path)
    if weather not in ("clear", "rain", "storm"):
        raise WorldChangeError(f"{path}.weather 不认识：{weather!r}")


def _check_tide(payload: dict[str, Any], path: str) -> None:
    """拨潮水。记的是**覆盖**，不是当时的潮位。

    潮位本身是 `now` 的纯函数，记下来等于记时钟；「在什么时刻把潮水压到多少、
    压到什么时候」才是一次事件，而且它进存档，会留在世界状态里。
    """
    _only(payload, {"level", "until"}, path)
    # `_require` 已经挡掉 bool（要求数字时 True 不算 1），这里只管取值域。
    level = _require(payload, "level", (int, float), path)
    if not 0 <= level <= 1:
        raise WorldChangeError(f"{path}.level 必须在 0..1，收到 {level}")
    until = _require(payload, "until", (int, float), path)
    if until < 0:
        raise WorldChangeError(f"{path}.until 不能为负")


def _check_world_vitals(payload: dict[str, Any], path: str) -> None:
    """一天结束了，世界的心电图。四个标量加一个日子。

    这条与其余几条不同：它记的**不是世界改了什么**，而是世界现在什么样。
    收在这里是因为它是内环唯一被允许的对外输出（补充设计 §0 的边界）——
    `DayClosed` 之后抛一份快照出去，谁接是别人的事。

    取值范围按补充设计 §2.3 逐个卡死。宽松解析会让一份坏掉的读数安静地
    流到下游导演手里，而导演的动作（注入事件）是从这些数推出来的。
    """
    _only(payload, {"day", "meanValence", "meanArousal", "infoEntropy", "isolatedHoldersCount"}, path)
    day = _require(payload, "day", int, path)
    if day < 0:
        raise WorldChangeError(f"{path}.day 不能为负，收到 {day}")
    for key in ("meanValence",):
        value = _require(payload, key, (int, float), path)
        if not -1 <= value <= 1:
            raise WorldChangeError(f"{path}.{key} 必须在 -1..1，收到 {value}")
    for key in ("meanArousal", "infoEntropy"):
        value = _require(payload, key, (int, float), path)
        if not 0 <= value <= 1:
            raise WorldChangeError(f"{path}.{key} 必须在 0..1，收到 {value}")
    isolated = _require(payload, "isolatedHoldersCount", int, path)
    if isolated < 0:
        raise WorldChangeError(f"{path}.isolatedHoldersCount 不能为负，收到 {isolated}")


#: 白名单：change → 校验函数。不在表里的一律拒收。
WORLD_CHANGE_CHECKS: dict[str, Callable[[dict[str, Any], str], None]] = {
    "task.delivered": _check_task_delivered,
    "building.built": _check_building_built,
    "building.removed": _check_building_removed,
    "miracle": _check_miracle,
    "weather": _check_weather,
    "tide": _check_tide,
    "world.vitals": _check_world_vitals,
}


def validate_world_change(body: Any) -> tuple[str, float, dict[str, Any]]:
    """校验一条回写。返回 (change, at, payload)。

    纯函数，不碰日志——所以「什么算合法的世界改变」可以离线单测，
    也可以和客户端的 `WorldChange` 联合类型逐条对照。
    """
    if not isinstance(body, dict):
        raise WorldChangeError("载荷必须是 JSON 对象")

    extra = set(body) - _ENVELOPE_KEYS
    if extra:
        raise WorldChangeError(f"信封有不认识的字段：{', '.join(sorted(extra))}")

    change = _require_str(body, "change", "信封")
    check = WORLD_CHANGE_CHECKS.get(change)
    if check is None:
        allowed = "、".join(sorted(WORLD_CHANGE_CHECKS))
        raise WorldChangeError(f"不认识的世界改变 {change!r}；白名单：{allowed}")

    at = body.get("at")
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        raise WorldChangeError("信封.at 必须是数字（世界时间毫秒）")
    if at < 0:
        raise WorldChangeError("信封.at 不能为负")
    # 任意精度的整数过得了上面两道检查，却在 `float()` 上炸 OverflowError。
    # 它不是 WorldChangeError，写日志的端点于是回 500——而这里每一处拒绝
    # 都该是 422。`append` 里还有一道 `_check_at`，但那时候异常已经从
    # 校验层漏出去了，报出来的不再是「信封.at 有问题」这句话。
    try:
        at_ms = float(at)
    except OverflowError:
        raise WorldChangeError(
            f"信封.at 太大，转不成世界时间：{at}。世界时间以毫秒计，没有这么大的数"
        ) from None

    payload = _require(body, "payload", dict, "信封")
    check(payload, change)
    return change, at_ms, payload


def _log_of(request: Request) -> EventLog:
    log = getattr(request.app.state, "event_log", None)
    if log is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.event_log 未装配")
    return log


@router.post("/api/world/changes", status_code=201)
def record_world_change(request: Request, body: Any = Body(...)) -> dict[str, object]:
    """世界把「我做成了什么」记回日志。

    这里不校验 `at` 是不是「现在」：世界时间由世界自己走，服务端没有它的时钟。
    它只保证这条事件的时间来自调用方而不是自己编的。
    """
    change, at, payload = validate_world_change(body)
    log = _log_of(request)
    try:
        event = log.append(
            kind=WORLD_CHANGED,
            actor=ACTOR,
            payload={"change": change, **payload},
            at=at,
        )
    except EventValidationError as exc:  # pragma: no cover - 校验已在上游做过
        raise WorldChangeError(str(exc)) from exc
    return {"id": event.id}


def register_error_handler(app) -> None:
    @app.exception_handler(WorldChangeError)
    async def _world_change_error(_request: Request, exc: WorldChangeError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})
