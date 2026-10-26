"""记忆文件的 Markdown 形态：YAML frontmatter + 正文。

**不写墙钟。** frontmatter 里只有世界时间 `at`（固定步长推进的毫秒数），
没有「什么时候写进磁盘的」。理由和事件日志一样：带墙钟的文件在不同机器上
长得不一样，`diff` 会满屏都是时间戳，真正变了什么反而看不出来。
需要墙钟时由调用方自己记在正文里，那是人写的话，不是机器的字段。

**逐条记忆是追加，不是覆盖。** `characters/莞尔.md` 会随着时间越写越长，
每次写入往文件末尾接一节。覆盖式写入会让「她记得我做过什么」只剩最后一件——
那正好是最不该丢的那件。
"""

from __future__ import annotations

import yaml

from memory.evidence import EvidenceCheck

#: 单条记忆小节之间空两行；`##` 是记忆的标题，`#` 整份档案只有一个。
_SECTION_JOIN = "\n\n"

#: 角色档案开头的说明。写成 blockquote：它是对读的人的提示，不是记忆本身，
#: 而 `> ` 是 Markdown 里现成的「这是旁注」记号——列摘要时也靠它跳过。
_CHARACTER_NOTE = "> 单人档案。逐条追加，只增不改；每条都注明它依据的事件 id。"


def frontmatter(fields: dict[str, object]) -> str:
    """序列化一段 frontmatter。

    `allow_unicode=True` 不能省：默认会把中文转义成 `\\uXXXX`，
    于是 `subject: 莞尔` 在文件里变成一行天书，而这份文件的本意就是给人读。
    `sort_keys=False` 保持字段顺序——frontmatter 是给人扫的，顺序是内容的一部分。
    """
    dumped = yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, default_flow_style=False)
    return f"---\n{dumped.strip()}\n---\n"


def read_frontmatter(text: str) -> dict[str, object]:
    """读回一段 frontmatter。

    **写出去的要能读回来**，否则「每日快照可重新生成」这件事只能靠人眼比对。
    列表要按世界时间排成编年史，靠的也是这里的 `at`。

    解析失败返回空字典，不抛：一份手写坏了的文件不该让整个列表打不开。
    宁可少一个字段，也不能让读面因为一个文件而整体失败。
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    for index in range(1, len(lines)):
        if lines[index].strip() != "---":
            continue
        block = "\n".join(lines[1:index])
        try:
            fields = yaml.safe_load(block)
        except yaml.YAMLError:
            return {}
        return fields if isinstance(fields, dict) else {}
    return {}


def _evidence_line(check: EvidenceCheck) -> str:
    cited = "、".join(f"#{event.id} `{event.kind}`" for event in check.events)
    return f"依据：{cited}"


def render_character(
    *,
    at: float,
    check: EvidenceCheck,
    draft_title: str,
    body: str,
) -> str:
    """一条角色记忆的正文小节（不含文件头的 frontmatter）。

    `at` 与 `依据`、`来源` 并排写成一行：它们是同一类东西——这条记忆的出处。
    没有它，一条居民记忆在编年史里就永远排不到它发生的位置上，
    而「她记得那场雨」本该出现在那场雨那天，不是排在所有事件后面。
    """
    lines = [
        f"## {draft_title}",
        "",
        f"at: {at}",
        _evidence_line(check),
        "来源：direct_observation",
        "",
    ]
    return "\n".join(lines) + body.strip() + "\n"


def render_character_file(subject: str, check: EvidenceCheck, draft_title: str, body: str, at: float) -> str:
    """角色档案的第一次写入：文件头 + 第一节。"""
    head = frontmatter(
        {"kind": "character", "subject": subject, "source": "direct_observation", "at": at}
    )
    return (
        head
        + "\n"
        + f"# {subject}\n\n{_CHARACTER_NOTE}\n\n"
        + render_character(at=at, check=check, draft_title=draft_title, body=body)
    )


def render_character_section(check: EvidenceCheck, draft_title: str, body: str, at: float) -> str:
    """角色档案的后续写入：只接一节，不动前面已经写下的任何字节。"""
    return _SECTION_JOIN + render_character(
        at=at, check=check, draft_title=draft_title, body=body
    )


def render_event(
    *,
    seq: int,
    title: str,
    body: str,
    check: EvidenceCheck,
    at: float,
) -> str:
    """一条单次事件的完整文件。"""
    head = frontmatter(
        {
            "kind": "event",
            "id": f"E{seq:04d}",
            "title": title,
            "at": at,
            "source": "direct_observation",
            "evidence": list(check.ids),
            "evidenceKinds": list(check.kinds),
        }
    )
    return head + "\n" + f"# {title}\n\n" + _evidence_line(check) + "\n\n" + body.strip() + "\n"


__all__ = [
    "frontmatter",
    "render_character",
    "render_character_file",
    "render_character_section",
    "render_event",
]
