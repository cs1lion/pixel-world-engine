"""`memory/` 的目录结构与文件名规范。

**这个模块存在的理由是安全。** 记忆的标题来自调用方（最终来自用户的一句话），
而标题要进文件名。不设防的 `f"{title}.md"` 就是一条路径穿越：
`../../.git/config`、`..\\..\\world-client\\index.html`、或者一个 NUL 字节，
都能让"写一条记忆"变成"写仓库里任何一个文件"。

所以这里的三条规矩：

1. **slug 里不许出现 `.`。** 一个点都没有，`..` 就不可能被拼出来——
   先归一化再检查的做法永远漏得到，直接从字符集里禁掉才不会。
2. **落盘前再 resolve 一次，确认仍在根目录内。** 上面那条挡的是标题，
   这条挡的是将来有人改代码时引入的新路径。纵深，不依赖单点。
3. **Windows 保留名与尾点尾空格单独挡。** Windows 会把 `CON.md` 当设备、
   悄悄吃掉尾点尾空格——两个不同的标题会落到同一个文件上，
   表现成"第二条记忆把第一条覆盖了"。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

MEMORY_DIRNAME = "memory"
ENTRIES_DIR = "entries"
CHARACTERS_DIR = "characters"
EVENTS_DIR = "events"
RULES_DIR = "rules"
INDEX_NAME = "index.yaml"

#: 允许进 slug 的字符：数字、ASCII 字母、中文、连字符、下划线。
#: 中文要能进文件名——居民叫「莞尔」「汐」，记忆的标题也常常是中文。
#: 注意这里**没有** `.`：禁掉它，`..` 就永远拼不出来。
_SLUG_DISALLOWED = re.compile(r"[^0-9A-Za-z一-鿿＿－]+")

#: Windows 的设备名。大小写不敏感，且带不带扩展名都算。
_RESERVED_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL"]
    + [f"COM{index}" for index in range(10)]
    + [f"LPT{index}" for index in range(10)]
)

#: slug 长度上限。事件文件名还要带 `E0001-` 前缀与 `.md` 后缀，
#: 整个名字得留在 255 字节以内——中文一个字符占 3 字节，40 个中文字符就 120 字节，
#: 加上前后缀仍有余量。
MAX_SLUG_CHARS = 40


class MemoryPathError(ValueError):
    """文件名不合法。API 层转成 422。"""


def slugify(title: str, limit: int = MAX_SLUG_CHARS) -> str:
    """把标题归一成一个安全的文件名片段。

    不抛异常：标题里认不出来的字符换成连字符，重复的连字符折叠成一个。
    真正该拒的（空、保留名、超长）由 `check_slug` 在归一化**之后**判——
    顺序反了就会漏：`"..."` 归一化成 `"-"`，看着像合法，其实是把攻击载荷
    洗成了一个看似无害的名字。
    """
    collapsed = _SLUG_DISALLOWED.sub("-", title.strip())
    collapsed = re.sub(r"-{2,}", "-", collapsed).strip("-_")
    if len(collapsed) > limit:
        collapsed = collapsed[:limit].rstrip("-_")
    return collapsed


def check_slug(slug: str, label: str = "标题") -> str:
    """归一化之后的最后一道关。"""
    if slug == "":
        raise MemoryPathError(f"{label}里没有可用的字符：换一个能当文件名的标题")
    if slug in {".", ".."} or "/" in slug or "\\" in slug or "\x00" in slug:
        # 到不了这里——slugify 已经把这些字符洗掉了。留着是为了将来
        # 有人绕过 slugify 直接传 slug 时，这里仍然拦得住。
        raise MemoryPathError(f"{label}不能当文件名")
    if slug.upper() in _RESERVED_NAMES:
        raise MemoryPathError(f"{label}用了 Windows 保留名 {slug!r}，换一个")
    if slug != slug.rstrip(". "):
        # 到不了这里——`slugify` 已经把点洗成连字符了。留着是第二道防线：
        # 将来有人绕过 slugify 直接调 check_slug 时，这里仍然拦得住。
        raise MemoryPathError(f"{label}不能以点或空格结尾")
    return slug


def safe_name(title: str, label: str = "标题") -> str:
    return check_slug(slugify(title), label)


@dataclass(frozen=True)
class MemoryLayout:
    """`memory/` 的目录布局。测试传 tmp_path，生产指向仓库根下的 `memory/`。"""

    root: Path

    @classmethod
    def at(cls, path: str | Path) -> "MemoryLayout":
        return cls(Path(path))

    @classmethod
    def for_repo(cls, repo_root: str | Path) -> "MemoryLayout":
        return cls(Path(repo_root) / MEMORY_DIRNAME)

    def ensure(self) -> None:
        """建齐四个子目录。第一次写入不该因为少一个目录就失败。"""
        for name in (ENTRIES_DIR, CHARACTERS_DIR, EVENTS_DIR, RULES_DIR):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ 路径

    def _resolve(self, relative: Path, label: str) -> Path:
        """拼路径并确认它仍在根目录内。

        `resolve()` 会把 `..` 与符号链接一起解掉，所以这一判据挡的是
        「标题洗干净了、但路径在别处被拼坏」的那类 bug。两关都要过：
        `check_slug` 挡已知的攻击，这一关挡未知的改动。
        """
        candidate = (self.root / relative).resolve()
        root = self.root.resolve()
        if candidate != root and root not in candidate.parents:
            raise MemoryPathError(f"{label}落到了 memory/ 外面：{relative}")
        return candidate

    def entry_path(self, day: int) -> Path:
        """每日快照：`entries/day-0007.md`。

        用世界日序号而不是日历日期：事件的 `at` 是世界时间，没有墙钟。
        见模块 docstring 与 `docs/adr/ADR_MEMORY.md`。
        """
        if isinstance(day, bool) or not isinstance(day, int) or day < 0:
            raise MemoryPathError(f"世界日序号必须是非负整数，收到 {day!r}")
        return self._resolve(Path(ENTRIES_DIR) / f"day-{day:04d}.md", "每日快照")

    def character_path(self, name: str) -> Path:
        return self._resolve(Path(CHARACTERS_DIR) / f"{safe_name(name, '角色名')}.md", "角色档案")

    def event_path(self, seq: int, title: str) -> Path:
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
            raise MemoryPathError(f"事件序号必须从 1 开始，收到 {seq!r}")
        return self._resolve(
            Path(EVENTS_DIR) / f"E{seq:04d}-{safe_name(title, '事件标题')}.md", "单次事件"
        )

    def rules_path(self, name: str) -> Path:
        return self._resolve(Path(RULES_DIR) / f"{safe_name(name, '规则名')}.yaml", "规则")

    def index_path(self) -> Path:
        return self._resolve(Path(INDEX_NAME), "索引")

    # ------------------------------------------------------------------ 列目录

    def _markdown_in(self, dirname: str) -> list[Path]:
        folder = self.root / dirname
        if not folder.is_dir():
            return []
        return sorted(path for path in folder.glob("*.md") if path.is_file())

    def entry_files(self) -> list[Path]:
        return self._markdown_in(ENTRIES_DIR)

    def character_files(self) -> list[Path]:
        return self._markdown_in(CHARACTERS_DIR)

    def event_files(self) -> list[Path]:
        return self._markdown_in(EVENTS_DIR)

    def next_event_seq(self) -> int:
        """下一条事件的序号。

        扫现有文件取最大值 +1。不读 `index.yaml`——索引是派生的，
        拿派生物当分配的凭据，索引一旧就会重号，而重号会让两条记忆
        互相覆盖。
        """
        highest = 0
        for path in self.event_files():
            stem = path.stem
            if not stem.startswith("E"):
                continue
            digits = stem[1:].split("-", 1)[0]
            if digits.isdigit():
                highest = max(highest, int(digits))
        return highest + 1


__all__ = [
    "CHARACTERS_DIR",
    "ENTRIES_DIR",
    "EVENTS_DIR",
    "INDEX_NAME",
    "MAX_SLUG_CHARS",
    "MEMORY_DIRNAME",
    "MemoryLayout",
    "MemoryPathError",
    "RULES_DIR",
    "check_slug",
    "safe_name",
    "slugify",
]
