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
        """写一条记忆。磁盘上不留半条痕迹——要么整条写成，要么一个字节都不落。

        2026-10-28 补记：这行原来写「任何一关不过就抛 `MemoryWriteError`」，
        **后半句真，前半句假**。`write()` 里没有任何 try/except 做转换，
        三关抛的是三个平级的 `ValueError` 子类：
        - `check_draft`（`memory/__init__.py`，形状与铁律）→ `MemoryWriteError`
        - `check_evidence`（`memory/evidence.py`，引用的事件要在日志里）→ `EvidenceError`
        - 路径/版面那几关（`memory/paths.py`）→ `MemoryPathError`

        照原来那句写 `except MemoryWriteError` 的调用方，会漏掉 `EvidenceError`
        与 `MemoryPathError` 两种真实失败。要全都接住，就接 `ValueError`，
        或把这三个名字都列出来。
        （2026-10-28 第二笔补记：这里原来接着写「`memory/api.py` 正是分别给
        `MemoryWriteError` 与 `MemoryPathError` 挂了 handler——它没被这句骗到」。
        **那是选择性列举，读起来像穷举。** `memory/api.py` 实际挂了**四个**
        handler：`MemoryWriteError`、`MemoryPathError`、`EvidenceError`、
        `SnapshotError`，四个全回 422。调用方那一边四个都接住了，
        被那句骗到的只会是下一个读这个 docstring 的人。）
        """
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
                # 先确认这份文件在 memory/ 内，再读它。反过来的话，一个解析到
                # `memory/` 外面的符号链接会先被读出来、随后被 `_relative` 拒，
                # 于是**整个列表**422——而读端点该有的是「跳过这一份」。
                # `resolve_entry` 那条路是干净的（`_resolve` 先拒），两条路
                # 对同一个文件的判定原本相反。
                try:
                    relative = self._relative(path)
                except MemoryWriteError:
                    continue
                text = _read(path)
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
                            "summary": _summary_of(section.body, kind),
                            "at": section.at,
                            # 第几个世界日由服务端算，不在客户端再写一遍 DAY_MS——
                            # 同一个常数出现在两边，迟早会有一边忘了改。
                            "day": None if section.at is None else day_of(section.at),
                        }
                    )
        entries.sort(key=lambda item: (item["at"] is None, item["at"] or 0, str(item["path"])))
        return entries

    def read_entry(
        self,
        relative: str | None,
        section: str | None = None,
        at: float | None = None,
    ) -> dict[str, object]:
        """读一份记忆的全文。

        票据 #7 的验收是「像读一本编年史」——只有标题与一行摘要是目录。
        编年史要能翻开，所以读面给的是全文。

        给了 `section` 就只要那一节（连同它所属的 `# ` 人名标题）：
        列表里的一行是一条记忆，点开它就该读到那一条，不是整个人档案。

        `at` 是**消歧**，可省。小节只用标题当身份，而同一个人对同一件事的
        两次观测会有两个同名小节——列表里那是两行，`path` 与 `section`
        逐字节相同，只有 `at` 不同。这时不给 `at` 就返回第一个，
        等于在两条真相里挑一条，而读者看到的两行一模一样，
        永远不知道自己读的是哪一条。所以这里报错，不挑。

        路径不接受调用方自由构造：走 `resolve_entry` 的白名单，
        只有 `list_entries` 会列出去的文件才读得回来。小节名也不接受——
        它必须是那份文件里真有的一个 `## ` 标题。
        """
        path = self._layout.resolve_entry(relative)
        posix = self._relative(path)
        text = _read(path)
        if section is not None:
            # 只有角色档案分节读。事件与每日快照里的 `## ` 是排版
            # （`snapshot.render` 的「## 天气」），按它切会把一份文档剁成几段，
            # 每段都读起来像缺了什么。`list_entries` 早就按目录分了这层类，
            # 读面这里原先漏了同一道分别——于是给一份日志传 section
            # 会拿回被切掉大半的文件，还以「这条记忆的全文」的姿态。
            if _kind_of(posix) != CHARACTER_ENTRY:
                raise MemoryPathError(
                    "只有角色档案分节读：这份记忆是一事一文件，给它 section 只会读回半份"
                )
            text = _slice_to_section(text, section, at)
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
    except UnicodeDecodeError:
        # `memory/` 是 checked-in 的 Markdown，本来就是给人手改的——手改就有人
        # 把它存成了 GBK。`read_text` 撞上非 UTF-8 字节抛的是 `UnicodeDecodeError`，
        # 那是 `ValueError` 的子类，不在上面的 `except OSError` 里，
        # 于是两个读端点一起 500：整个镇志抽屉全黑，只因为一个文件。
        # `format.py` 的 `read_frontmatter` 早就为坏 YAML 做了降级
        # （「一份手写坏了的文件不该让整个列表打不开」），编码这一路原来没有。
        return path.read_bytes().decode("utf-8", "replace")


def _at_of(text: str) -> float | None:
    """frontmatter 里的世界时间。读不回来就 `None`，不猜。"""
    fields = fmt.read_frontmatter(text)
    value = fields.get("at")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        # 每日快照的 frontmatter 写的是 `day:` / `from_ms:` / `to_ms:`，没有 `at`
        # （`snapshot.render`）。它那一天的世界时间就是 `from_ms`——窗口起点。
        # 不认它的话，整整一类条目在编年史里 `at` 是 `None`、`day` 也是 `None`：
        # 排序键把 `None` 排在最后，于是第 3 天的日志排在第 2 天的记忆后面，
        # 而行上只剩「日志」两个字，既排不进它所属的那天，也看不出是哪一天。
        value = fields.get("from_ms")
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
        sections.append(
            _Section(
                title=title,
                body="\n".join(chunk),
                at=_at_of_chunk(lines, heads, position),
                is_section=True,
            )
        )
    return sections


def _at_of_chunk(lines: list[str], heads: list[int], position: int) -> float | None:
    """第 `position` 节里的世界时间行。认不出来是 `None`，不猜。"""
    start = heads[position]
    end = heads[position + 1] if position + 1 < len(heads) else len(lines)
    for line in lines[start + 1 : end]:
        match = _AT_LINE.match(line.strip())
        if match is not None:
            return float(match.group(1))
    return None


def _slice_to_section(text: str, section: str, at: float | None = None) -> str:
    """取一份角色档案里名为 `section` 的那一节，连同文件头的 `# ` 人名。

    小节名必须是那份文件里真有的一个 `## ` 标题——不是的话报错，
    不退回「给整份文件」：那会让调用方以为读到了那一节，其实读到了全部。

    `at` 给了就只认那一条。同名小节是有的：同一个人对同一件事的两次观测，
    两个小节同名、`at` 不同。这时不给 `at` 会**静默返回第一条**——
    列表里那两行逐字节相同，读者永远不知道自己读的是哪一条。
    """
    lines = text.splitlines()
    heads = [index for index, line in enumerate(lines) if _SECTION_HEADING.match(line.strip())]
    wanted = section.strip()
    matches = [
        position
        for position, start in enumerate(heads)
        if _SECTION_HEADING.match(lines[start].strip()).group(1) == wanted
    ]
    if not matches:
        raise MemoryPathError(f"这份档案里没有「{section}」这一节")
    if len(matches) > 1 and at is None:
        # 说不清就得说清「哪里说不清」。早先这里把 `None` 直接拼进句子：
        # 「世界时间 None、9000.0，要读哪一条得带上 at」——而 `at=None`
        # 永远匹配不上任何一节（`_at_of_chunk` 认不出 `at:` 行时返回 None，
        # 那一条就此读不回来），这句劝告是做不到的。手写的旧档案里就有这种节。
        times = [_at_of_chunk(lines, heads, item) for item in matches]
        silent = sum(1 for value in times if value is None)
        when = "、".join("没写" if value is None else str(value) for value in times)
        hint = "要读哪一条得带上 at"
        if silent:
            hint = f"其中 {silent} 条没写世界时间，带 at 也指不到它们"
        raise MemoryPathError(
            f"「{section}」在这份档案里有 {len(matches)} 条（世界时间 {when}），{hint}"
        )
    if at is None:
        position = matches[0]
    else:
        found = [item for item in matches if _at_of_chunk(lines, heads, item) == at]
        if not found:
            raise MemoryPathError(f"这份档案里没有世界时间 {at} 的「{section}」")
        position = found[0]
    start = heads[position]
    end = heads[position + 1] if position + 1 < len(heads) else len(lines)
    # 人名那一行（第一个 `# `）留着：读一节时也该知道这是谁的档案。
    head = [line for line in lines[: heads[0]] if line.strip().startswith("# ")]
    return "\n".join(head + lines[start:end]).strip() + "\n"


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
#: 后面四个是每日快照 frontmatter 的键。正常情况下 `_body_lines` 已经把
#: frontmatter 整段剥掉了，列在这儿是为**没闭合**的那种：一份手写坏了的
#: 快照文件里 `day: 2` 会以正文第一行的身份出现，摘要于是变成 `day: 2`
#: ——正是这个函数当初要消灭的那个表现，只是换了条路进来。
_MACHINE_LINES = ("#", ">", "依据：", "来源：", "at:", "day:", "from_ms:", "to_ms:", "event_count:")

#: 快照里一条事件的行首：`- #12 天气转晴`。序号是挑「最早那条」的唯一凭据。
_EVENT_LINE = re.compile(r"^#(\d+)\s")


def _body_lines(text: str) -> list[str]:
    """frontmatter 之后的各行，逐行 trim 过。没有 frontmatter 就原样给。

    摘要是给人看的一句话，frontmatter 是机器的字段——`day: 0` 不是「那天发生了什么」。
    抽出来是因为两条路径都要跳过它：原先只有通用那条自己记着 `in_frontmatter`，
    快照那条漏了，于是「共 0 条」那天的摘要变成了 `day: 0`。

    「没闭合的 frontmatter」按**没有 frontmatter** 算，与 `format.read_frontmatter`
    同一个约定（那边也返回空字典）。那种文件是坏的一行都在，交给 `_MACHINE_LINES`
    去认，不在这儿猜它该在哪儿结束。
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return [line.strip() for line in lines]
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return [line.strip() for line in lines[index + 1 :]]
    return [line.strip() for line in lines]


def _summary_of(text: str, kind: str, limit: int = 120) -> str:
    """取正文第一句：跳过 frontmatter、标题、旁注与机器的字段行。

    事件与每日快照是一事一文件（只有 `# ` 标题）；角色档案是一人一文件，
    下面是若干 `## ` 小节。两种都要能读，所以按「行首像什么」判，
    不按文件形态判。

    `kind` 只为每日快照而传。它的正文第一句是模板行（「由事件日志派生，
    不要手改。世界时间 0–86400000 毫秒，共 2 条。」）——任意两天的摘要
    除了区间数字完全一样，人在列表里看不出那天发生了什么。所以快照取
    **第一条事件**；没有事件的那天，模板行之后紧跟的才是实话
    （「这一天什么都没发生。」），按**位置**跳过头一句，不按内容认——
    认内容就等于把快照的措辞抄进摘要层，那边一改这边就静默失效。
    """
    lines = _body_lines(text)
    if kind == DAY_ENTRY:
        # 「第一条事件」是**序号最小**的那条，不是文件里排最前的那条。
        # 快照按 `_SECTIONS` 的固定次序分节（天气→潮水→盖了起来→…），不是按
        # 事件序号：一天里 `#1 盖了起来` 与 `#2 rain` 并存时，`## 天气` 排在
        # `## 盖了起来` 前面，取「第一个 `- ` 行」拿到的是 `#2 rain`。
        # 行里带着序号（`- #{id} ...`），所以挑得出来。认不出序号的不参与
        # 比较——那是手写的，不是这条链子写的。
        earliest: tuple[int, str] | None = None
        for stripped in lines:
            if not stripped.startswith("- "):
                continue
            match = _EVENT_LINE.match(stripped[2:].strip())
            if match is None:
                continue
            candidate = (int(match.group(1)), stripped[2:].strip())
            if earliest is None or candidate[0] < earliest[0]:
                earliest = candidate
        if earliest is not None:
            return earliest[1][:limit]
        seen = 0
        for stripped in lines:
            if not stripped or stripped.startswith(_MACHINE_LINES):
                continue
            seen += 1
            if seen > 1:
                return stripped[:limit]
        return ""
    for stripped in lines:
        if not stripped or stripped.startswith(_MACHINE_LINES):
            continue
        return stripped[:limit]
    return ""


__all__ = ["MemoryWriter", "WrittenMemory"]
