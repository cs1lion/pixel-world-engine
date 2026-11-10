"""作业牌子的一句话：让模型按场所与库存说她此刻在做什么。

**为什么单开一个端点，而不是塞进 `/api/world/intent`**：那条路的输出是
白名单命令（会改世界），这条路只写一句话（牌子上显示，进存档的
`routineLabel`）。两件事的失败面完全不同——意图解析失败要回 unknown 让玩家
知道没听懂；牌子生成失败只该退回原文案，不能因此让世界停摆。

**事实由调用方给，模型只负责措辞**：场所名、活动、库存、在场的人、第几天，
全部随请求递进来。提示词明写「只能用这些事实，不许编」。模型编出来的细节
会被当场写进存档的牌子，而牌子是对外唯一凭据——所以这条比意图更保守：
宁可只说「在搬炭」，不许说「搬了三十筐炭」。

失败一律回 `{"ok": false}` + 200：牌子是装饰，不是世界事实，
上游挂了不该让页面出现红色错误。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request

from oracle.orchestrator import ModelFailed, ModelUnavailable, ModelCaller

router = APIRouter()

#: 牌子最长多少字。世界里的牌子是 20 字上下，再长就压到别的字上了。
MAX_NOTE_CHARS = 20


def _system_prompt() -> str:
    return (
        "你在给一个像素世界里的村民写一句状态牌。\n"
        "只写一句中文，不超过 20 个字，不带引号、不带句号、不换行。\n"
        "**只能用用户给的事实**：场所、活动、库存、在场的人、第几天。\n"
        "不许编数字、编对话、编天气、编不存在的物品。\n"
        "语气克制，像镇志里的一行小注，不像小说。"
    )


def _user_prompt(body: dict[str, Any]) -> str:
    site = str(body.get("siteName") or body.get("site") or "这处")
    activity = str(body.get("activity") or "work")
    stock = body.get("stock")
    day = body.get("day")
    people = body.get("people") or []
    canonical = body.get("canonical")
    lines = [f"场所：{site}", f"活动：{activity}"]
    if isinstance(canonical, str) and canonical.strip() != "":
        # 原牌子是**权威事实**：模型只换说法，不许改事实。
        lines.append(f"现在牌子上写的是：{canonical.strip()}（请换一种说法，事实一个都不许变）")
    if isinstance(stock, int):
        lines.append(f"这里的存货：{stock} 份")
    if isinstance(day, int):
        lines.append(f"第 {day} 天")
    if isinstance(people, list) and people:
        lines.append(f"此刻在场：{'、'.join(str(p) for p in people)}")
    lines.append("请写这一句状态牌。")
    return "\n".join(lines)


def build_messages(body: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _user_prompt(body)},
    ]


def clean_note(raw: str) -> str | None:
    """把模型的话收成一句牌子：去引号、去换行、截断；空则 None。"""
    text = " ".join(raw.split())
    for quote in ('"', "'", "「", "」", "“", "”", "‘", "’"):
        text = text.replace(quote, "")
    text = text.strip(" 。.,，；;、")
    if text == "":
        return None
    return text[:MAX_NOTE_CHARS]


def _caller_of(request: Request) -> ModelCaller:
    injected = getattr(request.app.state, "model_caller", None)
    if injected is not None:
        return injected
    from oracle import orchestrator

    return orchestrator.env_caller()


@router.post("/api/world/work-note")
def work_note(request: Request, body: Any = Body(...)) -> Any:
    if not isinstance(body, dict):
        return {"ok": False, "text": None, "reason": "请求体必须是 JSON 对象"}
    try:
        caller = _caller_of(request)
        reply = caller(build_messages(body))
    except ModelUnavailable as exc:
        # 没有 Key 是常态（离线开发、CI）：牌子退回原文案，世界照常跑。
        return {"ok": False, "text": None, "reason": str(exc)}
    except ModelFailed as exc:
        return {"ok": False, "text": None, "reason": str(exc)}
    text = clean_note(reply)
    if text is None:
        return {"ok": False, "text": None, "reason": "模型没有给出可用的一句话"}
    return {"ok": True, "text": text}


def register_routes(app: Any) -> None:
    app.include_router(router)
