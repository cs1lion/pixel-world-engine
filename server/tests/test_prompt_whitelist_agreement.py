"""提示词与该说哪些命令，必须与规则层白名单对得上——包括**没列**的那几条。

## 为什么要有这个文件

`oracle/prompt.py` 的 `COMMAND_LINES` 告诉模型它能说什么；
`rules/schema.py` 的 `COMMAND_CHECKS` 决定什么过得去。两份各自维护，就一定会漂。
漂的方向三种，今天各自被盖住多少见下面「已经盖住多少」——**那一节是实测的，
这一节只列方向，不重复盖住情况**（第一版在这儿写「没有一种被完整盖住」，
而方向 2 是被完整盖住的那一个，那句话是假的，已删）。

1. **提示词列了白名单里没有的命令**——模型每一次都说它，每一次都被拒，
   而用户看到的是「听懂了，然后什么也没发生」。
2. **白名单加了命令而提示词没列**——那条命令永远说不出口，是死的。
   注意它**不会**让 `oracle/prompt.py` 开头那句「六条命令」变成假话：那句数的
   是**列出来的**条数，不是白名单的条数。第一版的失败信息里写着「同时变成假话」，
   那句话是假的——判据三自己就能 disprove 它（往 `COMMAND_CHECKS` 加一条不列的
   命令，判据三照旧绿）。失败信息里的话最容易被下一个人当真，所以改对。
3. **为不列某条命令写的理由过期了**——比如前端已经补上了那个意图，注释里
   「客户端与世界都还没有对应的意图」还在，依据没了。

## 已经盖住多少（2026-10-28 实测，别把别人的功劳说成自己的）

`server/tests/test_orchestrator.py` 有两条，方向 2 **它已经盖住了**：

- `test_提示词列出每一种世界能执行的命令`：`expressible = sorted(set(COMMAND_CHECKS)
  - {"npc.setSchedule"})`，逐条断言在提示词里。往 `COMMAND_CHECKS` 加一条
  `foo.bar`，它红，报的是 `AssertionError: 提示词没讲 foo.bar`
  （`test_orchestrator.py:224` 的 `assert command in prompt, f"提示词没讲 {command}"`；
  第一版写 `:205`，那是 `test_提示词列出每一种模板` 里的
  `prompt = build_system_prompt(TEMPLATES)`——行号错了，行为描述是对的。
  同一节还在教人「连『隔几行』这种附带描述都会过期」，自己就有一个过期的）。
  第一版在这儿写「实测：`missing == ['foo.bar']`」——那个变量名和那个值是**我编的**，
  那个测试里没有叫 `missing` 的东西。红是真红，引号里那半句是假的。
- `test_提示词不列世界办不到的命令`：断言 `npc.setSchedule` 不在提示词里。

所以本文件**不是**「三种都没有任何机关会红」——第一版文件头就是这么写的，
**那句话是假的**，`27c868f` 的提交信息里同样写着「已有的测试都不覆盖这件事」，
也不成立。已按实测改写。

本文件真正多出来的是四样，前三样正是这个仓库**已经犯过六回**的那一类：

- **方向 1 的反向**：`test_提示词列出每一种世界能执行的命令` 只从白名单问
  （白名单 → 提示词），提示词点名而白名单没有的它查不到。
- **那句「N 条」的散文**：`rules/schema.py` 的小节标题**现在**写「七条命令」
  （第 154 行），`test_rules_schema.py` 的模块 docstring 也写「七条」——两处都带
  补记说明原来写「六条」。而 `test_rules_schema.py` 第 38 行的测试名字就叫
  `test_白名单就是票面上的七条`，与 docstring 第 1 行隔 37 行。**这三处今天是一致的**，
  没有矛盾；记在这儿是说那六笔修的就是这一类，以及修完之后连「隔几行」这种
  附带描述都会过期（第一版写「第 31 行」「隔 30 行」，那是补记之前的坐标，
  补记本身把行数推走了）。`067dd3a`、`cdcb2e4`、`b6e5063`、`bca5def`、`183b292`、
  `6d51bf9` 六笔全是人手 grep 出来的，其中 `cdcb2e4` 自己写着「我上一笔的 grep
  被 `| head -8` 截断了」。**没有一道闸量过那句话。**
- **方向 3 的理由**：`test_提示词不列世界办不到的命令` 只断言「不在提示词里」，
  不管那个理由是否还成立。
- **判据零：命令名正则的盲区**（`753227f` 之后补的）。前三样的输入全是
  `prompt_commands()`，而它靠 `_COMMAND_IN_PROMPT` 从 `COMMAND_LINES` 里刨命令名。
  第一版那条正则只认「小写命名空间.字母动词」，`villager.carry2` 这种名字
  **安静地整条消失**。实测（见判据零 docstring）：另外两条判据还是会红，
  但报的是「`villager.carry` 没列」和「条数少了」——两条都指错了地方，
  照着修会修错。判据零补上缺的那半句：点名是哪个名字吃不下。
- **判据六：SPEC.md 那句引文**（子 agent 2026-10-28 列成 G4 之后补的）。
  `docs/SPEC.md` 第 154 行把 `prompt.py` 的条数当**论据**引用，而引文不在
  判据三的射程里——子 agent 实测：把 `prompt.py` 第 27 行改成「七条」，
  当时 462 条测试全绿，SPEC 引来做依据的那句话没有任何机关量它。
  判据六补上：引文的数字必须等于实际点名的条数。实测（见该测试 docstring）。

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

#: 规范文档。判据六要在这儿读那句**引用** `prompt.py` 条数的话。
#:
#: 为什么读文档而不是只读代码：`prompt.py` 自己那两处由判据三盯着，可把它当作
#: **权威引用**的那一句在 `docs/SPEC.md` 里，不在 `prompt.py` 的射程里。
#: 子 agent 2026-10-28 实测确认：把 `prompt.py` 第 27 行改成「七条」，当时 462 条
#: 测试全绿——SPEC 引来做依据的那句话，没有任何机关量它。
SPEC_SRC = ROOT / "docs" / "SPEC.md"

#: 命令名的形状：`weather.set` / `villager.carry`。点左边是命名空间。
#:
#: 命令名的形状。**两份判据共用这一份**：`_COMMAND_IN_PROMPT` 拿它从提示词里刨名字，
#: 判据五拿它审 `NOT_LISTED` 的键。原来这两处各写一份，于是下面这种事能发生——
#: `_COMMAND_IN_PROMPT` 放宽到认 `npc.set_schedule`（它自己的注释点名了这个形状），
#: 而判据五还拿着旧的 `[a-z]+\.[A-Za-z]+`：往 `NOT_LISTED` 登记一个**形状正确**的键，
#: 它报「不是『命名空间.动词』的形状」。那是红得指错地方——该改的是判据五，
#: 不是那个键。实测（2026-10-28）注入 `npc.set_schedule`，判据五当场这么红。
#:
#: 放宽过一回。第一版写 `[a-z]+\.[A-Za-z]+`——只认「小写命名空间.字母动词」。
#: 那个形状**认不出**带数字、下划线或第三段的名字，而且是**安静地认不出**：
#: `villager.carry2` 整条从 `prompt_commands()` 里消失，于是判据一再也看不见它，
#: 判据三的 `expected` 也跟着少数一条——三道判据一起绿，而绿的前提是假的。
#: 今天量出来：`COMMAND_LINES` 里 `command` 字段出现 7 次，旧正则提出 6 个不同的名字
#: （第 7 次是 `villager.carry` 的第二种形状，去重后是 6）。改成现在这个形状之后
#: **今天一个都没多抓**，而 `villager.carry2` / `npc.schedule.set` /
#: `npc.set_schedule` 都认得了。
#:
#: 但放宽正则治的是**今天想得到的形状**。真正靠得住的是下面那条判据零：
#: 它拿一个不设形状的「裸名」正则来对，一旦哪个名字这条正则吃不下，
#: 它会点名说是哪个——而另外两条判据只会红得指错地方（实测见判据零的 docstring）。
_COMMAND_SHAPE = r"[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*"

_COMMAND_IN_PROMPT = re.compile(rf'"command"\s*:\s*"({_COMMAND_SHAPE})"')

#: 不设形状的「裸名」正则：只要是 `command` 字段的字符串值就抓。
#: 它只用来跟 `_COMMAND_IN_PROMPT` 对，不参与任何判据——见判据零。
_COMMAND_NAME_ANY = re.compile(r'"command"\s*:\s*"([^"]+)"')

#: 中文数字。只到十——命令条数不可能超过十，真到了先把这份文件改对。
_CN_NUMERAL = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def prompt_commands() -> set[str]:
    """提示词里点名让模型输出的命令，去重。

    `villager.carry` 在 `COMMAND_LINES` 里出现两次（`carries` 与 `remove`
    两种形状），那是**一条**命令的两种用法，不是两条。去重在这儿做，
    别在调用处做——两处都做就会有一处忘记。
    """
    return set(_COMMAND_IN_PROMPT.findall(COMMAND_LINES))


def test_判据零_命令名正则吃得下提示词点名的每一条() -> None:
    r"""`_COMMAND_IN_PROMPT` 的盲区必须是空的。

    ## 为什么这一条排在最前面

    它护的是**其他判据的前提**。`prompt_commands()` 是一切判据的输入：判据一拿它
    与白名单对，判据二拿它做双向 diff，判据三拿它的个数与散文里的中文数字对。
    要是这个正则悄悄漏掉一个名字，判据一就再也看不见它。

    ## 实测：把 `villager.carry` 换成 `villager.carry2`（2026-10-28）

    把旧正则换回去（`[a-z]+\.[A-Za-z]+`）再跑这个变异，**三条判据的结果与第一版
    docstring 里写的相反**——第一版写「三道判据一起绿，而绿的前提是假的」，
    那句话是假的。实测是：

    - 判据一 **绿**（`villager.carry2` 压根没进 `prompt_commands()`）
    - 判据二 **红**，报「白名单里有这些命令，提示词没列：`['villager.carry']`」
    - 判据三 **红**，报「写着「六条」，而它实际点名 5 条」

    **这个变异只换 `villager.carry` 两处中的一处时，结论会反过来**：三道判据
    **全绿**，只有判据零红（2026-10-28 实测）。所以「盲区造成的不是静默的绿，
    是红得指错了地方」这个一般性结论，在它字面描述的那个变异的一半解读下
    恰好吃秤——那一半是静默的绿。结论（需要判据零）反而被加强，但证据撑不起
    它写下的那句话，所以两种解读都记在这儿。

    所以盲区造成的**不是静默的绿，是红得指错了地方**：报出来的 `villager.carry`
    明明就在提示词里，下一个来修的人会去找一条不存在的缺失；或者更糟——照着
    提示往 `NOT_LISTED` 登记 `villager.carry`，而那条命令说出口说得好好的。
    判据三的红也一样：数字是少了，可少的原因是正则吃不下名字，不是有人改了
    条数忘了改散文。

    这一条补上它俩缺的那半句：**直接点名是哪个名字吃不下**。
    正则本身也一并放宽了（见上面 `_COMMAND_IN_PROMPT` 的注释），今天一个都没多抓。

    ## 键变形它治不了——所以下面还有半条

    上面那两个正则都以 `"command"\s*:\s*"` 开头，所以**只要键改名，两个一起聋**。
    2026-10-28 实测：把某一行的 `"command"` 改成 `"cmd"`（该行命令名在别处还出现），
    **本文件七条测试全绿**——那一行整条从 `prompt_commands()` 里消失，没有任何机关响。
    （第一版在这儿写「六条」，那是判据六补上之前的条数；数变了不是因为测试变松，
    是因为多了一道。）
    `assert any_names` 那道闸只在**所有**行同时变形时才响。

    键变形比值变形常见得多（改个字段名是日常重构），所以下面补半条：
    **`COMMAND_LINES` 里每一条命令形状的行，都必须带 `"command"` 键**。
    判据不是「有多少个 `"command"`」，是「命令形状的行数与带键的行数相等」——
    这样多一行、少一行、改一个键，三种漂都抓得到。

    ## 这一条**不**查什么

    它只问「正则吃下了所有名字」，不问「那些名字该不该在提示词里」——
    那是判据一与判据二的事。也不查 `COMMAND_LINES` 之外的地方：
    `COMMAND_CHECKS` 的键是 Python 标识符，不经过这个正则。
    """
    any_names = set(_COMMAND_NAME_ANY.findall(COMMAND_LINES))
    parsed = prompt_commands()

    assert any_names, (
        '`COMMAND_LINES` 里一个 `"command":"…"` 都找不到——这条判据失去对象。'
        '要么提示词改写得不带 command 字段了，要么 `_COMMAND_NAME_ANY` 失效了。'
        '两种都该回来看，不是把这条改绿。'
    )

    dropped = sorted(any_names - parsed)
    assert dropped == [], (
        f"`COMMAND_LINES` 里这些命令名 `_COMMAND_IN_PROMPT` 吃不下，"
        f"于是判据一一个都看不见它们：{dropped}。"
        "它们会从 `prompt_commands()` 里整条消失。注意另外两条判据还是会红，"
        "但红得指错了地方——判据二会报一条明明在提示词里的命令「没列」，"
        "判据三会报条数少了，而照着那个提示去修就会修错。"
        "改 `_COMMAND_IN_PROMPT` 让它吃下这个形状，别把这条删掉。"
    )

    # 键变形：上面两个正则都以 `"command"` 开头，所以键一改名两个一起聋。
    # 实测（2026-10-28）把某一行的 `"command"` 改成 `"cmd"`，本文件七条全绿——
    # 那一行整条消失，没有任何机关响。所以这儿按**行数**对，不按个数对：
    # 命令形状的行数与带 `"command"` 键的行数必须相等。
    command_lines = [
        line
        for line in COMMAND_LINES.split("\n")
        if line.strip().startswith("- {")
    ]
    keyed = [line for line in command_lines if _COMMAND_NAME_ANY.search(line)]
    assert len(command_lines) == len(keyed), (
        f"`COMMAND_LINES` 里有 {len(command_lines)} 条命令形状的行"
        f"（`- {{…}}` 开头），可只有 {len(keyed)} 条带着 `\"command\"` 键。"
        "键一改名，`prompt_commands()` 就整条看不见那一行——上面所有判据的输入"
        "都从它来，于是那条命令从此没有任何东西对过。"
        "把键改回 `\"command\"`，别把这条删掉。"
    )


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
        "模型永远说不出口它。两种处置：加进 `COMMAND_LINES`，"
        "或往 NOT_LISTED 登记并写清为什么可以不被列。"
        "（别顺带说「`prompt.py` 开头那句六条命令变成假话」——那句话数的是"
        "*列出来的*条数，加一条不列的命令它照旧是真的。第一版就这么写的，是假的。）"
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
    """「N 条」那几句散文必须等于 `COMMAND_LINES` 里实际点名的条数。

    这一类错本仓库犯过六回，但那六回全在 `rules/schema.py` 与
    `test_rules_schema.py`，而且它们数的都是**白名单**的条数。本文件这一条数的是
    **列出来的**条数——两回事：白名单长一条不列的命令，白名单那句该跟着长，
    这一条不该动。所以别把「犯过六回」直接套过来说这个文件也潜伏着同一个谎。

    数字从代码里现算，散文里的中文数字一处一处拿来比。**同一个数量可以被好几处
    散文各自声明，漏掉哪一处，那一处就在没人看的地方烂掉。**

    第一版只锚一种写法，于是漏掉了 `docs/SPEC.md` 第 154 行**当作权威引用**的
    那一处：`prompt.py` 第 27 行「只列世界真能执行的六条」。子 agent 实测：
    把第 27 行改成「只列世界真能执行的七条」，**462 条测试全绿**。也就是说
    SPEC 引来做依据的那句话，当时没有任何机关量它。现在两个锚都查。

    只读 `COMMAND_LINES =` 上面那段 `#:` 注释，**不读整个文件**：
    `COMMAND_LINES` 自己那段提示词正文里有一句「一次最多一条命令」（第 118 行），
    那是说单次响应里能有几条，不是说清单里有几条。第一版正则扫整个文件，
    把它一起抓了，于是这条判据天天红——红成噪声之后就没人看它了。

    两个锚都要求数字后面是「条」，且各自带一段独有的上下文：
    那段注释里还有一句「它是一条合法的世界命令」，指的是 `npc.setSchedule`
    那一条命令的身份，不是条数——写成 `N 条` 就会把它一起抓了（第二版就这么红的）。

    代价说清：只锚今天这两种写法。散文真改成第三种说法，下面那句「找不到」会红，
    那正是要人回来重新指路的意思——**不是**去把第三种说法悄悄加进来而不看它。
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
        if not stripped:
            if not started:
                continue
            break
        if not stripped.startswith("#:"):
            break
        started = True
        above.append(line)
    block = "\n".join(reversed(above))
    assert block.strip(), (
        f"`COMMAND_LINES` 上面找不到 `#:` 注释段了。本文件钉的正是那段话里的条数，"
        "注释没了这条判据就失去对象。如果是刻意删掉，回来把这条与文件头一起改对。"
    )

    # 两个锚：prompt.py 第 25 行与第 27 行。各带一段独有上下文，免得抓到
    # 「它是一条合法的世界命令」那句。
    anchors = (
        ("「N 条命令」", r"([一二两三四五六七八九十])条命令"),
        ("「只列世界真能执行的 N 条」", r"只列世界真能执行的([一二两三四五六七八九十])条"),
    )
    found: list[tuple[str, str]] = []
    for label, pattern in anchors:
        hits = re.findall(pattern, block)
        assert hits, (
            f"`COMMAND_LINES` 上面的注释里找不到{label}这个说法了"
            f"（现在写的是：{block.strip()}）。"
            "说法没了这条判据就失去对象。如果是刻意改成别的说法，回来把 anchors"
            "一起改对，别把这条删掉。"
        )
        found.extend((label, numeral) for numeral in hits)

    for label, numeral in found:
        assert _CN_NUMERAL[numeral] == expected, (
            f"`COMMAND_LINES` 上面的注释里{label}写着「{numeral}条」，"
            f"而它实际点名 {expected} 条（{sorted(prompt_commands())}）。"
            "改条数就得改这句话——这句话是给人核的第一手信息，它假了比没有更糟。"
        )


def test_SPEC_引用的那个条数没有漂() -> None:
    """`docs/SPEC.md` 拿 `prompt.py` 的条数当权威引用——引用本身也会过期。

    ## 为什么单独立这一条

    上面那条盯着 `prompt.py` 自己那两处注释，可**引用它的文档不在它的射程里**。
    `docs/SPEC.md` 第 154 行（2026-10-28 补记那段）写着：

        `oracle/prompt.py` 的文件头也只说「只列世界真能执行的**六条**」。

    那句话在那儿是**论据**：用来证明提示词数的是「列出来的」条数，所以
    `npc.setSchedule` 不在其中并不说明它没实现。论据一假，整段论证就塌。

    而它会**安静地**假：哪天第七条命令被列进提示词，`prompt.py` 的注释会跟着
    改成「七条」，上面那条绿；SPEC.md 这一行的引号里还留着「六条」——没有一道
    机关量它，因为它是文档里的一句引文，不是代码。子 agent 2026-10-28 把这
    条列成 G4，实测确认当时确实没有任何东西对过它。

    ## 判据

    SPEC.md 里那句引文的数字，必须等于 `COMMAND_LINES` **实际点名**的条数
    （与上面那条同一个 `expected`，不另算一遍——两处各算一遍就会有一处忘）。
    「只列世界真能执行的」这个说法在全仓只出现三次：`prompt.py` 一处、
    本文件的注释两处、`docs/SPEC.md` 一处，所以锚得死。

    这一条红了不该把断言改绿：要么 SPEC.md 那段论证要重写（条数变了，论证的
    前提可能也变了），要么引文要跟着更新。**别把 SPEC.md 的数字改成与实际一致
    就完事**——那只是让引文对，没回答「这段论证还成立吗」。

    ## 实测（2026-10-28，三个变异）

    | 变异 | 结果 |
    |---|---|
    | SPEC.md 的「六条」改成「五条」 | 本测试红，判据三**绿**——它独立承重 |
    | SPEC.md 那句改成不带数字的说法 | 本测试红，报「找不到……这个引文了」 |
    | 第七条命令列进提示词、`prompt.py` 自己那两处跟着改成「七条」 | 本测试红（引文还留着六条），判据二、判据三也红 |

    第三行是关键：判据三盯着 `prompt.py` 自己那两处，可它**没有理由**知道
    `docs/SPEC.md` 里还抄了一份。少了这一条，那次改动会一路绿到 SPEC.md 变成
    一句过期引文为止——而它在那儿是论据，不是装饰。
    """
    expected = len(prompt_commands())
    source = SPEC_SRC.read_text(encoding="utf-8")

    # `**六条**` 的星号可有可无：SPEC.md 现在加粗，别的文档未必。
    pattern = re.compile(r"只列世界真能执行的(?:\*\*)?([一二两三四五六七八九十])(?:\*\*)?条")
    hits = pattern.findall(source)
    assert hits, (
        "`docs/SPEC.md` 里找不到「只列世界真能执行的 N 条」这个引文了。"
        "那一行是 2026-10-28 补记论证 `npc.setSchedule` 并非「从未实现」的论据，"
        "它没了这条判据就失去对象。如果是刻意删掉那段补记，回来把这条一起删；"
        "如果只是改了说法，回来把正则改对——别把这条悄悄改绿。"
    )

    for numeral in hits:
        assert _CN_NUMERAL[numeral] == expected, (
            f"`docs/SPEC.md` 引用 `prompt.py` 的条数写着「{numeral}条」，"
            f"而 `COMMAND_LINES` 实际点名 {expected} 条"
            f"（{sorted(prompt_commands())}）。"
            "`prompt.py` 自己那两处注释由上面那条盯着，可这一行是**引文**，不在它的"
            "射程里——它会安静地假下去，而它在那儿是一段论证的论据。"
            "两种处置：引文跟着更新；或者那段论证的前提已经变了，回去重写它。"
            "别只把数字改对了事——那没回答「论证还成立吗」。"
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
    """键得是命令名，理由得非空——形状一乱，上面的差集就会静默漏掉它。

    形状与 `_COMMAND_IN_PROMPT` 共用 `_COMMAND_SHAPE`，不另写一份：
    2026-10-28 之前这儿写的是旧的窄形状 `[a-z]+\\.[A-Za-z]+`，而刨名字那条已经放宽。
    实测往 `NOT_LISTED` 注入 `npc.set_schedule`（放宽后的正则点名认得的形状），
    这一条报「不是『命名空间.动词』的形状」——红得指错地方：键是对的，
    陈旧的是这一条。共用一个常量，那种事再也发生不了。
    """
    for command, why in NOT_LISTED.items():
        assert re.fullmatch(_COMMAND_SHAPE, command), (
            f"NOT_LISTED 的键 {command!r} 不是命令名的形状（{_COMMAND_SHAPE}）"
        )
        assert why.strip(), f"{command} 没写为什么——登记不写理由就成了豁免名单"
