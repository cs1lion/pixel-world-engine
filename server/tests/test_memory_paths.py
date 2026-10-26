"""路径与文件名安全。

这些测试守的是「写一条记忆」不能变成「写仓库里任何一个文件」。
标题最终来自用户的一句话，所以这里按**攻击输入**来测，不是按正常输入。
"""

from __future__ import annotations

import pytest

from memory.paths import (
    CHARACTERS_DIR,
    ENTRIES_DIR,
    EVENTS_DIR,
    INDEX_NAME,
    MemoryLayout,
    MemoryPathError,
    safe_name,
    slugify,
)


@pytest.fixture
def layout(tmp_path):
    return MemoryLayout.at(tmp_path)


# ------------------------------------------------------------------ 目录布局


def test_layout_把四个子目录建齐(layout):
    layout.ensure()
    for name in (ENTRIES_DIR, CHARACTERS_DIR, EVENTS_DIR, "rules"):
        assert (layout.root / name).is_dir()
    assert layout.index_path().name == INDEX_NAME


def test_每日快照按世界日序号命名(layout):
    path = layout.entry_path(7)
    assert path.name == "day-0007.md"
    assert path.parent.name == ENTRIES_DIR


def test_世界日序号拒绝负数与布尔(layout):
    with pytest.raises(MemoryPathError):
        layout.entry_path(-1)
    # bool 是 int 的子类：True 当序号显然是调用方写错了。
    with pytest.raises(MemoryPathError):
        layout.entry_path(True)


# ------------------------------------------------------------------ 标题穿越


@pytest.mark.parametrize(
    "hostile",
    [
        "../../../.git/config",
        "..\\..\\world-client\\index.html",
        "....//....//etc/passwd",
        "/etc/passwd",
        "C:\\Windows\\System32\\drivers\\etc\\hosts",
        "..",
        ".",
        "con",
        "NUL.md",
        "com1",
        "lpt9",
        "结尾带点.",
        "结尾带空格 ",
        "\x00空字节",
        "",
        "   ",
        "///",
        "\\",
    ],
)
def test_恶意标题变不成路径(layout, hostile):
    """每一种都要么被归一化成一个无害名字，要么被明确拒掉。

    判据只有一条：**拼出来的路径必须仍在 memory/ 内**。不看它长什么样——
    看着无害的名字也可能被后面的代码拼坏，所以最终以落点为准。
    """
    try:
        path = layout.character_path(hostile)
    except MemoryPathError:
        return  # 明确拒掉也是好答案
    root = layout.root.resolve()
    assert path.resolve() != root
    assert root in path.resolve().parents, f"{hostile!r} 逃出了 memory/：{path}"


def test_点被禁掉所以两个点拼不出来():
    """slug 里一个点都没有，`..` 就不可能被拼出来。

    这是从字符集上禁掉，不是归一化之后再检查——后者总有洗不干净的变体。
    """
    for title in ("..", "../..", "a..b", "...", "a.b.md"):
        assert "." not in slugify(title), title


def test_中文标题原样进文件名(layout):
    """居民叫「莞尔」「汐」，记忆标题也常常是中文——不能为了安全把它们洗成拼音。"""
    path = layout.character_path("莞尔")
    assert path.name == "莞尔.md"
    path = layout.event_path(1, "渡口的第一夜")
    assert path.name == "E0001-渡口的第一夜.md"


def test_尾点尾空格被洗掉而不是逃逸(layout):
    """Windows 会悄悄吃掉尾点尾空格。

    `slugify` 把它们连同其他不可用字符一起换成连字符，所以到这里已经没有了。
    判据仍然是落点：洗出来的名字必须仍在 memory/ 内，且不以点或空格结尾。
    """
    for title in ("名字.", "名字 ", "名字. ", " 名字"):
        name = safe_name(title)
        assert name == "名字", title
        path = layout.character_path(title)
        root = layout.root.resolve()
        assert root in path.resolve().parents
        assert not path.name.endswith((".", " "))


def test_超长标题被截到安全长度(layout):
    long_title = "很" * 200
    path = layout.character_path(long_title)
    # 整个文件名要留在 255 字节内：中文一个字符 3 字节。
    assert len(path.name.encode("utf-8")) < 200


# ------------------------------------------------------------------ 序号分配


def test_事件序号取现有最大值加一(layout, tmp_path):
    layout.ensure()
    assert layout.next_event_seq() == 1
    (tmp_path / EVENTS_DIR / "E0001-甲.md").write_text("", encoding="utf-8")
    (tmp_path / EVENTS_DIR / "E0007-乙.md").write_text("", encoding="utf-8")
    assert layout.next_event_seq() == 8


def test_事件序号不读索引(layout, tmp_path):
    """索引是派生物。拿它当分配凭据，索引一旧就会重号，而重号会互相覆盖。"""
    layout.ensure()
    (tmp_path / INDEX_NAME).write_text("last_seq: 99\n", encoding="utf-8")
    assert layout.next_event_seq() == 1


def test_序号越界被拒(layout):
    with pytest.raises(MemoryPathError):
        layout.event_path(0, "标题")
    with pytest.raises(MemoryPathError):
        layout.event_path(True, "标题")


def test_safe_name_对空标题抛错而不是返回空():
    with pytest.raises(MemoryPathError):
        safe_name("")
