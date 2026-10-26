"""写入入口：`MemoryWriter.write()`。

这里是三条铁律的**装配点**——形状校验（`__init__.py`）、证据核对
（`evidence.py`）、路径安全（`paths.py`）各自可单测，但「一条记忆要同时
过这三关」只有走这里才成立。少任何一关都会退化成文档里的承诺。

顺序是刻意的：**先校验、再查日志、最后才碰磁盘**。反过来的话，一条被拒的
记忆可能已经建好了目录、甚至写了一半的文件，而下一次重试又写一遍。

线程安全：FastAPI 的同步端点跑在线程池里，两条记忆可能同时进来。
事件序号（`E0001`）的分配必须串行，否则两条记忆拿到同一个号，
后写的把先写的覆盖掉——而记忆层只增不改，覆盖就是丢历史。
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path

from events.log import EventLog
from memory import format as fmt
from memory.evidence import EvidenceCheck, check_evidence
from memory.paths import (
    CHARACTERS_DIR,
    ENTRIES_DIR,
    EVENTS_DIR,
    MemoryLayout,
    MemoryPathError,
)
from memory.snapshot import day_of

from memory import (  # noqa: E402  （放在 import 之后，避免循环导入时的顺序依赖）
    CHARACTER_ENTRY,
    EVENT_ENTRY,
    MemoryDraft,
    MemoryWriteError,
    check_draft,
)


@dataclass(frozen=True)
class WrittenMemory:
    """一条已经落盘的记忆。`relative` 是相对 `memory/` 的路径，给 API 回给人看。"""

    kind: str
    title: str
    path: Path
    relative: str
    evidence: tuple[int, ...]
    appended: bool

    def to_json(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "title": self.title,
            "path": self.relative,
            "evidence": list(self.evidence),
            "appended": self.appended,
        }


class MemoryWriter:
    """把一条 `MemoryDraft` 写进 `memory/`。

    第一个参数收 `Path`、`str` 或 `MemoryLayout`：装配处（`events.api.create_app`）
    手里是一个目录路径，它不该为了构造 writer 先懂 `MemoryLayout`。
    """

    def __init__(self, root: MemoryLayout | Path | str, log: EventLog) -> None:
        self._layout = root if isinstance(root, MemoryLayout) else MemoryLayout.at(root)
        self._log = log
        self._lock = threading.Lock()

    @property
    def layout(self) -> MemoryLayout:
        """记忆目录的布局。HTTP 面要它拼路径、列目录。"""
        return self._layout

    # ---------------------------------------------------------------- 主入口

    def write(self, draft: MemoryDraft) -> WrittenMemory:
        """写一条记忆。任何一关不过就抛 `MemoryWriteError`，磁盘上不留痕迹。"""
        check_draft(draft)
        check = check_evidence(self._log, draft.evidence)

        with self._lock:
            if draft.kind == EVENT_ENTRY:
                return self._write_event(draft, check)
            return self._write_character(draft, check)

    # ---------------------------------------------------------------- 两种落法

    def _write_event(self, draft: MemoryDraft, check: EvidenceCheck) -> WrittenMemory:
        """单次事件：一件事一个文件，永不覆盖。

        序号在锁内分配，所以两条记忆不会撞号。文件名里的标题只是给人看的，
        真正的身份是 `E0001` 这个号——标题撞了也不影响，号不会撞。
        """
        seq = self._layout.next_event_seq()
        path = self._layout.event_path(seq, draft.title)
        path.parent.mkdir(parents=True, exist_ok=True)
        text = fmt.render_event(seq=seq, title=draft.title, body=draft.body, check=check, at=draft.at)
        path.write_text(text, encoding="utf-8", newline="\n")
        return WrittenMemory(
            kind=EVENT_ENTRY,
            title=draft.title,
            path=path,
            relative=self._relative(path),
            evidence=check.ids,
            appended=False,
        )

    def _write_character(self, draft: MemoryDraft, check: EvidenceCheck) -> WrittenMemory:
        """角色档案：同一个人的记忆接在同一个文件后面。

        文件名用 `subject`（这个人是谁），节标题用 `title`（这一条说了什么）。
        用 title 当文件名的话，一个人的每条记忆都会散成一个新文件，
        「她记得我做过什么」就拼不起来了。
        """
        subject = draft.subject or draft.title
        path = self._layout.character_path(subject)
        appended = path.exists()
        path.parent.mkdir(parents=True, exist_ok=True)
        if appended:
            with path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(
                    fmt.render_character_section(check, draft.title, draft.body, draft.at)
                )
        else:
            path.write_text(
                fmt.render_character_file(subject, check, draft.title, draft.body, draft.at),
                encoding="utf-8",
                newline="\n",
            )
        return WrittenMemory(
            kind=CHARACTER_ENTRY,
            title=subject,
            path=path,
            relative=self._relative(path),
            evidence=check.ids,
            appended=appended,
        )

    # ---------------------------------------------------------------- 辅助

    def _relative(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self._layout.root.resolve()).as_posix()
        except ValueError:  # pragma: no cover - _resolve 已经保证不会发生
            raise MemoryWriteError(f"{path} 不在 memory/ 内") from None

    # ---------------------------------------------------------------- 读面

    def list_entries(self) -> list[dict[str, object]]:
        """列出已经落盘的记忆，按世界时间排成编年史。

        **一行一条记忆，不是一行一个文件。** 一份角色档案里躺着好几条记忆，
        每条有它自己的 `at`；按文件列的话，「她记得那场雨」只能跟着档案的
        第一浮动，而它该出现在那场雨那天。所以这里把档案拆成小节，
        小节名进 `section`，读的时候靠它找到那一节。

        摘要取正文的第一句——那是人在列表里真正想看到的东西。标题他自己有。
        """
        entries: list[dict[str, object]] = []
        for dirname, kind in _SOURCES:
            for path in self._layout.markdown_files(dirname):
                text = _read(path)
                relative = self._relative(path)
                # 只有角色档案是一份文件若干条记忆。事件与每日快照里的 `## `
                # 是排版（`## 天气`），不是记忆的边界——按它切就把一份文档
                # 剁成了几段，每段都读起来像缺了什么。
                sections = (
                    _sections_of(text)
                    if dirname == CHARACTERS_DIR
                    else [_Section(title=_title_of(text, path.stem), body=text, at=_at_of(text), is_section=False)]
                )
                for section in sections:
                    entries.append(
                        {
                            "kind": kind,
                            "title": section.title,
                            "path": relative,
                            "section": section.title if section.is_section else None,
                            "summary": _summary_of(section.body),
                            "at": section.at,
                            # 第几个世界日由服务端算，不在客户端再写一遍 DAY_MS——
                            # 同一个常数出现在两边，迟早会有一边忘了改。
                            "day": None if section.at is None else day_of(section.at),
                        }
                    )
        entries.sort(key=lambda item: (item["at"] is None, item["at"] or 0, str(item["path"])))
        return entries

    def read_entry(self, relative: str | None, section: str | None = None) -> dict[str, object]:
        """读一份记忆的全文。

        票据 #7 的验收是「像读一本编年史」——只有标题与一行摘要是目录。
        编年史要能翻开，所以读面给的是全文。

        给了 `section` 就只要那一节（连同它所属的 `# ` 人名标题）：
        列表里的一行是一条记忆，点开它就该读到那一条，不是整个人档案。

        路径不接受调用方自由构造：走 `resolve_entry` 的白名单，
        只有 `list_entries` 会列出去的文件才读得回来。小节名也不接受——
        它必须是那份文件里真有的一个 `## ` 标题。
        """
        path = self._layout.resolve_entry(relative)
        posix = self._relative(path)
        text = _read(path)
        if section is not None:
            text = _slice_to_section(text, section)
        return {
            "path": posix,
            "section": section,
            "kind": _kind_of(posix),
            "title": _title_of(text, path.stem),
            "text": text,
        }


#: 哪个目录对应哪种记忆。每日快照不是「谁写的记忆」——它是日志派生的东西，
#: 所以在编年史里是单独一类，不混进 event/character。
DAY_ENTRY = "day"
_SOURCES = (
    (EVENTS_DIR, EVENT_ENTRY),
    (CHARACTERS_DIR, CHARACTER_ENTRY),
    (ENTRIES_DIR, DAY_ENTRY),
)


def _kind_of(posix: str) -> str:
    folder = posix.split("/", 1)[0] if "/" in posix else ""
    for dirname, kind in _SOURCES:
        if folder == dirname:
            return kind
    return folder


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:  # pragma: no cover - 文件在读之前被移走
        return ""


def _at_of(text: str) -> float | None:
    """frontmatter 里的世界时间。读不回来就 `None`，不猜。"""
    value = fmt.read_frontmatter(text).get("at")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


@dataclass(frozen=True)
class _Section:
    """一份文件里的一个可读单元。

    `is_section` 为假时这是整份文件（事件、每日快照那种一事一文件的），
    `title` 就是文件标题；为真时它是角色档案里的一节，
    `title` 是那一节的 `## ` 标题。
    """

    title: str
    body: str
    at: float | None
    is_section: bool


#: 一节的开头。角色档案里 `# ` 只有一个（人名），`## ` 才是逐条记忆。
_SECTION_HEADING = re.compile(r"^##\s+(.+?)\s*$")
#: 一节里的世界时间行。与 `依据：`、`来源：` 同一行风格。
_AT_LINE = re.compile(r"^at:\s*([0-9]+(?:\.[0-9]+)?)\s*$")


def _sections_of(text: str) -> list[_Section]:
    """把一份**角色档案**按 `## ` 拆成一条一条的记忆。

    只该用在 `characters/` 下的文件上：那里的 `## ` 确实是记忆的边界。
    事件与每日快照里的 `## ` 是排版（`## 天气`），按它切会把一份文档剁成几段。
    调用方按目录决定拆不拆，见 `list_entries`。

    不猜：认不出 `at:` 的那一节，`at` 是 `None`，编年史把它排在最后，
    而不是替它按文件的创建时间填一个。
    """
    lines = text.splitlines()
    heads = [index for index, line in enumerate(lines) if _SECTION_HEADING.match(line.strip())]
    if not heads:
        return [_Section(title=_title_of(text, ""), body=text, at=_at_of(text), is_section=False)]

    sections: list[_Section] = []
    for position, start in enumerate(heads):
        end = heads[position + 1] if position + 1 < len(heads) else len(lines)
        chunk = lines[start:end]
        title = _SECTION_HEADING.match(chunk[0].strip()).group(1)
        at: float | None = None
        for line in chunk[1:]:
            match = _AT_LINE.match(line.strip())
            if match is not None:
                at = float(match.group(1))
                break
        sections.append(_Section(title=title, body="\n".join(chunk), at=at, is_section=True))
    return sections


def _slice_to_section(text: str, section: str) -> str:
    """取一份角色档案里名为 `section` 的那一节，连同文件头的 `# ` 人名。

    小节名必须是那份文件里真有的一个 `## ` 标题——不是的话报错，
    不退回「给整份文件」：那会让调用方以为读到了那一节，其实读到了全部。
    """
    lines = text.splitlines()
    heads = [index for index, line in enumerate(lines) if _SECTION_HEADING.match(line.strip())]
    wanted = section.strip()
    for position, start in enumerate(heads):
        title = _SECTION_HEADING.match(lines[start].strip()).group(1)
        if title != wanted:
            continue
        end = heads[position + 1] if position + 1 < len(heads) else len(lines)
        # 人名那一行（第一个 `# `）留着：读一节时也该知道这是谁的档案。
        head = [line for line in lines[: heads[0]] if line.strip().startswith("# ")]
        return "\n".join(head + lines[start:end]).strip() + "\n"
    raise MemoryPathError(f"这份档案里没有「{section}」这一节")


def _title_of(text: str, fallback: str) -> str:
    """从文件里取标题：第一个 `# ` 开头的行。

    不从文件名取——文件名被 slugify 洗过（`渡口的第一夜` → `渡口的第一夜`，
    但 `a/b` → `a-b`），而文件里那一行是原样写下的。
    """
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and stripped[2:].strip():
            return stripped[2:].strip()
    return fallback


#: 机器的字段行。它们不是人写的话，所以摘要把它们跳过。
#: `at:` 与 `依据：`、`来源：` 并排——一节的开头三行都是出处，没有一句是正文。
_MACHINE_LINES = ("#", ">", "依据：", "来源：", "at:")


def _summary_of(text: str, limit: int = 120) -> str:
    """取正文第一句：跳过 frontmatter、标题、旁注与机器的字段行。

    事件与每日快照是一事一文件（只有 `# ` 标题）；角色档案是一人一文件，
    下面是若干 `## ` 小节。两种都要能读，所以这里按「行首像什么」判，
    不按文件形态判。
    """
    lines = text.splitlines()
    in_frontmatter = bool(lines) and lines[0].strip() == "---"
    for index, line in enumerate(lines):
        if in_frontmatter:
            if index > 0 and line.strip() == "---":
                in_frontmatter = False
            continue
        stripped = line.strip()
        if not stripped or stripped.startswith(_MACHINE_LINES):
            continue
        return stripped[:limit]
    return ""


__all__ = ["MemoryWriter", "WrittenMemory"]
