"""记忆层：写入铁律、证据核对、路径安全、每日快照。

四个子模块各自可单测，`__init__.py` 放共用的类型与铁律的形状校验：

    paths.py      目录结构与文件名安全（标题进文件名的那道关）
    evidence.py   证据链：引用的事件必须真的存在于日志
    format.py     Markdown 形态：YAML frontmatter + 正文
    writer.py     写入入口，三关的装配点
    snapshot.py   每日快照，事件日志的纯函数派生
    api.py        HTTP 面

三条铁律（SPEC §4.7，用户 2026-10-25 确认）在这里**执行**：

1. 只有 `direct_observation` 能触发写入——`check_source`。
2. 每条必须带 `source` 与证据链，且证据必须在日志里查得到——`check_evidence`。
3. 没有依据时宁可不写——证据为空一律拒，writer 自己一个字都不编。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from memory.paths import (
    CHARACTERS_DIR,
    ENTRIES_DIR,
    EVENTS_DIR,
    INDEX_NAME,
    MEMORY_DIRNAME,
    MemoryLayout,
    MemoryPathError,
    RULES_DIR,
)

#: 唯一允许触发写入的来源。白名单，不在表里的一律拒。
#:
#: 这不是「目前只想到一种」。模型当然能**转述**观测到的事——那条路是调用方先
#: 观测、再把观测结果作为 `body` 传进来，`source` 仍然是 `direct_observation`。
#: `llm_generation` 被拒，是因为它声称「这话是模型想的」，而那正是
#: 「模型不能替你编回忆」要挡住的东西。
DIRECT_OBSERVATION = "direct_observation"
ALLOWED_SOURCES = frozenset({DIRECT_OBSERVATION})

#: 记忆的种类，决定落到哪个子目录、用哪种写法。
EVENT_ENTRY = "event"
CHARACTER_ENTRY = "character"
ENTRY_KINDS = frozenset({EVENT_ENTRY, CHARACTER_ENTRY})

#: 标题长度上限。事件标题要进文件名，超长的标题会让路径顶到文件系统的 255 字节墙。
MAX_TITLE_CHARS = 60

#: 正文长度上限。记忆是一段话，不是一篇文章；超长多半是把整个世界塞进来了。
MAX_BODY_CHARS = 4000

#: 一行读起来像小节标题。角色档案里 `## ` 是**记忆的边界**，读面靠它把一份档案
#: 拆成一条一条（`writer._sections_of`）。所以正文里出现这样一行，那条记忆会被
#: 安静地截成两半，后半还以一条独立记忆的身份混进编年史。
#: 写面挡它，是因为这里收的是调用方自由给的最长 4000 字文本——能写出 `## `
#: 的调用方不该被允许悄悄改变文件的形状。
_HEADING_LINE = re.compile(r"^#{1,6}\s")


class MemoryWriteError(ValueError):
    """写入被拒。API 层转成 422，不做静默修正。"""


@dataclass(frozen=True)
class MemoryDraft:
    """一条待写入的记忆。

    `evidence` 是事件日志里的 id 序列。空序列一律拒——没有依据就不是记忆，
    是创作。`at` 是世界时间（固定步长推进的毫秒数），不是墙钟：记忆要能跟着
    同一份日志重新生成，就不能带一个每次都变的字段。

    `subject` 只对 `character` 有意义：它是**这个人是谁**（决定文件名），
    而 `title` 是这一节的标题。分开是因为一个人的档案里会有很多节，
    节标题各不相同，人只有一个。混用一个字段的话，第一节的标题就会被
    当成她的名字写进文件名——表现成「汐.md 里躺着一段叫汐的记忆」。
    """

    kind: str
    title: str
    body: str
    source: str
    evidence: tuple[int, ...]
    at: float
    subject: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in ENTRY_KINDS:
            allowed = " 或 ".join(sorted(ENTRY_KINDS))
            raise MemoryWriteError(f"kind 必须是 {allowed}，收到 {self.kind!r}")
        _check_one_line(self.title, "title", MAX_TITLE_CHARS)
        _check_text(self.body, "body", MAX_BODY_CHARS)
        if self.kind == CHARACTER_ENTRY:
            if not isinstance(self.subject, str) or self.subject.strip() == "":
                raise MemoryWriteError(
                    "character 记忆必须带 subject：它是这个人是谁（决定文件名），"
                    "title 只是这一节的标题"
                )
            # subject 与 title 走同一道检查。它俩都单独成为一行——
            # `format.render_character` 写的是 `# {subject}` 与 `## {title}`。
            # 只挡 title 不挡 subject，注入就从 subject 那条路走：
            # `subject="莞尔\\n\\n## 后记"` 落盘后 `GET /api/memory/list`
            # 会把一条记忆数成三条，其中一条连 `# 莞尔` 那行都读不回来。
            _check_one_line(self.subject, "subject", MAX_TITLE_CHARS)
            _check_no_heading_lines(self.body)
        _check_at(self.at)


def _check_one_line(value: object, field: str, limit: int) -> None:
    """这段字要单独成为一行，所以不许带换行。

    带换行不是「句子长了」：它是调用方在往文件里注入整行，
    也就是在改文件的形状，不是在写一句话。读面靠行边界把一份档案
    拆成一条一条，注入一行就等于凭空多出一条记忆。
    """
    _check_text(value, field, limit)
    if "\n" in value or "\r" in value:
        raise MemoryWriteError(f"{field} 不能跨行：它要单独成为一行")


def _check_text(value: object, field: str, limit: int) -> None:
    if not isinstance(value, str) or value.strip() == "":
        raise MemoryWriteError(f"{field} 不能为空")
    if len(value) > limit:
        raise MemoryWriteError(f"{field} 最长 {limit} 字符，收到 {len(value)}")


def _check_no_heading_lines(body: str) -> None:
    """角色记忆的正文里不许出现读起来像小节标题的一行。

    角色档案的 `## ` 是**记忆的边界**：读面靠它把一份档案拆成一条一条
    （`writer._sections_of`）。调用方自由给的 4000 字里若混进这样一行，
    那条记忆会被安静地截成两半——后半以一条独立记忆的身份混进编年史，
    界面上看不出任何异常，而那条记忆已经缺了一半。

    挡在写面而不是读面降级：读面分不清「这是排版」与「这是下一条记忆」，
    它没有依据可依。能分清的是写面——它知道自己写的是什么。
    事件不查：`events/` 是一事一文件，`## ` 在那里只是排版，没人按它切。
    """
    for line in body.splitlines():
        if _HEADING_LINE.match(line.strip()):
            raise MemoryWriteError(
                f"body 里不能有「{line.strip()}」这样一行：角色档案的小节标题是记忆的边界，"
                "混进正文那条记忆会被读成两条"
            )


def _check_at(at: object) -> None:
    # bool 是 int 的子类，单独挡掉：`True` 当世界时间显然是调用方写错了。
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        raise MemoryWriteError(f"at 必须是数字（世界时间 ms），收到 {at!r}")
    value = float(at)
    if value != value or value in (float("inf"), float("-inf")):
        raise MemoryWriteError("at 必须是有限数")
    if value < 0:
        raise MemoryWriteError("at 不能为负（世界时间从 0 开始）")


def check_source(source: object) -> str:
    """铁律一：只有 direct_observation 能写。

    缺 source 与 source 不被允许分开报：前者是调用方忘了带，后者是调用方想
    绕过。用户在屏幕上看到的该是不同的话。
    """
    if not isinstance(source, str) or source.strip() == "":
        raise MemoryWriteError("缺 source：每条记忆必须说明它是怎么被观测到的")
    if source not in ALLOWED_SOURCES:
        allowed = "、".join(sorted(ALLOWED_SOURCES))
        raise MemoryWriteError(
            f"source {source!r} 不能写入记忆；只有 {allowed} 能——"
            "模型不能替你编回忆，只能转述已经观测到的事"
        )
    return source


def check_evidence(evidence: object) -> tuple[int, ...]:
    """铁律三的前半：证据链的形状。存在性由 `evidence.py` 查日志。"""
    if not isinstance(evidence, (list, tuple)):
        raise MemoryWriteError("evidence 必须是事件 id 数组")
    ids: list[int] = []
    for item in evidence:
        # bool 是 int 的子类，挡掉：True 当事件 id 显然是调用方写错了。
        if isinstance(item, bool) or not isinstance(item, int):
            raise MemoryWriteError(f"evidence 里的 {item!r} 不是事件 id（整数）")
        if item < 1:
            raise MemoryWriteError(f"事件 id 从 1 开始，收到 {item}")
        ids.append(item)
    if not ids:
        raise MemoryWriteError("没有依据就不能写记忆：evidence 至少引用一条事件")
    if len(set(ids)) != len(ids):
        raise MemoryWriteError("evidence 里有重复的事件 id")
    return tuple(ids)


def check_draft(draft: MemoryDraft) -> MemoryDraft:
    """跑完整条铁律里不碰日志的那部分。返回 draft 本身，方便链式调用。"""
    check_source(draft.source)
    check_evidence(draft.evidence)
    return draft


__all__ = [
    "ALLOWED_SOURCES",
    "CHARACTERS_DIR",
    "CHARACTER_ENTRY",
    "DIRECT_OBSERVATION",
    "ENTRIES_DIR",
    "ENTRY_KINDS",
    "EVENTS_DIR",
    "EVENT_ENTRY",
    "INDEX_NAME",
    "MAX_BODY_CHARS",
    "MAX_TITLE_CHARS",
    "MEMORY_DIRNAME",
    "MemoryDraft",
    "MemoryLayout",
    "MemoryPathError",
    "MemoryWriteError",
    "RULES_DIR",
    "check_draft",
    "check_evidence",
    "check_source",
]
