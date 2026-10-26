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

import threading
from dataclasses import dataclass
from pathlib import Path

from events.log import EventLog
from memory import format as fmt
from memory.evidence import EvidenceCheck, check_evidence
from memory.paths import MemoryLayout

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
                handle.write(fmt.render_character_section(check, draft.title, draft.body))
        else:
            path.write_text(
                fmt.render_character_file(subject, check, draft.title, draft.body),
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
        """列出已经落盘的记忆与摘要。

        摘要取每份文件的第一个非空、非标题行——那是正文的第一句，
        也是人在 `GET /api/memory/list` 里真正想看到的东西。标题他自己有。
        """
        entries: list[dict[str, object]] = []
        for kind, paths in (
            (EVENT_ENTRY, self._layout.event_files()),
            (CHARACTER_ENTRY, self._layout.character_files()),
        ):
            for path in paths:
                entries.append(
                    {
                        "kind": kind,
                        "title": _title_of(path),
                        "path": self._relative(path),
                        "summary": _summary_of(path),
                    }
                )
        entries.sort(key=lambda item: str(item["path"]))
        return entries


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:  # pragma: no cover - 文件在读之前被移走
        return ""


def _title_of(path: Path) -> str:
    """从文件里取标题：第一个 `# ` 开头的行。

    不从文件名取——文件名被 slugify 洗过（`渡口的第一夜` → `渡口的第一夜`，
    但 `a/b` → `a-b`），而文件里那一行是原样写下的。
    """
    for line in _read(path).splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and stripped[2:].strip():
            return stripped[2:].strip()
    return path.stem


def _summary_of(path: Path, limit: int = 120) -> str:
    """取正文第一句：跳过 frontmatter、标题、旁注与机器的字段行。

    两种文件形态都要能读：`events/` 下是一事一文件（只有 `# ` 标题），
    `characters/` 下是一人一文件（`# ` 人名 + 若干 `## ` 小节）。
    """
    lines = _read(path).splitlines()
    in_frontmatter = bool(lines) and lines[0].strip() == "---"
    for index, line in enumerate(lines):
        if in_frontmatter:
            if index > 0 and line.strip() == "---":
                in_frontmatter = False
            continue
        stripped = line.strip()
        # 标题、旁注（`> `）、依据与来源都不是人写的话。
        if not stripped or stripped.startswith(("#", ">", "依据：", "来源：")):
            continue
        return stripped[:limit]
    return ""


__all__ = ["MemoryWriter", "WrittenMemory"]
