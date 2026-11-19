"""人物决策：让她在作息换腿时有自己的主意。

**和牌子那条路的区别**：牌子只写一句话（装饰，不改行为）；这条路要改行为——
LLM 可以让她不去作息表安排的地方，而是去一个她记着的地方。世界校验后执行。

**纪律**：
- 作息是默认，偏离要有理由。模型拿不到记忆就不许偏离。
- 理由写回记忆，下次又影响选择——这条回路是「意想不到但说得通」的来源。
- 失败一律回 `{"ok": false}` + 200：LLM 挂了人物就照旧走作息，世界不停。
- 返回值是结构化 JSON，不是自由文本——调用方要拿它做判据，不能猜。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Request

from oracle import prompt_hygiene as hygiene
from oracle.orchestrator import ModelFailed, ModelUnavailable, ModelCaller

router = APIRouter()


def _system_prompt() -> str:
    return (
        "你在给一个像素世界里的村民做决定：她下一步去哪里。\n"
        "作息表是默认——没特别的理由就照走。\n"
        "只有她的记忆里真的有理由偏离时才偏离：比如她记得昨天集市缺货，\n"
        "今天就想多搬两份炭；或者她记得对谁欠过人情，想去找那个人。\n"
        "偏离时必须给一句理由，不超过 20 个字。\n"
        "只从「可选场所」里选，不许选列表外的。不许编记忆里没有的事。\n"
        "返回 JSON：{\"action\": \"follow\"} 或 "
        "{\"action\": \"deviate\", \"siteId\": \"...\", \"activityId\": \"...\", \"reason\": \"...\"}\n"
    )


def _user_prompt(body: dict[str, Any]) -> str:
    # 全部字段过 prompt_hygiene 再进提示词：空字段不进、长小数不进、
    # 内部程序 id / 调试字段不进（只读白名单字段，其余一律当没有）。
    name = hygiene.text(body.get("villagerName")) or "她"
    lines = [f"人物：{name}"]
    day = hygiene.whole_int(body.get("day"))
    if day is not None:
        lines.append(f"第 {day} 天")
    lines.append(f"作息说：{hygiene.text(body.get('routineLabel')) or '（无）'}")

    memories = body.get("memories")
    rendered: list[str] = []
    if isinstance(memories, list):
        for item in memories[:hygiene.MAX_MEMORIES]:
            if not isinstance(item, dict):
                continue
            mem_text = hygiene.text(item.get("text"))
            if mem_text is None:
                continue
            mem_day = hygiene.whole_int(item.get("day"))
            prefix = f"第 {mem_day} 天" if mem_day is not None else ""
            rendered.append(f"{prefix} {mem_text}" if prefix else mem_text)
    if rendered:
        lines.append("她记得：")
        lines.extend(f"  {line}" for line in hygiene.unique(rendered))
    else:
        lines.append("她记得：（今天没什么特别的）")

    sites = body.get("availableSites")
    site_lines: list[str] = []
    if isinstance(sites, list):
        seen_ids: set[str] = set()
        for site in sites:
            if not isinstance(site, dict):
                continue
            site_id = hygiene.text(site.get("siteId"))
            if site_id is None or site_id in seen_ids:
                continue
            seen_ids.add(site_id)
            site_name = hygiene.text(site.get("siteName")) or site_id
            acts = hygiene.str_items(site.get("activities"))
            site_lines.append(
                f"{site_id}（{site_name}）：{'、'.join(acts)}" if acts
                else f"{site_id}（{site_name}）"
            )
    if site_lines:
        lines.append("可选场所：")
        lines.extend(f"  {line}" for line in site_lines)

    lines.append("请做决定。")
    return "\n".join(lines)


def build_messages(body: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _user_prompt(body)},
    ]


def parse_decision(raw: str) -> dict[str, Any] | None:
    """把模型返回的 JSON 收成决策对象；空则 None。"""
    text = raw.strip()
    # 模型可能裹在 ```json ``` 里，剥掉。
    if text.startswith("```"):
        lines = text.split("\n")
        # 去掉首行（```json）和末行（```）
        lines = [line for line in lines if not line.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    action = parsed.get("action")
    if action not in ("follow", "deviate"):
        return None
    if action == "deviate":
        site_id = parsed.get("siteId")
        activity_id = parsed.get("activityId")
        reason = parsed.get("reason")
        if not site_id or not activity_id or not reason:
            return None
        return {
            "ok": True,
            "action": "deviate",
            "siteId": str(site_id),
            "activityId": str(activity_id),
            "reason": str(reason)[:40],
        }
    reason = parsed.get("reason")
    return {
        "ok": True,
        "action": "follow",
        "reason": str(reason)[:40] if reason else "",
    }


def _caller_of(request: Request) -> ModelCaller:
    injected = getattr(request.app.state, "model_caller", None)
    if injected is not None:
        return injected
    from oracle import orchestrator

    return orchestrator.env_caller()


@router.post("/api/world/villager-decision")
def villager_decision(request: Request, body: Any = Body(...)) -> Any:
    if not isinstance(body, dict):
        return {"ok": False, "reason": "请求体必须是 JSON 对象"}
    try:
        caller = _caller_of(request)
        reply = caller(build_messages(body))
    except ModelUnavailable as exc:
        return {"ok": False, "reason": str(exc)}
    except ModelFailed as exc:
        return {"ok": False, "reason": str(exc)}
    decision = parse_decision(reply)
    if decision is None:
        return {"ok": False, "reason": "模型没有给出可用的决策"}
    return decision


def register_routes(app: Any) -> None:
    app.include_router(router)
