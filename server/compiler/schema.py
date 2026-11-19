"""WorldBundle v1 的 Python 侧校验器。

与前端 `world-client/src/world/bundle/validator.ts` **同构**：同一套字段口径、
同一套 violation code、同一套 path 命名、同一个遍历顺序（schemaVersion →
meta → climate → grid → regions → prefabs → cast → phases）。两边各自实现、
各自被自己的测试钉住；任何一边改规则，另一边必须同步，否则同一份模型输出
会在两边得到不同的判决。

确定性口径与世界内核一致：纯函数，不读时间、不摇随机数、不碰网络。
"""

from __future__ import annotations

import math
from typing import Any

SCHEMA_VERSION = 1

CLIMATE_IDS = ("temperate", "tropical", "arctic")
WEATHER_IDS = ("clear", "rain", "storm", "fog")
PHASE_KINDS = ("countdown", "climate", "vote", "crisis")

VOICE_PITCH_MIN = 0.0
VOICE_PITCH_MAX = 1.0
VOICE_TEMPO_MIN = 0.5
VOICE_TEMPO_MAX = 2.0
VOICE_WARMTH_MIN = 0.0
VOICE_WARMTH_MAX = 1.0

RELATION_MIN = 0.0
RELATION_MAX = 1.0
RELATION_DEBT_MIN = -1.0
RELATION_DEBT_MAX = 1.0

SEED_MAX = 0x7FFFFFFF


def validate_world_bundle(raw: Any) -> dict[str, Any]:
    """校验一份可能是模型吐出来的 JSON，返回 {ok, violations}。

    不抛异常：校验器本来就是给自修复 loop 喂输入的，抛异常等于把修复线索扔掉。
    violations 的顺序是确定的（字段声明序 × 数组下标），同一份输入永远得到
    同一份输出。
    """
    violations: list[dict[str, str]] = []

    def push(path: str, code: str, message: str) -> None:
        violations.append({"path": path, "code": code, "message": message})

    if not isinstance(raw, dict):
        push("bundle", "bundle.notObject", "WorldBundle 必须是对象")
        return {"ok": False, "violations": violations}

    if raw.get("schemaVersion") != SCHEMA_VERSION:
        push(
            "schemaVersion",
            "schemaVersion.unsupported",
            f"schemaVersion 必须是 {SCHEMA_VERSION}，收到 {show(raw.get('schemaVersion'))}",
        )

    _validate_meta(raw.get("meta"), push)
    _validate_climate(raw.get("climate"), push)
    _validate_grid(raw.get("grid"), push)
    _validate_regions(raw.get("regions"), raw.get("grid"), push)
    _validate_prefabs(raw.get("prefabs"), push)
    _validate_cast(raw.get("cast"), push)
    _validate_phases(raw.get("phases"), push)

    return {"ok": not violations, "violations": violations}


def _validate_meta(meta: Any, push: Any) -> None:
    if meta is None:
        push("meta", "meta.missing", "缺 meta（id / title / loreSummary / seed）")
        return
    if not isinstance(meta, dict):
        push("meta", "meta.notObject", "meta 必须是对象")
        return
    _require_non_empty_string(meta, "id", "meta.id", push)
    _require_non_empty_string(meta, "title", "meta.title", push)
    _require_non_empty_string(meta, "loreSummary", "meta.loreSummary", push)
    seed = _as_int(meta.get("seed"))
    if seed is None or seed < 0 or seed > SEED_MAX:
        push(
            "meta.seed",
            "meta.seed.range",
            f"meta.seed 必须是 0..{SEED_MAX} 的整数，收到 {show(meta.get('seed'))}",
        )


def _validate_climate(climate: Any, push: Any) -> None:
    if climate is None:
        push("climate", "climate.missing", "缺 climate（kind / weatherWeights）")
        return
    if not isinstance(climate, dict):
        push("climate", "climate.notObject", "climate 必须是对象")
        return
    if climate.get("kind") not in CLIMATE_IDS:
        push(
            "climate.kind",
            "climate.kind.unsupported",
            f"climate.kind 取值 {show(climate.get('kind'))} 不在 {'/'.join(CLIMATE_IDS)} 里",
        )
    weights = climate.get("weatherWeights")
    if weights is None:
        push("climate.weatherWeights", "climate.weatherWeights.missing", "缺 climate.weatherWeights")
        return
    if not isinstance(weights, dict):
        push("climate.weatherWeights", "climate.weatherWeights.notObject", "climate.weatherWeights 必须是对象")
        return
    saw_positive = False
    for key, value in weights.items():
        path = f"climate.weatherWeights.{key}"
        if key not in WEATHER_IDS:
            push(path, "climate.weatherWeights.unknown", f"未知天气 {key}；只认 {'/'.join(WEATHER_IDS)}")
            continue
        if not _is_finite_number(value) or value < 0 or value > 1:
            push(path, "climate.weatherWeights.range", f"天气权重必须是 0..1 的有限小数，收到 {show(value)}")
            continue
        if value > 0:
            saw_positive = True
    if not saw_positive:
        push(
            "climate.weatherWeights",
            "climate.weatherWeights.allZero",
            "weatherWeights 全部为 0（或缺席）：这个气候下永远不会有任何天气",
        )


def _validate_grid(grid: Any, push: Any) -> None:
    if grid is None:
        push("grid", "grid.missing", "缺 grid（width / height）")
        return
    if not isinstance(grid, dict):
        push("grid", "grid.notObject", "grid 必须是对象")
        return
    _require_positive_int(grid, "width", "grid.width", "grid.range", push)
    _require_positive_int(grid, "height", "grid.height", "grid.range", push)


def _validate_regions(regions: Any, grid: Any, push: Any) -> None:
    if regions is None:
        push("regions", "regions.missing", "缺 regions（可为空数组，但不能缺）")
        return
    if not isinstance(regions, list):
        push("regions", "regions.notArray", "regions 必须是数组")
        return
    width = _as_int(grid.get("width")) if isinstance(grid, dict) else None
    height = _as_int(grid.get("height")) if isinstance(grid, dict) else None
    seen_ids: set[str] = set()
    for index, entry in enumerate(regions):
        path = f"regions[{index}]"
        if not isinstance(entry, dict):
            push(path, "region.notObject", f"{path} 必须是对象")
            continue
        _require_non_empty_string(entry, "id", f"{path}.id", push)
        _require_non_empty_string(entry, "label", f"{path}.label", push)
        region_id = entry.get("id")
        if isinstance(region_id, str) and region_id != "":
            if region_id in seen_ids:
                push(f"{path}.id", "region.duplicateId", f"分区 id {region_id!r} 重复")
            else:
                seen_ids.add(region_id)
        for key in ("x", "y", "w", "h"):
            is_size = key in ("w", "h")
            value = _as_int(entry.get(key))
            if value is None or value < (1 if is_size else 0):
                push(
                    f"{path}.{key}",
                    "region.bounds.range",
                    f"分区 {key} 必须是{'正' if is_size else '非负'}整数，收到 {show(entry.get(key))}",
                )
        x, y = _as_int(entry.get("x")), _as_int(entry.get("y"))
        w, h = _as_int(entry.get("w")), _as_int(entry.get("h"))
        if (
            width is not None
            and height is not None
            and x is not None
            and y is not None
            and w is not None
            and h is not None
            and (x < 0 or y < 0 or x + w > width or y + h > height)
        ):
            push(
                path,
                "region.outOfBounds",
                f"分区 {region_id!r} 越界：矩形 {x},{y} {w}x{h} 超出了 {width}x{height} 的世界",
            )
        if not isinstance(entry.get("tags"), list):
            push(f"{path}.tags", "region.tags.notArray", f"{path}.tags 必须是数组")
        else:
            for tag_index, tag in enumerate(entry["tags"]):
                if not isinstance(tag, str) or tag == "":
                    push(
                        f"{path}.tags[{tag_index}]",
                        "region.tag.empty",
                        f"标签必须是非空字符串，收到 {show(tag)}",
                    )


def _validate_prefabs(prefabs: Any, push: Any) -> None:
    if prefabs is None:
        push("prefabs", "prefabs.missing", "缺 prefabs（可为空数组，但不能缺）")
        return
    if not isinstance(prefabs, list):
        push("prefabs", "prefabs.notArray", "prefabs 必须是数组")
        return
    seen_ids: set[str] = set()
    for index, entry in enumerate(prefabs):
        path = f"prefabs[{index}]"
        if not isinstance(entry, dict):
            push(path, "prefab.notObject", f"{path} 必须是对象")
            continue
        _require_non_empty_string(entry, "id", f"{path}.id", push)
        prefab_id = entry.get("id")
        if isinstance(prefab_id, str) and prefab_id != "":
            if prefab_id in seen_ids:
                push(f"{path}.id", "prefab.duplicateId", f"蓝图 id {prefab_id!r} 重复")
            else:
                seen_ids.add(prefab_id)
        footprint = entry.get("footprint")
        footprint_w: int | None = None
        footprint_h: int | None = None
        if not isinstance(footprint, dict):
            push(f"{path}.footprint", "prefab.footprint.notObject", f"{path}.footprint 必须是 {{ w, h }}")
        else:
            footprint_w = _as_int(footprint.get("w"))
            footprint_h = _as_int(footprint.get("h"))
            if footprint_w is None or footprint_w < 1:
                push(f"{path}.footprint.w", "prefab.footprint.range", f"占地 w 必须是正整数，收到 {show(footprint.get('w'))}")
            if footprint_h is None or footprint_h < 1:
                push(f"{path}.footprint.h", "prefab.footprint.range", f"占地 h 必须是正整数，收到 {show(footprint.get('h'))}")
        margin = _as_int(entry.get("clearMargin"))
        if margin is None or margin < 0:
            push(
                f"{path}.clearMargin",
                "prefab.clearMargin.range",
                f"clearMargin 必须是非负整数，收到 {show(entry.get('clearMargin'))}",
            )
        door = _as_point(entry.get("door"))
        if door is None:
            push(f"{path}.door", "prefab.door.notPoint", f"{path}.door 必须是整数格 {{ x, y }}")
        elif door[0] < 0 or door[1] < 0:
            push(f"{path}.door", "prefab.door.negative", f"门口坐标不能为负，收到 ({door[0]}, {door[1]})")
        elif (
            footprint_w is not None
            and footprint_h is not None
            and door[0] < footprint_w
            and door[1] < footprint_h
        ):
            push(
                f"{path}.door",
                "prefab.door.insideFootprint",
                f"门口落在占地内，人走不进去；门必须在 {footprint_w}x{footprint_h} 的占地外",
            )
        spots = entry.get("workSpots")
        if not isinstance(spots, list):
            push(f"{path}.workSpots", "prefab.workSpots.notArray", f"{path}.workSpots 必须是数组")
            continue
        if len(spots) == 0:
            push(f"{path}.workSpots", "prefab.workSpots.empty", f"{path}.workSpots 不能为空")
            continue
        for spot_index, spot in enumerate(spots):
            spot_path = f"{path}.workSpots[{spot_index}]"
            point = _as_point(spot)
            if point is None:
                push(spot_path, "prefab.workSpots.notPoint", f"{spot_path} 必须是整数格 {{ x, y }}")
                continue
            if point[0] < 0 or point[1] < 0:
                push(spot_path, "prefab.workSpots.negative", f"工位坐标不能为负，收到 ({point[0]}, {point[1]})")
                continue
            if (
                footprint_w is not None
                and footprint_h is not None
                and (point[0] >= footprint_w or point[1] >= footprint_h)
            ):
                push(
                    spot_path,
                    "prefab.workSpots.outsideFootprint",
                    f"工位落在占地外：({point[0]}, {point[1]}) 不在 {footprint_w}x{footprint_h} 里",
                )


def _validate_cast(cast: Any, push: Any) -> None:
    if cast is None:
        push("cast", "cast.missing", "缺 cast（居民数组，至少 1 位）")
        return
    if not isinstance(cast, list):
        push("cast", "cast.notArray", "cast 必须是数组")
        return
    if len(cast) == 0:
        push("cast", "cast.empty", "cast 不能为空数组：世界至少要有 1 位居民")
        return
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for index, entry in enumerate(cast):
        path = f"cast[{index}]"
        if not isinstance(entry, dict):
            push(path, "cast.notObject", f"{path} 必须是对象")
            continue
        _require_non_empty_string(entry, "id", f"{path}.id", push)
        _require_non_empty_string(entry, "name", f"{path}.name", push)
        _require_non_empty_string(entry, "persona", f"{path}.persona", push)
        member_id = entry.get("id")
        if isinstance(member_id, str) and member_id != "":
            if member_id in seen_ids:
                push(f"{path}.id", "cast.duplicateId", f"居民 id {member_id!r} 重复")
            else:
                seen_ids.add(member_id)
        name = entry.get("name")
        if isinstance(name, str) and name != "":
            if name in seen_names:
                push(f"{path}.name", "cast.duplicateName", f"居民姓名 {name!r} 重复")
            else:
                seen_names.add(name)
        _validate_relations(entry, member_id, cast, path, push)
        _validate_voice(entry.get("voiceProfile"), path, push)


def _validate_relations(entry: dict[str, Any], member_id: Any, cast: list[Any], path: str, push: Any) -> None:
    relations = entry.get("initialRelations")
    if relations is None:
        push(f"{path}.initialRelations", "cast.relations.missing", f"{path}.initialRelations 不能缺（可没有关系，但字段要在）")
        return
    if not isinstance(relations, list):
        push(f"{path}.initialRelations", "cast.relations.notArray", f"{path}.initialRelations 必须是数组")
        return
    cast_ids = {
        member.get("id")
        for member in cast
        if isinstance(member, dict) and isinstance(member.get("id"), str)
    }
    for rel_index, relation in enumerate(relations):
        rel_path = f"{path}.initialRelations[{rel_index}]"
        if not isinstance(relation, dict):
            push(rel_path, "cast.relation.notObject", f"{rel_path} 必须是对象")
            continue
        to = relation.get("to")
        if not isinstance(to, str) or to == "":
            push(f"{rel_path}.to", "cast.relation.to.empty", f"{rel_path}.to 必须是非空字符串")
        elif to == member_id:
            push(f"{rel_path}.to", "cast.relation.to.self", f"{rel_path}.to 不能指向自己（{to!r}）")
        elif to not in cast_ids:
            push(f"{rel_path}.to", "cast.relation.to.unknown", f"{rel_path}.to 指向的 {to!r} 不在这份 cast 里")
        _check_number_range(relation, "trust", f"{rel_path}.trust", RELATION_MIN, RELATION_MAX, "信任", "cast.relation.range", push)
        _check_number_range(relation, "warmth", f"{rel_path}.warmth", RELATION_MIN, RELATION_MAX, "亲密度", "cast.relation.range", push)
        _check_number_range(relation, "debt", f"{rel_path}.debt", RELATION_DEBT_MIN, RELATION_DEBT_MAX, "欠债", "cast.relation.range", push)
        _check_number_range(relation, "familiarity", f"{rel_path}.familiarity", RELATION_MIN, RELATION_MAX, "熟悉度", "cast.relation.range", push)


def _validate_voice(voice: Any, path: str, push: Any) -> None:
    if voice is None:
        push(f"{path}.voiceProfile", "cast.voiceProfile.missing", f"{path}.voiceProfile 不能缺")
        return
    if not isinstance(voice, dict):
        push(f"{path}.voiceProfile", "cast.voiceProfile.notObject", f"{path}.voiceProfile 必须是对象")
        return
    _check_number_range(voice, "pitch", f"{path}.voiceProfile.pitch", VOICE_PITCH_MIN, VOICE_PITCH_MAX, "音高", "cast.voiceProfile.range", push)
    _check_number_range(voice, "tempo", f"{path}.voiceProfile.tempo", VOICE_TEMPO_MIN, VOICE_TEMPO_MAX, "语速", "cast.voiceProfile.range", push)
    _check_number_range(voice, "warmth", f"{path}.voiceProfile.warmth", VOICE_WARMTH_MIN, VOICE_WARMTH_MAX, "暖度", "cast.voiceProfile.range", push)


def _validate_phases(phases: Any, push: Any) -> None:
    if phases is None:
        return
    if not isinstance(phases, list):
        push("phases", "phases.notArray", "phases 必须是数组")
        return
    seen_ids: set[str] = set()
    for index, entry in enumerate(phases):
        path = f"phases[{index}]"
        if not isinstance(entry, dict):
            push(path, "phase.notObject", f"{path} 必须是对象")
            continue
        _require_non_empty_string(entry, "id", f"{path}.id", push)
        _require_non_empty_string(entry, "label", f"{path}.label", push)
        phase_id = entry.get("id")
        if isinstance(phase_id, str) and phase_id != "":
            if phase_id in seen_ids:
                push(f"{path}.id", "phase.duplicateId", f"阶段 id {phase_id!r} 重复")
            else:
                seen_ids.add(phase_id)
        if entry.get("kind") not in PHASE_KINDS:
            push(
                f"{path}.kind",
                "phase.kind.unsupported",
                f"phase.kind 取值 {show(entry.get('kind'))} 不在 {'/'.join(PHASE_KINDS)} 里",
            )
            continue
        kind = entry["kind"]
        if kind == "countdown":
            ticks = _as_int(entry.get("afterTicks"))
            if ticks is None or ticks < 1:
                push(
                    f"{path}.afterTicks",
                    "phase.afterTicks.range",
                    f"countdown 阶段的 afterTicks 必须是正整数，收到 {show(entry.get('afterTicks'))}",
                )
        elif kind == "climate":
            if entry.get("toClimate") not in CLIMATE_IDS:
                push(
                    f"{path}.toClimate",
                    "phase.toClimate.unsupported",
                    f"climate 阶段的 toClimate 必须在 {'/'.join(CLIMATE_IDS)} 里，收到 {show(entry.get('toClimate'))}",
                )
        else:
            condition = entry.get("condition")
            if not isinstance(condition, str) or condition == "":
                push(f"{path}.condition", "phase.condition.empty", f"{kind} 阶段必须给非空的 condition 触发条件")


def _require_non_empty_string(
    source: dict[str, Any],
    key: str,
    path: str,
    push: Any,
) -> None:
    value = source.get(key)
    if not isinstance(value, str) or value == "":
        push(path, f"{path}.empty", f"{path} 必须是非空字符串，收到 {show(value)}")


def _require_positive_int(
    source: dict[str, Any],
    key: str,
    path: str,
    code: str,
    push: Any,
) -> None:
    value = _as_int(source.get(key))
    if value is None or value < 1:
        push(path, code, f"{path} 必须是正整数，收到 {show(source.get(key))}")


def _check_number_range(
    source: dict[str, Any],
    key: str,
    path: str,
    min_value: float,
    max_value: float,
    label: str,
    code: str,
    push: Any,
) -> None:
    value = source.get(key)
    if not _is_finite_number(value) or value < min_value or value > max_value:
        push(path, code, f"{label}参数 {key} 必须是 {min_value}..{max_value} 的有限小数，收到 {show(value)}")


def _as_int(value: Any) -> int | None:
    """只有「整数」进几何与种子；小数一律视为没给。bool 不算数（TS 侧同理）。"""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _as_point(value: Any) -> tuple[int, int] | None:
    if not isinstance(value, dict):
        return None
    x = _as_int(value.get("x"))
    y = _as_int(value.get("y"))
    if x is None or y is None:
        return None
    return (x, y)


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def show(value: Any) -> str:
    """ 与 TS 侧 show() 同口径：字符串带引号，其余照字面量写。 """
    if isinstance(value, str):
        import json

        return json.dumps(value, ensure_ascii=False)
    return str(value)
