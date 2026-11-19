"""外环题面去噪：发给大模型的上下文在拼装前过的共享清洗层（纯函数）。

`villager_decision` 与 `work_note` 两条路都要把调用方递来的字典拼成提示词；
脏数据混进来的方式也一样——空字段（None / "" / 空列表）、长精度浮点
（坐标 / 概率长小数）、模型不需要理解的内部程序 id / 调试字段。这儿的洗法
必须是纯函数：同一份脏输入永远洗出同一份干净上下文，才能被单测钉死。

两条纪律：

- **只渲染白名单里的业务字段，绝不 `str()` 整个 dict / list。** 旧代码对
  标签字段做 `str(...)` 兜底，调用方递来一个带坐标的 dict，整段程序 repr
  （引号、花括号、长尾小数）就会原样写进提示词——那是要清的噪声，不是
  模型该读的事实。
- **数字只以整数形出现。** 「第 3.1415926535 天」「存货 2.9999999 份」对
  模型没有意义，留下就是程序噪声；能无损写成整数的浮点（`3.0`）进，
  带小数的一律丢。

边界：`oracle/prompt.py`（意图解析那条路）由
`tests/test_prompt_whitelist_agreement.py` 的强契约守着，且它要保留
instanceId 给模型抄——与本路的清洗需求相反，本模块不碰它。
"""

from __future__ import annotations

import math
from typing import Any

#: 单次请求最多带多少条记忆。模型上下文是有限资源，记忆按先来后到取前 N 条；
#: 超出的不是被「截断」，而是这次请求没带——世界不会因此停摆。
MAX_MEMORIES = 10


def is_blank(value: Any) -> bool:
    """空字段：None、去空白后的空串、空列表/元组/字典/集合。

    0 与 False 不算空——它们是值。只是本仓库两条外环路没有字段会把 0 / False
    当业务值渲染，调用处走 text() / whole_int() 时它们自然落到 None。
    """
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


def text(value: Any) -> str | None:
    """只收非空字符串：去首尾空白；空串 / 非字符串（数字、字典、列表）一律 None。

    为什么不用 `str(value)` 兜底，见模块头第一条纪律。标签字段的类型契约是
    字符串；坏了就当没有，让调用处走自己的兜底文案，而不是把程序 repr 喂给模型。
    """
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def whole_int(value: Any) -> int | None:
    """只收能无损写成整数的值：int（不含 bool）、整除的 float、"3" 形字符串。

    长精度浮点（坐标 / 概率长小数）、NaN / 无穷、拼不整的字符串 → None。
    bool 明排除：`isinstance(True, int)` 为真，放进来会渲染出「第 True 天」。
    """
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return None
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def str_items(value: Any) -> list[str]:
    """列表清洗：只留非空字符串项，去重保序。非列表 / 空列表 → []。

    列表项若是 dict / 数字（活动、人群里都可能混进），整段丢弃而不是 str()——
    理由同 text()。重复项只留第一次出现的：同一件事对模型说两遍，
    它会以为有两件。
    """
    if not isinstance(value, (list, tuple)):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        cleaned = text(item)
        if cleaned is None or cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
    return out


def unique(lines: list[str]) -> list[str]:
    """去重保序：同一渲染行只出现一次。

    记忆按渲染后的行去重——「昨天集市缺货」记了两次，提示词里说一次就够；
    场所按 siteId 去重在调用处做（那儿还分得清同名不同 id 的两处场）。
    """
    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if line in seen:
            continue
        seen.add(line)
        out.append(line)
    return out
