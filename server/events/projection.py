"""从世界现状得出白名单要用的那一份摘要。

**为什么需要它。** `/api/world/intent` 早先只把客户端发来的 `worldSize` 当世界
摘要，于是「这栋楼存不存在」这个问题服务端答不了——它只能信模型说的
`instanceId`。而模型是会编的：实验里「拆掉第 999 号楼」就拿着一个不存在的 id
过了白名单，因为白名单只查「是不是非空字符串」。

**两条来源，一条纪律。** 客户端报事实，服务端定规则。地图尺寸、镇上有哪几栋楼，
是世界的样子，客户端从模拟快照里直接搬过来（`worldSize` / `context.built`）；
什么算越界，是服务端的规矩。模型不写请求体，所以客户端这一侧不是攻击面。

日志投影是**兜底**，不是主源。因为日志是变更记录、不是快照：开局就有的楼
（设定集/蓝图落的）从来没有 `building.built` 事件，只有运行时新建的才有。
拿它当全集，第一次拆一栋开局楼就会把之后每一句 demolish 误判成不存在。

**投影本身是纯函数。** 输入一串事件，输出一个集合，不碰时钟、不碰日志、不联网。
所以它可以离线单测，也可以对同一份日志反复重放。

**只投影建筑，不投影天气潮位。** 天气与潮位是世界状态的连续量，日志里记的是
「拨了一下」而不是「现在是几」。真正要判断它们的世界自己会判；服务端现在
需要回答的只有一个问题——**要点名的那栋楼在不在**。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from events.log import MAX_LIMIT, WorldEvent
from events.world_changes import WORLD_CHANGED

#: 投影认识的两种建筑变化。别的 change 与建筑无关，读到了也当没看见。
_BUILT = "building.built"
_REMOVED = "building.removed"


@dataclass(frozen=True)
class WorldBuildings:
    """日志读出来的建筑集合。

    `recorded` 是 `False` 时表示**日志里没有任何建筑记录**——那不是「世界上一栋楼
    也没有」，而是「服务端无从判断」。两者必须分开：把后者当成前者，
    每一句「拆掉那栋楼」都会被拒，而世界明明在好好地建楼拆楼。

    **反过来的风险也要说清。** 日志有记录但**不全**时（只记了运行时新建的楼，
    开局就有的那些不在里面），投影会少算，于是一句合理的「拆掉它」被误拒。
    所以 `world_summary` 只在客户端没发 `context` 时才用它——见那个函数的说明。
    """

    ids: tuple[str, ...]
    recorded: bool

    def to_world(self) -> dict[str, Any]:
        """拼成 `rules.schema` 吃的世界摘要。

        没有记录时返回空字典——与 `_point` 里「省略 worldSize 就跳过坐标越界」
        是同一条纪律：**证不明就不判**，让世界自己去说。
        """
        if not self.recorded:
            return {}
        return {"buildingIds": list(self.ids), "buildingCount": len(self.ids)}


def project_buildings(events: Iterable[WorldEvent]) -> WorldBuildings:
    """按 id 升序重放事件，得出最后还剩哪些楼。

    调用方必须传升序的事件（`EventLog.read()` 默认就是）。顺序反了的话，
    「先拆后建」会被放成「先建后拆」，投影出的集合是错的——而它看起来完全正常。
    """
    ids: list[str] = []
    recorded = False
    for event in events:
        if event.kind != WORLD_CHANGED:
            continue
        change = event.payload.get("change")
        if change not in (_BUILT, _REMOVED):
            continue
        recorded = True
        instance_id = event.payload.get("instanceId")
        # 形状由 `world_changes` 的校验负责，这里只取用。非字符串或空白的当没看见，
        # 而不是抛错——投影不该因为一条怪事件就整体失效。空白也要挡：
        # `EventLog` 自己不校验载荷内容，绕过 `world_changes` 直写时 `""` 进得来。
        if not isinstance(instance_id, str) or instance_id.strip() == "":
            continue
        if change == _BUILT:
            # 同一位 instanceId 建两次是上游的事；集合里去重，不重复计数。
            if instance_id not in ids:
                ids.append(instance_id)
        elif instance_id in ids:
            ids.remove(instance_id)
    return WorldBuildings(ids=tuple(ids), recorded=recorded)


def building_ids_from_context(context: dict[str, Any] | None) -> list[str] | None:
    """从客户端发来的世界现状里取建筑 id 清单。**这是主源。**

    它含开局就有的楼——那些楼在日志里没有 `building.built` 事件，只在客户端
    的模拟快照里。所以客户端报了建筑的时候就别再问日志：日志那份一定更少，
    而更少的那份会让一句合理的「拆掉它」被拒。

    返回 `None` 表示**客户端没给出能用的建筑清单**，与「给了，但是现在一栋也没有」
    是两件事。前者才该退回日志投影；后者是世界此刻的事实，比日志新。

    两组里一组都不是数组时算「没给」而不是「一栋也没有」：客户端形状写错时
    宁可回去翻日志，也不要凭一个空数组宣布世界是空的——那会把每一句
    「拆掉它」都拒掉，正是这个函数要避免的那种错。
    """
    if not isinstance(context, dict):
        return None
    built = context.get("built")
    if not isinstance(built, dict):
        return None
    ids: list[str] = []
    reported = False
    for group in ("town", "wild"):
        entries = built.get(group)
        if not isinstance(entries, list):
            continue
        reported = True
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("instanceId"), str):
                if entry["instanceId"] not in ids:
                    ids.append(entry["instanceId"])
    return ids if reported else None


def world_summary(
    log: Any,
    world_size: dict[str, Any] | None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """世界摘要 = 客户端的现状 + 客户端的地图尺寸 + 日志兜底。

    三份来源各管一段，**优先序是刻意的**：

    1. **建筑 id 听 `context`。** 那是世界此刻的自述，含开局就有的楼。
       客户端说「现在一栋也没有」时就用空集——它比日志新，日志里还留着
       拆掉之前那条 `building.built`。
    2. 客户端没报建筑时退回日志投影。它不全，但比没有强——而且它正好是
       实验里 `context=None` 那条更严的路。
    3. **尺寸听客户端的。** 地图是设定集的内容，服务端没有它；猜错会把一个
       合法坐标判成越界。

    客户端发来的 `buildingCount` 一律忽略——那是它对世界的看法，不是事实。

    **日志要分页读全量**，不读「最近 1000 条」：一次 `read(limit=1000)` 看着够了，
    其实第 1001 条之前建的那栋楼会从投影里消失，于是「拆掉它」被误判成不存在。
    读全量的代价是每次意图请求重放一遍日志；世界的事件量到几千条之前不算什么，
    真到了那一天该加的是缓存，不是把上限当默认值。
    """
    from_context = building_ids_from_context(context)
    if from_context is None:
        events: list[WorldEvent] = []
        since = 0
        while True:
            page = log.read(since=since, limit=MAX_LIMIT)
            events.extend(page)
            if len(page) < MAX_LIMIT:
                break
            since = page[-1].id
        summary = project_buildings(events).to_world()
    else:
        summary = {"buildingIds": from_context, "buildingCount": len(from_context)}
    if isinstance(world_size, dict):
        for key in ("width", "height"):
            if key in world_size:
                summary[key] = world_size[key]
    return summary
