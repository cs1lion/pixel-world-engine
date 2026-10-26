"""写入铁律：source 白名单、证据链、append-only。

这些测试对应当年票据 #7 的验收条件，另外把三条铁律各钉一条：
只有 direct_observation 能写、证据必须查得到、没有依据就拒。
"""

from __future__ import annotations

import pytest

from events.log import EventLog
from memory import (
    CHARACTER_ENTRY,
    EVENT_ENTRY,
    MemoryDraft,
    MemoryWriteError,
    check_draft,
    check_source,
)
from memory.evidence import EvidenceError, check_evidence
from memory.paths import MemoryLayout
from memory.writer import MemoryWriter


def make_log() -> EventLog:
    """一份有两件事的日志：一栋楼盖了起来，天气变了。"""
    log = EventLog(":memory:")
    log.append(kind="world.changed", actor="world", payload={"change": "building.built", "instanceId": "wave_house#1", "prefabId": "wave_house", "displayName": "叠浪楼"}, at=1_000)
    log.append(kind="world.changed", actor="world", payload={"change": "weather", "weather": "rain"}, at=2_000)
    return log


@pytest.fixture
def layout(tmp_path):
    layout = MemoryLayout.at(tmp_path)
    layout.ensure()
    return layout


@pytest.fixture
def writer(layout):
    return MemoryWriter(layout, make_log())


def draft(**over):
    base = {
        "kind": EVENT_ENTRY,
        "title": "渡口的第一夜",
        "body": "我在旧站牌下点了一盏灯。",
        "source": "direct_observation",
        "evidence": (1,),
        "at": 1_500,
    }
    base.update(over)
    return MemoryDraft(**base)


# ------------------------------------------------------------------ 铁律一


def test_只有_direct_observation_能写(writer):
    written = writer.write(draft())
    assert written.path.is_file()


@pytest.mark.parametrize(
    "source", ["llm_generation", "model", "guess", "DIRECT_OBSERVATION", " direct_observation "]
)
def test_别的_source_一律拒(writer, source):
    with pytest.raises(MemoryWriteError) as exc:
        writer.write(draft(source=source))
    assert "direct_observation" in str(exc.value)


def test_空_source_报的是缺而不是不被允许(writer):
    """忘了带与想绕过是两件事，用户该看到不同的话。"""
    with pytest.raises(MemoryWriteError, match="缺 source"):
        writer.write(draft(source=""))


def test_缺_source_与_不被允许_分开报():
    with pytest.raises(MemoryWriteError, match="缺 source"):
        check_source(None)
    with pytest.raises(MemoryWriteError, match="不能写入记忆"):
        check_source("llm_generation")


# ------------------------------------------------------------------ 铁律二、三


def test_证据指向不存在的事件被拒(writer):
    with pytest.raises(EvidenceError) as exc:
        writer.write(draft(evidence=(99,)))
    assert "不存在" in str(exc.value)


def test_证据为空被拒(writer):
    with pytest.raises(MemoryWriteError, match="没有依据"):
        writer.write(draft(evidence=()))


def test_证据里没有世界自己做成的事被拒(tmp_path):
    """记忆记的是世界做过什么。日志里只有 world.changed 在说这件事。"""
    log = EventLog(":memory:")
    log.append(kind="task.arrived", actor="feed", payload={"taskId": "t_1"}, at=500)
    writer = MemoryWriter(MemoryLayout.at(tmp_path), log)
    with pytest.raises(EvidenceError, match="world.changed"):
        writer.write(draft(evidence=(1,)))


def test_证据形状不合法被拒(writer):
    with pytest.raises(MemoryWriteError, match="事件 id"):
        writer.write(draft(evidence=("1",)))
    with pytest.raises(MemoryWriteError, match="事件 id 从 1 开始"):
        writer.write(draft(evidence=(0,)))
    with pytest.raises(MemoryWriteError, match="重复"):
        writer.write(draft(evidence=(1, 1)))


def test_布尔_id_被拒(writer):
    # bool 是 int 的子类：True 当事件 id 显然是调用方写错了。
    with pytest.raises(MemoryWriteError, match="不是事件 id"):
        writer.write(draft(evidence=(True,)))


def test_writer_不创作内容(writer):
    """写进去的每个字都来自调用方。这一条靠比对全文，不靠看代码。"""
    body = "我在旧站牌下点了一盏灯。"
    written = writer.write(draft(body=body))
    text = written.path.read_text(encoding="utf-8")
    assert body in text
    # frontmatter 里只有依据与来源，没有一句是 writer 自己加的叙述。
    assert "direct_observation" in text
    assert "依据：#1" in text


# ------------------------------------------------------------------ 落盘形态


def test_事件一条一个文件(layout, writer):
    first = writer.write(draft())
    second = writer.write(draft(title="潮水退了", evidence=(2,)))
    assert first.path != second.path
    assert first.path.name == "E0001-渡口的第一夜.md"
    assert second.path.name == "E0002-潮水退了.md"


def test_同一个角色的记忆追加不覆盖(writer):
    first = writer.write(draft(kind=CHARACTER_ENTRY, title="她记得我点了灯", subject="莞尔"))
    before = first.path.read_text(encoding="utf-8")
    second = writer.write(
        draft(
            kind=CHARACTER_ENTRY,
            title="她也记得那场雨",
            subject="莞尔",
            body="她把伞留在了渡口。",
            evidence=(2,),
        )
    )
    after = second.path.read_text(encoding="utf-8")
    assert second.appended is True
    assert first.appended is False
    assert second.path == first.path
    # 只增不改：先前写下的字节一个都没少。
    assert after.startswith(before)
    assert after.count("## ") == 2
    assert "她把伞留在了渡口。" in after


def test_文件名用角色名_标题是小节名(writer):
    """一个人的每条记忆都进同一个文件，节标题才是这一条说了什么。

    用 title 当文件名的话，「她记得我做过什么」会散成一堆文件，
    而这正是这份档案唯一该回答的问题。
    """
    written = writer.write(
        draft(kind=CHARACTER_ENTRY, title="她记得我在渡口点了一盏灯", subject="汐", body="。")
    )
    assert written.path.name == "汐.md"
    assert "## 她记得我在渡口点了一盏灯" in written.path.read_text(encoding="utf-8")


def test_character_记忆必须说清是谁(writer):
    """缺 subject 就拒，不拿 title 顶。

    顶的那一刻不会报错，只会安静地把第一节的标题当成她的名字——
    表现成「汐.md 里躺着一段叫汐的记忆」，而这种错在浏览器里看不出来。
    """
    with pytest.raises(MemoryWriteError, match="必须带 subject"):
        writer.write(draft(kind=CHARACTER_ENTRY, title="她记得我点了灯"))
    with pytest.raises(MemoryWriteError, match="必须带 subject"):
        writer.write(draft(kind=CHARACTER_ENTRY, title="她记得我点了灯", subject="  "))


def test_frontmatter_可被解析回来(writer):
    import yaml

    written = writer.write(draft())
    text = written.path.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[0] == "---"
    closing = lines.index("---", 1)
    fields = yaml.safe_load("\n".join(lines[1:closing]))
    assert fields["kind"] == "event"
    assert fields["id"] == "E0001"
    assert fields["evidence"] == [1]
    assert fields["source"] == "direct_observation"
    assert fields["at"] == 1500


def test_frontmatter_里没有墙钟(writer):
    """带墙钟的文件在不同机器上长得不一样，diff 会满屏都是时间戳。"""
    written = writer.write(draft())
    text = written.path.read_text(encoding="utf-8")
    assert "writtenAt" not in text
    assert "timestamp" not in text
    assert "at: 1500" in text


def test_坏_kind_被拒(writer):
    with pytest.raises(MemoryWriteError, match="kind"):
        writer.write(draft(kind="note"))


def test_at_的形状被校验(writer):
    with pytest.raises(MemoryWriteError):
        writer.write(draft(at=-1))
    with pytest.raises(MemoryWriteError):
        writer.write(draft(at=True))


def test_check_draft_原样返回(writer):
    item = draft()
    assert check_draft(item) is item
