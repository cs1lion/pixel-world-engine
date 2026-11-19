"""Lore-to-World 资料编译器主流程。

输入任意 200–2000 字背景资料（小说设定、历史剧本或项目文档）与目标人数 N，
调用 Provider 生成 WorldBundle v1 JSON。生成不是终点——

1. Python 侧跑与前端同构的 Schema 校验（`schema.validate_world_bundle`）；
2. 有 violations 就把**结构化错误清单**回传给模型做自修复，最多 2 轮；
3. 超限仍非法则抛 `WorldCompileError`，报告里带着全部违规与最后一轮原文，
   绝不把半成品交给调用方。

人数口径：契约只要求 cast 非空（人数是资料里读出来的，不固定 7 人），
编译器另查「实际人数 == 目标 N」，差一位也算违规、回灌给模型。
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from .providers import Provider, clean_json_text
from . import schema as bundle_schema

#: 背景资料字数口径：少于 200 字编不出世界，多于 2000 字超出本版承诺。
LORE_MIN_CHARS = 200
LORE_MAX_CHARS = 2000

#: 自修复重试上限：首轮 + 2 轮修复 = 最多 3 次模型调用。
MAX_REPAIR_ROUNDS = 2

#: 回传给模型的上一轮回答截断长度，防「模型输出了十层嵌套垃圾」把上下文撑爆。
LAST_REPLY_TRUNCATE = 4000


class WorldCompileError(Exception):
    """编译失败：带着结构化报告，绝不返回半成品。"""

    def __init__(self, report: dict[str, Any]) -> None:
        self.report = report
        super().__init__(report["message"])


class WorldCompiler:
    def __init__(self, provider: Provider) -> None:
        self.provider = provider

    def compile(self, lore_text: str, cast_size: int) -> dict[str, Any]:
        """编译背景资料为 WorldBundle v1；失败抛 WorldCompileError。"""
        text = lore_text.strip()
        if len(text) < LORE_MIN_CHARS or len(text) > LORE_MAX_CHARS:
            raise ValueError(
                f"背景资料须为 {LORE_MIN_CHARS}..{LORE_MAX_CHARS} 字，收到 {len(text)} 字"
            )
        if not isinstance(cast_size, int) or isinstance(cast_size, bool) or cast_size < 1:
            raise ValueError(f"目标人数 N 必须是正整数，收到 {cast_size!r}")

        prompt = compile_prompt(text, cast_size)
        last_violations: list[dict[str, str]] | None = None
        last_reply = ""
        for attempt in range(1 + MAX_REPAIR_ROUNDS):
            reply = self.provider.complete(prompt)
            last_reply = reply
            bundle = _parse_json_reply(reply)
            if bundle is None:
                violations = [
                    {
                        "path": "bundle",
                        "code": "json.parse",
                        "message": "模型的回答不是可解析的 JSON；请只输出 JSON 本体，不要 markdown 围栏与闲话",
                    }
                ]
            else:
                result = bundle_schema.validate_world_bundle(bundle)
                size_violations = _check_cast_size(bundle, cast_size)
                if result["ok"] and not size_violations:
                    return bundle
                violations = result["violations"] + size_violations
            last_violations = violations
            prompt = repair_prompt(text, cast_size, reply, violations)
        raise WorldCompileError(
            {
                "ok": False,
                "rounds": 1 + MAX_REPAIR_ROUNDS,
                "violations": last_violations or [],
                "lastReply": last_reply[:LAST_REPLY_TRUNCATE],
                "message": (
                    f"编译失败：{1 + MAX_REPAIR_ROUNDS} 轮后仍不合法，"
                    f"共 {len(last_violations or [])} 条违规；没有输出任何半成品"
                ),
            }
        )


def _parse_json_reply(reply: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(clean_json_text(reply))
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _check_cast_size(bundle: dict[str, Any], cast_size: int) -> list[dict[str, str]]:
    cast = bundle.get("cast")
    if isinstance(cast, list) and len(cast) != cast_size:
        return [
            {
                "path": "cast",
                "code": "cast.sizeMismatch",
                "message": f"cast 长度必须是 {cast_size}，实际是 {len(cast)}",
            }
        ]
    return []


RULES_BRIEF = """WorldBundle v1 规则（输出必须全部满足）：
- schemaVersion 必须是 1。
- meta: {id 非空字符串, title 非空字符串, loreSummary 非空字符串, seed 是 0..2147483647 的整数}。
- climate: {kind 只能是 temperate/tropical/arctic 之一, weatherWeights 对象，键只能是 clear/rain/storm/fog，值是 0..1 的有限小数，至少有一个大于 0}。
- grid: {width, height 都是正整数}。
- regions: 数组（可空）；每项 {id/label 非空字符串且 id 唯一, x/y 非负整数, w/h 正整数, x+w <= grid.width 且 y+h <= grid.height, tags 是非空字符串数组}。
- prefabs: 数组（可空）；每项 {id 非空且唯一, footprint:{w,h 正整数}, clearMargin 非负整数, door:{x,y 整数格} 必须在 footprint 之外, workSpots 非空数组且每项都在 footprint 之内}。
- cast: 数组，长度必须等于目标人数 N；每项 {id/name/persona 非空字符串且 id/name 唯一, initialRelations 数组(可为空), 每项 {to 指向 cast 内其他 id, trust/warmth/familiarity 是 0..1 有限小数, debt 是 -1..1 有限小数}, voiceProfile {pitch 0..1, tempo 0.5..2, warmth 0..1}}。
- phases: 可选数组；每项 {id/label 非空, kind 只能是 countdown/climate/vote/crisis 之一；countdown 要正整数 afterTicks, climate 要合法 toClimate, vote/crisis 要非空 condition}。"""


def compile_prompt(lore_text: str, cast_size: int) -> str:
    return (
        f"把下面这份背景资料编译成 WorldBundle v1 JSON，目标居民数 N={cast_size}。\n"
        f"资料：\n<<<{lore_text}>>>\n\n规则：\n{RULES_BRIEF}\n\n"
        "只输出 JSON，不要 markdown 围栏，不要解释。"
    )


def repair_prompt(lore_text: str, cast_size: int, previous_reply: str, violations: list[dict[str, str]]) -> str:
    return (
        f"把下面这份背景资料编译成 WorldBundle v1 JSON，目标居民数 N={cast_size}。\n"
        f"资料：\n<<<{lore_text}>>>\n\n规则：\n{RULES_BRIEF}\n\n"
        "上一次的输出不合法，结构化错误如下：\n"
        f"{json.dumps(violations, ensure_ascii=False)}\n\n"
        f"上一次的输出原文：\n{previous_reply[:LAST_REPLY_TRUNCATE]}\n\n"
        "按错误修正后重新输出 JSON，仍然只要 JSON 本体。"
    )
