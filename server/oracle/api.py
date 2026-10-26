"""`POST /api/world/intent`：意图解析的 HTTP 面。

响应形状是前端**已经冻结**的那一份（`world-client/src/world/intent-client.ts`）：

    { "intent": {...}, "model": "...", "source": "model" }

所以这个端点的职责很窄：调模型、过白名单、把结果装进那个信封。
它**不改世界**——世界改变由世界自己回写 `world.changed`（`/api/world/changes`）。

三种失败，三种状态码，因为用户能做的事不同：

| 状态 | 含义 | 用户能做什么 |
|---|---|---|
| 503 | 服务端没配 Key | 找部署的人 |
| 422 | 请求本身形状不对 | 客户端 bug |
| 200 + unknown | 模型没听懂，或给的命令越界 | 换句话再说一遍 |

**越界命令不给错误码，给 unknown。** 请求没错、模型也答了，只是答的东西
世界不肯做。这正是客户端 `routeIntent` 把一切失败落到 unknown 的同一条纪律：
没做就是没做，不要退而求其次猜一个。原因写在 `reason` 里，用户看得见。
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from events.projection import merge_world_size, world_summary
from oracle import orchestrator, wire
from oracle.orchestrator import Interpretation, ModelCaller, ModelUnavailable

router = APIRouter()


def _caller_of(request: Request) -> ModelCaller:
    """取注入的调用者；没有就按环境变量造一个。

    注入是为了测试：提示词 → 解析 → 白名单 → 线上形状整条路径都能在
    没有任何 Key 的机器上跑到，只有真正的那一次 HTTP 换成假的。
    """
    injected = getattr(request.app.state, "model_caller", None)
    if injected is not None:
        return injected
    # 每次现造，不缓存：环境变量可能在进程起来之后才设（脚本、容器、测试）。
    return orchestrator.env_caller()


@router.post("/api/world/intent")
def interpret_intent(request: Request, body: Any = Body(...)) -> Any:
    problem = _check_request(body)
    if problem is not None:
        return JSONResponse(status_code=422, content={"detail": problem})

    try:
        caller = _caller_of(request)
        result = orchestrator.interpret(
            body["utterance"],
            body["templates"],
            body.get("context"),
            caller,
            _world_summary(request, body),
        )
    except ModelUnavailable as exc:
        # 缺 Key 是部署问题，不是"没听懂"。503 让客户端把那句话说成
        # 「意图服务不可用」，而不是「世界听不明白你」。
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    return _envelope(result, _model_name(request))


def _world_summary(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """白名单用来判越界的那份世界摘要。

    三份来源各管一段，**优先序是刻意的**（理由见 `events.projection.world_summary`）：

    1. **建筑 id 听客户端的 `context.built`。** 那是世界此刻的自述，含开局就有的楼
       ——那些楼在日志里没有 `building.built` 事件，只活在客户端的模拟快照里。
       拿日志当全集，第一次拆一栋开局楼就会把之后每一句 demolish 误判成不存在。
    2. 客户端没发 `context` 时退回事件日志投影。它不全，但比没有强——而且它正好是
       实验里 `context=None` 那条更严的路。
    3. **尺寸听客户端的。** 地图是设定集的内容，服务端没有它；猜错会把一个
       合法坐标判成越界。

    客户端发来的 `buildingCount` 一律忽略——那是它对世界的看法，不是事实。

    **日志读不动时不给 500，给「不知道」。** 世界摘要是判越界的帮手，
    不是「这句话翻不翻得出来」的前提：日志坏着的当口，仍然该把「下雨吧」
    翻成天气命令，只是这一句不再查建筑存在性。多一个 500 就是多一种
    客户端没准备过的失败，少的却是白名单里本来照常生效的那几项检查。

    **「不知道」只覆盖建筑那一半。** 尺寸是客户端直接发来的，与日志好不好
    没有关系，所以它必须活着出去——坐标越界检查靠的只有它。
    """
    world_size = body.get("worldSize")
    context = body.get("context")
    try:
        return world_summary(
            _log_of(request),
            world_size if isinstance(world_size, dict) else None,
            context if isinstance(context, dict) else None,
        )
    except Exception:
        # 读不到日志 = 服务端无从判断世界上有哪些楼。这与「日志里一条建筑记录
        # 也没有」是同一种处境，按同一条纪律处理：证不明就不判，让世界自己去说。
        # **尺寸必须原样带出去。** 早先这里回一个光秃秃的 `{}`，于是日志一坏，
        # 客户端报的 width/height 跟着一起丢，坐标越界检查整个失效——
        # 「在 5000,5000 建个工坊」就这么过了白名单。尺寸与建筑是两件事。
        return merge_world_size({}, world_size)


def _log_of(request: Request):
    log = getattr(request.app.state, "event_log", None)
    if log is None:  # pragma: no cover - 装配漏了才会走到
        raise RuntimeError("app.state.event_log 未装配")
    return log


def _check_request(body: Any) -> str | None:
    """请求形状。返回错误说明，`None` 表示没问题。"""
    if not isinstance(body, dict):
        return "请求体必须是 JSON 对象"
    if not isinstance(body.get("utterance"), str):
        return "utterance 必须是字符串"
    templates = body.get("templates")
    if not isinstance(templates, list):
        return "templates 必须是数组"
    for item in templates:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            return "templates 的每一项必须是 {id, displayName, boundTask}"
    context = body.get("context")
    if context is not None and not isinstance(context, dict):
        return "context 必须是对象或省略"
    return None


def _envelope(result: Interpretation, model_name: str) -> dict[str, Any]:
    """把 `Interpretation` 装进冻结的信封。

    所有"没做成"都表现为 `intent.kind === 'unknown'`，原因在 `reason` 里。
    客户端只读 `intent`，不必为错误码分支。
    """
    if not result.ok:
        return _unknown(model_name, result.error or "没能把这句话翻成命令")

    if not result.commands:
        return _unknown(model_name, result.narrative or "这句话不是在要求世界做任何事")

    intent = command_to_intent(result.commands[0])
    if intent is None:
        return _unknown(model_name, result.narrative or "这条命令世界还没法执行")

    body: dict[str, Any] = {"intent": intent, "model": model_name, "source": "model"}
    if result.narrative:
        body["narrative"] = result.narrative
    return body


def _unknown(model_name: str, reason: str) -> dict[str, Any]:
    return {"intent": wire.unknown_intent(reason), "model": model_name, "source": "none"}


def command_to_intent(command: Any) -> dict[str, Any] | None:
    """白名单命令 → 客户端意图。与 `wire.to_command` 互为逆。

    两边各写一遍是有代价的，但这层映射值得：它让「模型说什么」与
    「世界认什么」分开演进。加一条命令时改这里的一行，而不是提示词、
    校验器、世界三处。
    """
    name, args = command.name, command.args
    if name == "weather.set":
        return {"kind": "setWeather", "weather": args["value"]}
    if name == "tide.setLevel":
        return {
            "kind": "setTide",
            "level": args["value"],
            "durationMs": args["durationMs"],
        }
    if name == "building.add":
        # `at` 可省略（用户没说地点，世界自己挑）——与 `miracle.spawn` 同一处理。
        return {"kind": "build", "templateId": args["prefabId"], "at": args.get("at")}
    if name == "building.remove":
        # 实例身份必须原样到世界：模板 id 无法指出要拆哪一栋。
        return {"kind": "demolish", "instanceId": args["instanceId"]}
    if name == "miracle.spawn":
        return {"kind": "miracle", "miracle": args["kind"], "at": args.get("at")}
    if name == "villager.carry":
        # 渡有仪式：名字原样到客户端——`carries` 已经是闭集里的词。
        # 客户端 `applyIntent` 再把它翻成 id，那是世界才知道的事。
        return {"kind": "carry", "villager": args["villager"], "carries": args["carries"]}
    # `npc.setSchedule` 在白名单里，但客户端与世界都还没有这条意图。
    # 返回 None → 落 unknown 并说清，而不是装作执行了。
    return None


def _model_name(request: Request) -> str:
    injected = getattr(request.app.state, "model_name", None)
    return injected or os.environ.get("LLM_MODEL", "unknown")


def register_routes(app: Any) -> None:
    app.include_router(router)
