"""从事件日志投影建筑集合。

重点不是「建了能读出来」，而是三件容易静默出错的事：

1. **建了又拆的要真的消失**——只累加不递减的投影会让「拆掉那栋楼」永远被拒。
2. **日志里没有建筑记录 ≠ 世界上一栋楼也没有**。把前者当后者，
   每一句合理的「拆掉它」都会被拒，而世界明明在好好地建楼拆楼。
3. **日志不全时不能拿它当全集**。日志记的是变更、不是快照：开局就有的楼
   从来没有 `building.built` 事件。所以客户端报了现状就以现状为准。
"""

from __future__ import annotations

import pytest

from events.log import EventLog
from events.projection import project_buildings, world_summary


def log_with(*bodies: dict) -> EventLog:
    """按顺序写进日志，返回这只日志。`at` 用序号当世界时间。"""
    log = EventLog(":memory:")
    for index, body in enumerate(bodies):
        log.append(kind="world.changed", actor="world", payload=body, at=float(index))
    return log


def built(instance_id: str) -> dict:
    return {"change": "building.built", "instanceId": instance_id, "prefabId": "code_forge", "displayName": "工坊"}


def removed(instance_id: str) -> dict:
    return {"change": "building.removed", "instanceId": instance_id, "displayName": "工坊"}


# ---------------------------------------------------------------- 基本投影

def test_建了两栋就投影出两栋() -> None:
    buildings = project_buildings(log_with(built("a#1"), built("b#1")).read())
    assert buildings.ids == ("a#1", "b#1")
    assert buildings.recorded is True


def test_拆掉的要从集合里消失() -> None:
    buildings = project_buildings(log_with(built("a#1"), built("b#1"), removed("a#1")).read())
    assert buildings.ids == ("b#1",)
    assert buildings.recorded is True


def test_拆一栋没建过的楼不把别人带走() -> None:
    buildings = project_buildings(log_with(built("a#1"), removed("ghost#1")).read())
    assert buildings.ids == ("a#1",)


def test_同一位_id_建两次只算一栋() -> None:
    buildings = project_buildings(log_with(built("a#1"), built("a#1")).read())
    assert buildings.ids == ("a#1",)


def test_空日志不等于_世界上没有楼() -> None:
    """这一条是整组测试里最重要的：证不明就不判。"""
    buildings = project_buildings(EventLog(":memory:").read())
    assert buildings.recorded is False
    assert buildings.to_world() == {}, "没有记录时不该给出建筑摘要，让世界自己判"


def test_建了又拆光_recorded_仍然为真() -> None:
    """有记录且真的光了，与「没有记录」是两件事。"""
    buildings = project_buildings(log_with(built("a#1"), removed("a#1")).read())
    assert buildings.recorded is True
    assert buildings.ids == ()
    assert buildings.to_world() == {"buildingIds": [], "buildingCount": 0}


def test_与建筑无关的变化不触发_recorded() -> None:
    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=0)
    log.append(kind="task.settled", actor="world", payload={"taskId": "c_1"}, at=1)
    assert project_buildings(log.read()).recorded is False


def test_不是_world_changed_的事件被忽略() -> None:
    log = EventLog(":memory:")
    # 同一种载荷，但不是世界回写的——上游说不上世界建了什么。
    log.append(kind="task.settled", actor="world", payload=built("a#1"), at=0)
    assert project_buildings(log.read()).recorded is False


@pytest.mark.parametrize("bad", [None, 7, "", {"x": 1}])
def test_怪形状的_instanceId_当没看见_不让投影整体失效(bad: object) -> None:
    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload={"change": "building.built", "instanceId": bad}, at=0)
    log.append(kind="world.changed", actor="world", payload=built("b#1"), at=1)
    buildings = project_buildings(log.read())
    assert buildings.ids == ("b#1",)
    assert buildings.recorded is True


# ---------------------------------------------------------------- 客户端的现状优先

def context_with(*instance_ids: str) -> dict:
    """客户端会发的那种 `context`。镇上一组、野外一组。"""
    return {
        "built": {
            "town": [{"instanceId": each, "templateId": "code_forge", "name": "工坊"} for each in instance_ids],
            "wild": [],
        }
    }


def test_客户端报了建筑就以它为准_哪怕日志里一栋也没有() -> None:
    """**这条是整个优先序的理由。**

    开局就有的楼（设定集落的）在日志里没有 `building.built` 事件。谁拆了其中一栋，
    日志里才第一次出现建筑记录，而那时 `ids` 是空的——投影于是说「一栋楼也没有」，
    之后每一句「拆掉它」都被拒成 unknown-instance。世界明明还在好好地建楼拆楼。
    """
    # 日志里只有一条拆除，是客户端世界里一栋开局楼被拆掉的回写。
    log = log_with(removed("ferry#1"))
    assert project_buildings(log.read()).to_world() == {"buildingIds": [], "buildingCount": 0}

    summary = world_summary(log, None, context_with("code_forge#1", "star_archive#1"))
    assert summary["buildingIds"] == ["code_forge#1", "star_archive#1"]
    assert summary["buildingCount"] == 2


def test_客户端说现在一栋也没有_就信它_不回去翻日志() -> None:
    """「报了但为空」与「没报」是两件事。日志里还留着拆掉之前那条 built，
    拿它当现状，就会让一句「再建一个」之后的拆除被拒——而那栋楼刚被世界拆了。"""
    log = log_with(built("a#1"), removed("a#1"))
    summary = world_summary(log, None, context_with())
    assert summary == {"buildingIds": [], "buildingCount": 0}


def test_客户端没报建筑才翻日志() -> None:
    """实验走的就是这条路（`context=None`）：更严，正好用来验白名单本身。"""
    log = log_with(built("a#1"))
    assert world_summary(log, None, {"worldSize": {"width": 1}})["buildingIds"] == ["a#1"]
    assert world_summary(log, None, {"built": {"town": "不是数组"}})["buildingIds"] == ["a#1"]
    assert world_summary(log, None, {"built": []})["buildingIds"] == ["a#1"]
    assert world_summary(log, None, {"built": {}})["buildingIds"] == ["a#1"]


def test_客户端形状写错时不凭一个空数组宣布世界是空的() -> None:
    """两组都不是数组 = 没给，不是一栋也没有。

    另一种读法会让一个客户端的形状 bug 变成「世界是空的」，于是每一句
    「拆掉它」都被拒——那正是现状优先要避免的那种错。宁可回去翻日志。
    """
    log = log_with(built("a#1"))
    assert world_summary(log, None, {"built": {"town": None, "wild": None}})["buildingIds"] == ["a#1"]


def test_野外的楼也照算_两组一起去重() -> None:
    context = {
        "built": {
            "town": [{"instanceId": "a#1"}, {"instanceId": "b#1"}],
            "wild": [{"instanceId": "b#1"}, {"instanceId": "c#1"}, {"instanceId": 7}],
        }
    }
    assert world_summary(log_with(), None, context)["buildingIds"] == ["a#1", "b#1", "c#1"]


def test_尺寸照旧听客户端的_与建筑那一半互不干扰() -> None:
    summary = world_summary(log_with(built("a#1")), {"width": 96, "height": 72}, context_with("a#1", "b#1"))
    assert summary == {"buildingIds": ["a#1", "b#1"], "buildingCount": 2, "width": 96, "height": 72}


# ---------------------------------------------------------------- 世界摘要

def test_摘要合并客户端尺寸_但忽略客户端的建筑数() -> None:
    """尺寸听客户端的（地图是设定集的内容），建筑听日志的（那是世界的事实）。"""
    log = log_with(built("a#1"))
    summary = world_summary(log, {"width": 96, "height": 72, "buildingCount": 999})
    assert summary == {
        "buildingIds": ["a#1"],
        "buildingCount": 1,
        "width": 96,
        "height": 72,
    }


def test_客户端不发尺寸时摘要里就没有尺寸() -> None:
    assert world_summary(log_with(built("a#1")), None) == {
        "buildingIds": ["a#1"],
        "buildingCount": 1,
    }


def test_超过一页的事件也读全_不漏早期的楼() -> None:
    """这条钉住分页：只读「最近 1000 条」会让早期的楼从投影里消失，
    于是「拆掉它」被误判成 unknown-instance——世界明明有那栋楼。"""
    from events.log import MAX_LIMIT

    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload=built("early#1"), at=0)
    for index in range(MAX_LIMIT + 5):
        log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=index + 1)
    assert world_summary(log, None)["buildingIds"] == ["early#1"]
