"""白名单校验：六条命令，逐条钉住取值域与错误码。

这一组测试的重点不是「合法的能过」，而是**不合法的过不去**——
模型输出错一条命令，世界就做一件谁也没要求的事。所以每条命令都有
至少一条越界用例，且断言的是**错误码**，不是中文句子。
"""

from __future__ import annotations

import pytest

from rules.schema import (
    COMMAND_CHECKS,
    MAX_BUILDINGS,
    TIDE_OVERRIDE_MAX_MS,
    CommandRejected,
    validate_command,
    validate_commands,
)


def reject(raw: object, code: str, world: dict | None = None) -> CommandRejected:
    with pytest.raises(CommandRejected) as caught:
        validate_command(raw, world)
    assert caught.value.code == code, f"错误码应是 {code}，实际 {caught.value.code}"
    return caught.value


# ---------------------------------------------------------------- 白名单本身

def test_白名单就是票面上的六条() -> None:
    assert set(COMMAND_CHECKS) == {
        "weather.set",
        "tide.setLevel",
        "building.add",
        "building.remove",
        "miracle.spawn",
        "npc.setSchedule",
    }


def test_白名单外的命令被拒并列出白名单() -> None:
    error = reject({"command": "weather.summon", "args": {}}, "unknown-command")
    assert "weather.summon" in error.message
    assert "weather.set" in error.message, "拒收时要说清白名单里有什么"


def test_信封只收_command_与_args() -> None:
    reject(
        {"command": "weather.set", "args": {"value": "rain"}, "confidence": 0.9},
        "unexpected-field",
    )


def test_缺_args_被拒() -> None:
    reject({"command": "weather.set"}, "missing-field")


@pytest.mark.parametrize("raw", [None, [], "weather.set", 7])
def test_命令必须是对象(raw: object) -> None:
    reject(raw, "not-an-object")


# ---------------------------------------------------------------- weather.set

@pytest.mark.parametrize("weather", ["clear", "rain", "storm"])
def test_天气三档都收(weather: str) -> None:
    command = validate_command({"command": "weather.set", "args": {"value": weather}})
    assert command.args == {"value": weather}


def test_天气不认识的值被拒() -> None:
    error = reject({"command": "weather.set", "args": {"value": "snow"}}, "out-of-domain")
    assert "clear" in error.message and "storm" in error.message


def test_天气多带字段被拒() -> None:
    reject(
        {"command": "weather.set", "args": {"value": "rain", "duration": 5}},
        "unexpected-field",
    )


# ---------------------------------------------------------------- tide.setLevel

def test_潮位覆盖_不给时长就用上限() -> None:
    command = validate_command({"command": "tide.setLevel", "args": {"value": 0.5}})
    assert command.args == {"value": 0.5, "durationMs": TIDE_OVERRIDE_MAX_MS}


def test_潮位越界被拒() -> None:
    for value in (-0.1, 1.5, 5):
        reject({"command": "tide.setLevel", "args": {"value": value}}, "out-of-range")


def test_潮位时长超上限被拒且给出上限() -> None:
    error = reject(
        {"command": "tide.setLevel", "args": {"value": 1, "durationMs": 10 * 60_000}},
        "duration-too-long",
    )
    assert str(TIDE_OVERRIDE_MAX_MS) in error.message


def test_潮位时长非正数被拒() -> None:
    for duration in (0, -1):
        reject(
            {"command": "tide.setLevel", "args": {"value": 1, "durationMs": duration}},
            "out-of-range",
        )


def test_潮位时长正好等于上限是合法的() -> None:
    command = validate_command(
        {"command": "tide.setLevel", "args": {"value": 0, "durationMs": TIDE_OVERRIDE_MAX_MS}}
    )
    assert command.args["durationMs"] == TIDE_OVERRIDE_MAX_MS


def test_潮位不能是_NaN_或无穷() -> None:
    reject({"command": "tide.setLevel", "args": {"value": float("nan")}}, "type-mismatch")
    reject({"command": "tide.setLevel", "args": {"value": float("inf")}}, "type-mismatch")


# ---------------------------------------------------------------- building.add

def test_建楼_模板名与坐标() -> None:
    command = validate_command(
        {"command": "building.add", "args": {"prefabId": "bookshop", "at": {"x": 3, "y": 4}}},
        {"width": 96, "height": 72},
    )
    assert command.args == {"prefabId": "bookshop", "at": {"x": 3, "y": 4}}


def test_建楼可以不带坐标_世界自己挑地方() -> None:
    """用户没说地点时，模型不该被逼着编一个。

    55 条合法用例里 5 条是这种——「建个工坊」「帮我盖个资料馆」——模型全部答
    unknown，因为它没有坐标可填。而客户端的 build 意图早就写着
    `at: GridPoint | null`，`readPoint(undefined)` 回 null：服务端比它要对齐的
    那份协议更严，严在这儿没有意义。

    **不是模型挑地方**：模型不知道哪儿空着，它挑的那个数要么被拒，要么落在
    别人家门口。省略 `at` 的意思是「随地」，挑哪儿是世界的事。
    """
    command = validate_command(
        {"command": "building.add", "args": {"prefabId": "bookshop"}},
        {"width": 96, "height": 72},
    )
    assert command.args == {"prefabId": "bookshop"}, "没有坐标就不该有 at 这个键"
    # 空世界、没有尺寸，也都得过得去：世界自己挑地方，不需要先知道地图多大。
    assert validate_command({"command": "building.add", "args": {"prefabId": "b"}}, {}).args == {
        "prefabId": "b"
    }


def test_带了坐标就照旧判越界() -> None:
    """放开「可以不带」不等于「带了不查」。越界那条一分钟都不能松。"""
    reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 96, "y": 0}}},
        "out-of-range",
        {"width": 96, "height": 72},
    )
    reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 1.5, "y": 2}}},
        "type-mismatch",
        {"width": 96, "height": 72},
    )


def test_建楼坐标越界被拒_且说清范围() -> None:
    error = reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 96, "y": 0}}},
        "out-of-range",
        {"width": 96, "height": 72},
    )
    assert "0..95" in error.message


def test_坐标必须是整数() -> None:
    reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 1.5, "y": 2}}},
        "type-mismatch",
        {"width": 96, "height": 72},
    )


def test_坐标多一个轴也被拒() -> None:
    reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 1, "y": 2, "z": 3}}},
        "unexpected-field",
        {"width": 96, "height": 72},
    )


def test_没有世界尺寸时跳过越界检查但不跳过形状检查() -> None:
    # 服务端不知道世界多大时，不该猜一个尺寸——猜错会让合法坐标被拒。
    command = validate_command(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 999, "y": 4}}}
    )
    assert command.args["at"] == {"x": 999, "y": 4}
    reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 1.5, "y": 4}}},
        "type-mismatch",
    )


def test_楼层数到上限就拒() -> None:
    error = reject(
        {"command": "building.add", "args": {"prefabId": "b", "at": {"x": 1, "y": 2}}},
        "building-limit",
        {"width": 96, "height": 72, "buildingCount": MAX_BUILDINGS},
    )
    assert str(MAX_BUILDINGS) in error.message


def test_建楼不带坐标就交给世界挑地方() -> None:
    """早先这条断言的是反的：「缺坐标 → 拒」，理由写的是「选址是世界的活，
    但那是 #6 之后的事」。那个前提已经不成立了——

    `world-client/src/world/setup.ts` 的 `placeBlueprint` 在 `at === undefined`
    时走 `grid.findBestSlot`，自动选最靠近锚点的合规空地；`simulation.ts`
    收到 build 意图时写的是 `at: intent.at ?? undefined`。整条客户端链路
    本来就把「没有坐标」当作「随地」在处理。

    服务端却一直要求 `at` 必填——比它要对齐的那份协议更严。后果测出来了：
    55 条合法用例里 5 条不说地点的（「建个工坊」「帮我盖个资料馆」），
    模型全部答 unknown。它没有坐标可填，而提示词说这一条命令必须有坐标。

    **放开的是「模型不必编一个数」，不是「坐标可以不查」。** 带了坐标照旧
    判越界（见上面那条）；没带，世界自己挑。
    """
    command = validate_command({"command": "building.add", "args": {"prefabId": "b"}}, {})
    assert command.args == {"prefabId": "b"}


# ---------------------------------------------------------------- 其余三条

def test_拆楼只要实例_id() -> None:
    command = validate_command(
        {"command": "building.remove", "args": {"instanceId": "bookshop#1"}}
    )
    assert command.args == {"instanceId": "bookshop#1"}
    reject({"command": "building.remove", "args": {"instanceId": "  "}}, "empty-value")


def test_没有建筑记录时不判存在性() -> None:
    """证不明就不判。日志里没有建筑记录时，服务端无从判断，交给世界自己说。

    这一半是「不拦」；另一半在 `test_拆一栋不在世界里的楼被拒_并列出现有什么`：
    现状里有记录时就得拦。两条合起来才钉得住「只在知道的时候判」。
    """
    command = validate_command(
        {"command": "building.remove", "args": {"instanceId": "bookshop#1"}},
        {"width": 96, "height": 72},
    )
    assert command.args == {"instanceId": "bookshop#1"}


def test_拆一栋不在世界里的楼被拒_并列出现有什么() -> None:
    """`docs/INTENT_EXPERIMENT.md` 里漏掉的那一条：模型编了个第 999 号楼。

    坐标越界在 `_point` 里就拦，实例不存在没有理由放到世界那一层再答一遍。
    """
    world = {"buildingIds": ["code_forge#1", "bookshop#1"], "buildingCount": 2}
    error = reject(
        {"command": "building.remove", "args": {"instanceId": "observatory#999"}}, "unknown-instance", world
    )
    assert "observatory#999" in error.message
    assert "code_forge#1" in error.message, "拒收时要把世界上有的列出来"
    assert "bookshop#1" in error.message


def test_照现状抄的实例_id_拆得过() -> None:
    """现状里有的放过去、没有的拦下来——两个方向都得在。

    只写前一半的话，把存在性检查整个删掉这条也照过。
    """
    world = {"buildingIds": ["code_forge#1"], "buildingCount": 1}
    command = validate_command(
        {"command": "building.remove", "args": {"instanceId": "code_forge#1"}}, world
    )
    assert command.args == {"instanceId": "code_forge#1"}
    reject(
        {"command": "building.remove", "args": {"instanceId": "observatory#999"}},
        "unknown-instance",
        world,
    )


def test_楼很多时错误消息不全列() -> None:
    """四十个 id 会把错误撑成一段话，而模型要的只是「照现状里那些抄」。"""
    world = {"buildingIds": [f"shop#{index}" for index in range(40)], "buildingCount": 40}
    error = reject(
        {"command": "building.remove", "args": {"instanceId": "ghost#1"}}, "unknown-instance", world
    )
    assert "现有 40 栋" in error.message
    assert len(error.message) < 200


def test_世界上一栋楼也没有时_拆楼被拒并说清() -> None:
    """与「没有记录」是两件事：这里服务端确实知道世界是空的。"""
    error = reject(
        {"command": "building.remove", "args": {"instanceId": "bookshop#1"}},
        "unknown-instance",
        {"buildingIds": [], "buildingCount": 0},
    )
    assert "一栋楼也没有" in error.message


def test_buildingIds_形状不对时不拿它判() -> None:
    """上游给了个怪形状时跳过存在性检查，而不是把所有人都拒了。"""
    for weird in ("bookshop#1", 7, {"a": 1}):
        command = validate_command(
            {"command": "building.remove", "args": {"instanceId": "bookshop#1"}},
            {"buildingIds": weird},
        )
        assert command.args == {"instanceId": "bookshop#1"}


def test_神迹三件_坐标可省略() -> None:
    assert validate_command({"command": "miracle.spawn", "args": {"kind": "cat"}}).args == {
        "kind": "cat"
    }
    reject({"command": "miracle.spawn", "args": {"kind": "dragon"}}, "out-of-domain")
    reject({"command": "miracle.spawn", "args": {"kind": "cat", "count": 3}}, "unexpected-field")


def test_作息名在取值域内() -> None:
    command = validate_command(
        {"command": "npc.setSchedule", "args": {"id": "v0", "schedule": "garden"}}
    )
    assert command.args == {"id": "v0", "schedule": "garden"}
    reject(
        {"command": "npc.setSchedule", "args": {"id": "v0", "schedule": "sleep"}},
        "out-of-domain",
    )


# ---------------------------------------------------------------- 一串命令

def test_一串命令里有一条不合法就整串拒() -> None:
    """部分接受是最坏的形状：模型给三条、世界办了两条，
    用户看到的世界既不是他说的、也不是模型说的那个。"""
    raw = [
        {"command": "weather.set", "args": {"value": "rain"}},
        {"command": "weather.set", "args": {"value": "snow"}},
    ]
    with pytest.raises(CommandRejected):
        validate_commands(raw)


def test_命令必须是数组() -> None:
    with pytest.raises(CommandRejected):
        validate_commands({"command": "weather.set", "args": {"value": "rain"}})


def test_校验是纯函数_不改输入也不读外部状态() -> None:
    raw = {"command": "weather.set", "args": {"value": "rain"}}
    before = {"command": "weather.set", "args": {"value": "rain"}}
    validate_command(raw)
    assert raw == before, "校验不许改调用方的对象"
