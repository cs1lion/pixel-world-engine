"""提示词与该说哪些命令，必须与规则层白名单对得上——包括**没列**的那几条。

## 为什么要有这个文件

`oracle/prompt.py` 的 `COMMAND_LINES` 告诉模型它能说什么；
`rules/schema.py` 的 `COMMAND_CHECKS` 决定什么过得去。两份各自维护，就一定会漂。
漂的方向三种，**没有一种被完整盖住**：

1. **提示词列了白名单里没有的命令**——模型每一次都说它，每一次都被拒，
   而用户看到的是「听懂了，然后什么也没发生」。
2. **白名单加了命令而提示词没列**——那条命令永远说不出口，是死的；同时
   `oracle/prompt.py` 开头那句「六条命令」变成假话。
3. **为不列某条命令写的理由过期了**——比如前端已经补上了那个意图，注释里
   「客户端与世界都还没有对应的意图」还在，依据没了。

## 已经盖住多少（2026-10-28 实测，别把别人的功劳说成自己的）

`server/tests/test_orchestrator.py` 有两条，方向 2 **它已经盖住了**：

- `test_提示词列出每一种世界能执行的命令`：`expressible = sorted(set(COMMAND_CHECKS)
  - {"npc.setSchedule"})`，逐条断言在提示词里。往 `COMMAND_CHECKS` 加一条
  `foo.bar`，它红（实测：`missing == ['foo.bar']`）。
- `test_提示词不列世界办不到的命令`：断言 `npc.setSchedule` 不在提示词里。

所以本文件**不是**「三种都没有任何机关会红」——第一版文件头就是这么写的，
**那句话是假的**，`27c868f` 的提交信息里同样写着「已有的测试都不覆盖这件事」，
也不成立。已按实测改写。

本文件真正多出来的是三样，前两样正是这个仓库**已经犯过六回**的那一类：

- **方向 1 的反向**：`test_提示词列出每一种世界能执行的命令` 只从白名单问
  （白名单 → 提示词），提示词点名而白名单没有的它查不到。
- **那句「N 条命令」的散文**：`rules/schema.py` 的小节标题写「六条命令」而下面
  挂着七个校验函数；`test_rules_schema.py` 的模块 docstring 同样写「六条」，
  而同一份文件第 31 行的测试名字就叫 `test_白名单就是票面上的七条`——一份文件
  隔 30 行自我矛盾。`067dd3a`、`cdcb2e4`、`b6e5063`、`bca5def`、`183b292`、
  `6d51bf9` 六笔全是人手 grep 出来的，其中 `cdcb2e4` 自己写着「我上一笔的 grep
  被 `| head -8` 截断了」。**没有一道闸量过那句话。**
- **方向 3 的理由**：`test_提示词不列世界办不到的命令` 只断言「不在提示词里」，
  不管那个理由是否还成立。

剩下两条（判据二的登记表卫生、判据五的键形状）是**记账**，不是新覆盖，
写在这儿是为了让 `NOT_LISTED` 不长毛——别把它们说成抓住了什么。

## 数与理由都从代码里量，不手写

`PROMPT_COMMANDS` / `NOT_LISTED` 由 `COMMAND_LINES` 与 `COMMAND_CHECKS`
**现算**，再与下面钉住的期望比。所以「改一边忘了另一边」会红，
而「两张表一起改」也会红（因为理由那一栏要重新核）。

读 `world-client/src` 是顺着仓里已有的做法：`test_intent_api.py` 就读
`docs/intent.sample.json`，那份文件同时被前端的合同测试读。跨边界读文件
在这个仓库里不是新事。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from oracle.prompt import COMMAND_LINES
from rules.schema import COMMAND_CHECKS

#: 仓库根：`server/tests/<本文件>` 往上三级。
ROOT = Path(__file__).resolve().parents[2]

#: 前端源码。第 4 条测试要在这儿找「理由还成立吗」。
CLIENT_SRC = ROOT / "world-client" / "src"

#: 提示词源码。第 3 条测试要在这儿读那句「N 条命令」。
PROMPT_SRC = ROOT / "server" / "oracle" / "prompt.py"

#: 命令名的形状：`weather.set` / `villager.carry`。点左边是命名空间。
_COMMAND_IN_PROMPT = re.compile(r'"command"\s*:\s*"([a-z]+\.[A-Za-z]+)"')

#: 中文数字。只到十——命令条数不可能超过十，真到了先把这份文件改对。
_CN_NUMERAL = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def prompt_commands() -> set[str]:
    """提示词里点名让模型输出的命令，去重。

    `villager.carry` 在 `COMMAND_LINES` 里出现两次（`carries` 与 `remove`
    两种形状），那是**一条**命令的两种用法，不是两条。去重在这儿做，
    别在调用处做——两处都做就会有一处忘记。
    """
    return set(_COMMAND_IN_PROMPT.findall(COMMAND_LINES))


def whitelist() -> set[str]:
    return set(COMMAND_CHECKS)


#: 白名单里有、提示词里**没列**的命令，以及为什么可以不被列出来。
#:
#: 双向 diff：白名单加了新命令而这儿没登记 → 红；登记了的命令出现在提示词里 → 红。
#: `why` 是散文，只有 review 能抓住它说谎——所以第 4 条测试把它依据的事实
#: 重新量一遍。
NOT_LISTED: dict[str, str] = {
    "npc.setSchedule": (
        "它是一条合法的世界命令（`COMMAND_CHECKS` 收它），但客户端与世界都还没有"
        "对应的意图：`world-client/src/world/intent-schema.ts` 的 `IntentKind` "
        "联合里没有它。写进提示词就是让模型去说一件世界办不到的事——用户会看到"
        "「听懂了」然后什么也没发生。第 4 条测试盯着这个依据。"
    ),
}


# ---------------------------------------------------------------- 三条判据

def test_提示词点名的命令都在白名单里() -> None:
    """提示词不许让模型说一句一定被拒的话。"""
    unknown = sorted(prompt_commands() - whitelist())
    assert unknown == [], (
        f"提示词点了这些白名单里没有的命令：{unknown}。"
        "模型每一次都说它，每一次都被拒，用户看到的是「听懂了然后什么也没发生」。"
        "要么把它加进 `rules/schema.py` 的 `COMMAND_CHECKS`，要么从 `COMMAND_LINES` 里删掉。"
    )


def test_白名单里每一条都被处置了() -> None:
    """双向：新命令必须被处置（列出来或登记），登记过的命令必须真的没被列。"""
    listed = prompt_commands()

    unhandled = sorted(whitelist() - listed - set(NOT_LISTED))
    assert unhandled == [], (
        f"白名单里有这些命令，提示词没列，NOT_LISTED 里也没登记：{unhandled}。"
        "模型永远说不出口它，而 `oracle/prompt.py` 开头那句「N 条命令」同时变成假话。"
        "两种处置：加进 `COMMAND_LINES`，或往 NOT_LISTED 登记并写清为什么可以不被列。"
    )

    stale = sorted(set(NOT_LISTED) & listed)
    assert stale == [], (
        f"这些命令已经列进提示词了，NOT_LISTED 里的登记过期了，删掉对应行：{stale}。"
        "留着它，下一个人会以为它们说不出口。"
    )

    ghost = sorted(set(NOT_LISTED) - whitelist())
    assert ghost == [], (
        f"NOT_LISTED 里这些命令已经不在白名单里了：{ghost}。删掉对应行。"
    )


def test_提示词开头的条数与列出来的条数一致() -> None:
    """「N 条命令」那句散文必须等于 `COMMAND_LINES` 里实际点名的条数。

    这就是本仓库犯过六回的那个错：注释写「六条」，代码是七条。
    数字从代码里现算，注释里的中文数字一个一个拿来比——**有几处就要比几处**，
    因为同一个文件里两处写不一样的值也是同一个错。

    只读 `COMMAND_LINES =` 上面那段 `#:` 注释，**不读整个文件**：
    `COMMAND_LINES` 自己那段提示词正文里有一句「一次最多一条命令」（第 118 行），
    那是说单次响应里能有几条，不是说清单里有几条。第一版正则扫整个文件，
    把它一起抓了，于是这条判据天天红——红成噪声之后就没人看它了。

    判据的形状是「N 条**命令**」，不是「N 条」：那段注释里还有一句
    「它是一条合法的世界命令」，指的是 `npc.setSchedule` 那一条命令的身份，
    不是清单的条数。第二版正则写的是 `N 条`，把它一起抓了。
    所以现在要求 `条` 后面紧跟着 `命令`。

    代价说清：只锚「N 条命令」这一种写法。同一段注释里「只列世界真能执行的六条」
    那种写法今天不被查——一个锚足够抓住那个假话，而写法真变了，下面那句
    「找不到」会红，那正是要人回来重新指路的意思。
    """
    expected = len(prompt_commands())
    source = PROMPT_SRC.read_text(encoding="utf-8")

    anchor = source.index("COMMAND_LINES = ")
    # 从赋值处往前，收连续成段的 `#:` 注释行。
    # 赋值行与注释之间有一个空行，所以**开始收集之前**的空行跳过；一旦开始收集，
    # 空行就意味着这段注释到此为止——否则会把上面不相干的注释一起并进来。
    above: list[str] = []
    started = False
    for line in reversed(source[:anchor].split("\n")):
        stripped = line.strip()
        if not started:
            if not stripped:
                continue
            if not stripped.startswith("#:"):
                break
            started = True
        elif not stripped.startswith("#:"):
            break
        above.append(line)
    block = "\n".join(reversed(above))
    assert block.strip(), (
        f"`COMMAND_LINES` 上面找不到 `#:` 注释段了。本文件钉的正是那段话里的条数，"
        "注释没了这条判据就失去对象。如果是刻意删掉，回来把这条与文件头一起改对。"
    )

    found = re.findall(r"([一二两三四五六七八九十])条命令", block)
    assert found, (
        f"`COMMAND_LINES` 上面的注释里找不到「N 条命令」这个说法了（现在写的是：{block.strip()}）。"
        "说法没了这条判据就失去对象。如果是刻意改成别的说法，回来把正则一起改对，别把这条删掉。"
    )

    for numeral in found:
        assert _CN_NUMERAL[numeral] == expected, (
            f"`COMMAND_LINES` 上面的注释写着「{numeral}条」，而它实际点名 "
            f"{expected} 条（{sorted(prompt_commands())}）。"
            "改条数就得改这句话——这句话是给人核的第一手信息，它假了比没有更糟。"
        )


def test_没被列出来的那条_理由还成立() -> None:
    """`NOT_LISTED` 的 `why` 说「前端还没有那个意图」——去前端数一遍。

    依据是散文，只有重新量才能抓住它过期。今天量出来是：`IntentKind`
    联合里没有 `npc.setSchedule`，`world-client/src` 里也搜不到 `setSchedule`。

    这条红了不该把断言改绿：要么前端那个意图撤掉，要么把这条命令列进提示词，
    要么把 `why` 改成新的、仍然真实的理由。
    """
    if not CLIENT_SRC.is_dir():
        pytest.fail(
            f"找不到 {CLIENT_SRC}。这条判据要读前端源码才能判断理由是否过期，"
            "看不到源码它就无法判——而跳过它等于这道闸安静地不再把关。"
            "如果是在一个只有 server/ 的部分检出里跑，那是环境问题，不是代码问题；"
            "完整检出（CI 的样子）里这条必须能跑。"
        )

    sources = sorted(CLIENT_SRC.rglob("*.ts"))
    assert sources, f"{CLIENT_SRC} 里一个 .ts 都没有——判据失去对象，回来重写它。"

    for command, why in NOT_LISTED.items():
        verb = command.split(".", 1)[1]
        hits = [p for p in sources if verb in p.read_text(encoding="utf-8")]
        assert hits == [], (
            f"`{command}` 没被列进提示词，理由是「客户端与世界都还没有对应的意图」，"
            f"但前端源码里已经出现了 `{verb}`："
            f"{[str(p.relative_to(ROOT)) for p in hits]}。"
            "理由过期了。三种处置：撤掉前端那个意图、把命令列进提示词、"
            "或者把 NOT_LISTED 的 why 改成新的真实理由。别把这条改绿。"
        )


def test_登记表本身没长毛() -> None:
    """键得是命令名，理由得非空——形状一乱，上面的差集就会静默漏掉它。"""
    for command, why in NOT_LISTED.items():
        assert re.fullmatch(r"[a-z]+\.[A-Za-z]+", command), (
            f"NOT_LISTED 的键 {command!r} 不是「命名空间.动词」的形状"
        )
        assert why.strip(), f"{command} 没写为什么——登记不写理由就成了豁免名单"
