"""取值域跨边界守着：服务端与前端各写一遍的那七套词，从此有人对。

## 为什么要有这个文件

同一个取值域被两边各自写一遍，是本仓最顽固的一种重复。它不报错、不黄字、
不崩——它只是在某一刻让两边说出不一样的话，而那句话要等到线上一条请求被拒
才被人看见。

已经写下来、**但没有一道闸量过**的约定有这些（今天都在，都是真的）：

- `rules/schema.py::CARRY_ITEMS` 的注释：「与 `world-client/src/world/gate.ts` 的
  `CARRY_ITEMS` 必须一致……漂开的表现是『她明明带着灯，那道门就是不认』——
  只有截图才看得见的那种 bug。」
- `rules/schema.py::TIDE_OVERRIDE_MAX_MS` 的注释：「与
  `world-client/src/world/tide.ts` 的 `TIDE_OVERRIDE_MAX_MS` 必须一致。」
- `world-changes.ts` 的 `WORLD_CHANGE_KINDS` 注释：「测试拿它对照 Python 侧的白名单。」
  ——这一条**有**测试（`world-changes.test.ts` 那条读 `WORLD_CHANGE_CHECKS` 的），
  但它只管 `change` **名字**，载荷里每个字段的取值域一个人都没对。

所以本文件补的是后半段：**载荷里的词**。

## 实测：七个域，二十七处声明（2026-10-28）

| 域 | 服务端 | 前端 | 合计 |
|---|---|---|---|
| 天气（意图侧） | `rules/schema.WEATHERS` | `intent-schema.ts` 的 `WEATHERS`、`types.ts` 的 `Weather`、`save.ts` 的 `WEATHER_KINDS` | 5 |
| 天气（事件侧） | `events.world_changes.WEATHERS` | `world-changes.ts` 的 `readonly weather`（引 `Weather`） | 2 |
| 神迹（意图侧，叫 `light`） | `rules.schema.MIRACLES` | `oracle-miracle.ts` 的 `MiracleKind`、`simulation.ts` 的 `MiracleKind`、`intent-schema.ts` 的 `MIRACLES`、`ui/oracle-panel.ts` 两处 | 6 |
| 神迹（事件侧，叫 `lamp`） | `events.world_changes.MIRACLES` | `world-changes.ts` 的 `readonly miracle` | 2 |
| 活计（两侧同一个域） | `oracle.wire.TASK_KINDS`、`events.world_changes.TASK_KINDS` | `types.ts` 的 `TaskKind`、`ui/*` 与 `SandboxScene.ts` 五处 | 8 |
| 交付来源 | `events.world_changes.SOURCES` | `world-changes.ts` 的 `readonly source` | 2 |
| 通行凭证 | `rules.schema.CARRY_ITEMS` | `gate.ts` 的 `CARRY_ITEMS` | 2 |

（潮位上限那个数单独算，两处。）

（**2026-10-28 补记：上一版这张表自己就对不上，而要紧的不在数上。** 三行漏了
提示词：`intent-prompt.ts` 里 `"weather":"clear"|"rain"|"storm"`、
`"miracle":"light"|"tree"|"cat"` 各一份，`carries` 与 `remove` 那两行里
`["lamp"|"shoes"]` 各一份——按表里的口径，「天气（意图侧）」该是 5（原来就写着 5，
可格子里只列得出 4 个名字），「神迹（意图侧）」该是 7，「通行凭证」该是 4
（原来写 2）。**同一张表两行口径不一致**，而真正的错是：提示词那份副本
**一道闸都没有**——本文件原来读的八个前端文件里没有 `intent-prompt.ts`。
提示词是模型唯一读到的东西；服务端加了第四档天气而它不跟着改，模型就只知道
三档，而提示词自己教它「表里没有的现象往邻居身上靠」，于是新档被悄悄翻成旧档，
用户以为他要的办成了。现已补上三行 `_GUARDED`，那四处副本归它们管。）

（同一天补第二记：**「二十七处」这个总数从这张表里复现不出来**，别拿去引用。
「活计」那行的「`ui/*` 与 `SandboxScene.ts` 五处」数的不是字面量副本——
`'code'|'research'|'writing'|'quick'` 照字面抄出来的只有两处
（`debug-panel.ts` 与 `oracle-panel.ts` 各一处），`SandboxScene.ts` 那处是
**用**不是抄。其余 `TaskKind` 出现都是引用类型或 `Record<TaskKind, …>` 的键，
由 TS 管。所以那 8 是怎么凑出来的，写表的人没留口径，今天谁也复现不了。
承重的是下面 `_GUARDED` 与逐条判据——它们比对的是真读出来的集合，
不是这张表里的数字。）

这二十七处**今天全都一致**——所以本文件不是「抓到了一个漂移」，是「漂移从今天
起会红」。写它的理由与 `test_prompt_whitelist_agreement.py` 同一条：约定写在注释里，
而注释不会响。

## 神迹为什么是两套词，而本文件不把它们直接比

意图侧叫 `light`（点灯），事件侧叫 `lamp`——摆件就叫 `lamp`，日志用摆件的名字。
翻译发生在客户端 `simulation.ts`，`light` → `lamp`、`tree` → `tree`、`cat` → `cat`。
`world-changes.ts` 那一行上有注释说明这件事，服务端原来**一个字都没写**，
所以 `events/world_changes.py` 的 `MIRACLES` 上面补了一段。

两套词就不能直接比。本文件的做法是：各自与客户端对应的那一处比，再各数一遍个数。
个数相等而词不同，是今天这个翻译；个数不等，说明有一边加了一种神迹而另一边没有。

## 这一条**不**查什么

- **UI 层那五处 `TaskKind` 副本**（`SandboxScene.ts`、`oracle-panel.ts`、
  `debug-panel.ts`）不查。它们是回调签名里的结构性副本：`TaskKind` 多一个成员，
  那些签名收得下；少一个成员，TS 在调用点就黄。它们的漂移由类型系统管，
  不由这个文件管——写进来只会让这个文件天天红，红了就没人看了。
- **`rules.schema.SCHEDULES`**（作息名）服务端独有，客户端还没有
  `npc.setSchedule` 这个意图（`test_prompt_whitelist_agreement.py` 的
  `NOT_LISTED` 盯着这件事），没有对面对。
- **`MAX_BUILDINGS`** 同理，服务端独有。
- **`change` 名字的白名单**已经被 `world-changes.test.ts` 从客户端那一侧守着，
  不重复守。
- **`intent-prompt.ts` 里 `dispatch` 的 `"taskKind":"<类>"`** 不查——那是个
  占位符，不是字面量清单；真正列给模型的活计名是 `TASK_HINTS` 的键，
  而那个 `Record<TaskKind, …>` 由 TS 管，加一种活计不改它编译不过。
  天气、神迹、通行凭证在提示词里是**照字面抄**的，那三样已由上面三行管着。

## 读法：抓不到就红，不跳过

每个取值域都从源码里正则刨。**刨不到必须红**——下面 `test_取值域一个都没刨空`
是为此写的：一个正则悄悄失效，剩下所有比较就变成 `set() == set()`，
一整套绿，而绿的前提是假的。这正是 `_COMMAND_IN_PROMPT` 那个盲区的形状。

两道闸分工不同，别指望其中一道替另一道：

- **一次都没命中 / 命中两次**：`_one` 在**模块导入时**就断言。所以它红了
  长得像一个 collection error，不是一条测试失败——整份文件都跑不了。
  这是故意的：锚点没了，这份文件里每一条判据的对象都没了，
  没有一条还能单独给出有意义的话。
- **命中了但一个词都没刨出来**：`test_取值域一个都没刨空` 在跑的时候断言。
  这一道防的是另一种失效——正则放宽到把字面量也一起吃掉，
  `_quoted` 于是返回空集合，而 `set() == set()` 成立。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from events.world_changes import (
    MIRACLES as EVENT_MIRACLES,
)
from events.world_changes import (
    SOURCES,
    TASK_KINDS as EVENT_TASK_KINDS,
    WEATHERS as EVENT_WEATHERS,
)
from oracle.wire import TASK_KINDS as INTENT_TASK_KINDS
from rules.schema import (
    CARRY_ITEMS,
    MIRACLES as INTENT_MIRACLES,
    TIDE_OVERRIDE_MAX_MS,
    WEATHERS as INTENT_WEATHERS,
)

#: 仓库根：`server/tests/<本文件>` 往上三级。
ROOT = Path(__file__).resolve().parents[2]

#: 前端源码。
CLIENT_SRC = ROOT / "world-client" / "src"

_INTENT_SCHEMA = CLIENT_SRC / "world" / "intent-schema.ts"
_TYPES = CLIENT_SRC / "world" / "types.ts"
_SAVE = CLIENT_SRC / "world" / "save.ts"
_ORACLE_MIRACLE = CLIENT_SRC / "world" / "oracle-miracle.ts"
_SIMULATION = CLIENT_SRC / "world" / "simulation.ts"
_WORLD_CHANGES = CLIENT_SRC / "world" / "world-changes.ts"
_GATE = CLIENT_SRC / "world" / "gate.ts"
_TIDE = CLIENT_SRC / "world" / "tide.ts"
_PROMPT = CLIENT_SRC / "world" / "intent-prompt.ts"


def _read(path: Path) -> str:
    if not path.is_file():
        pytest.fail(
            f"找不到 {path.relative_to(ROOT)}。本文件的每一条判据都要读前端源码，"
            "看不到源码它就无法判——而跳过它等于这道闸安静地不再把关。"
            "如果是在一个只有 server/ 的部分检出里跑，那是环境问题，不是代码问题；"
            "完整检出（CI 的样子）里这些必须能跑。"
        )
    return path.read_text(encoding="utf-8")


def _quoted(literal: str) -> set[str]:
    """从一个 TS 字面量里刨出所有单引号字符串。空集合是**没刨到**，不是空域。"""
    return set(re.findall(r"'([^']*)'", literal))


def _one(source: str, pattern: str, what: str) -> str:
    """全文里必须**恰好一次**命中 `pattern`，返回那一组。

    一次都不中：锚点没了，判据失去对象。命中两次：锚点已经被它自己的存在
    变成不唯一的了——本仓踩过这一脚（往 SPEC.md 里写一个 grep 锚点，
    写下去之后那个锚点从两处变三处）。两种都是红的理由，不猜。
    """
    hits = list(re.finditer(pattern, source, re.MULTILINE))
    assert len(hits) == 1, (
        f"{what}：正则 {pattern!r} 在它该出现的文件里命中 {len(hits)} 次，"
        f"预期恰好 1 次。0 次说明锚点被改名或删了；2 次以上说明它不再唯一，"
        "照它去 grep 会指错地方。回来把锚点改对，别把这条删掉。"
    )
    return hits[0].group(1)


def type_union(path: Path, name: str) -> set[str]:
    """`export type X = 'a' | 'b';` 的取值域。"""
    body = _one(_read(path), rf"^export type {re.escape(name)} = ([^;]+);", f"{path.name} 的 {name}")
    return _quoted(body)


def const_list(path: Path, name: str) -> set[str]:
    """`export const X: readonly T[] = ['a', 'b'];` 的取值域。"""
    body = _one(
        _read(path),
        rf"^(?:export )?const {re.escape(name)}[^=\n]*=\s*\[([^\]]*)\]",
        f"{path.name} 的 {name}",
    )
    return _quoted(body)


def field_type(path: Path, field: str) -> str:
    """`readonly X: <类型>;` 里那个类型的原文。

    允许行首空白：`world-changes.ts` 的联合类型成员是缩进的，
    写成 `^readonly` 一个都匹配不上——第一次跑就是这个红的，正是想要的效果。
    """
    return _one(_read(path), rf"^[ \t]*readonly {re.escape(field)}:\s*([^;]+);", f"{path.name} 的 {field}")


def const_number(path: Path, name: str) -> int:
    """`export const X = 2 * 60_000;` 的值。只放行整数常量四则运算。"""
    body = _one(_read(path), rf"^export const {re.escape(name)}\s*=\s*([^;]+);", f"{path.name} 的 {name}")
    return _arith(body.strip(), f"{path.name} 的 {name}")


def prompt_field(field: str) -> set[str]:
    """`intent-prompt.ts` 命令示例里某个字段的内联取值域（抄了几处都得一样）。

    提示词是给模型看的纯字符串，**引用不了 TS 的联合类型**，只能把
    `"clear"|"rain"|"storm"` 照字面写进去。于是同一套词在提示词里又有了副本，
    而**模型读到的就是这一份**——`types.ts` 那边加了第四档天气而这份不跟着改，
    模型就只知道三档。更坏的是提示词自己教它「表里没有的现象往邻居身上靠」，
    于是新档被悄悄翻成旧档，用户以为他要的办成了。

    所以这几处不是「顺手也看一眼」，是本文件最该守的地方之一。
    抄几处必须全都一样：这里返回共同的那个集合，不一致就红——那说明
    有人只改了一处，而模型在不同命令里会看到两套词。
    """
    source = _read(_PROMPT)
    # 两种形状都收：`"weather":"clear"|"rain"` 与 `"carries":["lamp"|"shoes"]`。
    # 词与词之间是 `"|"`——**引号竖线引号**，不是 `_quoted` 那种单引号。
    pattern = rf'"{re.escape(field)}"\s*:\s*\[?"((?:[a-z]+"\|")*[a-z]+)"'
    found = [set(m.group(1).split('"|"')) for m in re.finditer(pattern, source)]
    assert found, (
        f"提示词里找不到 \"{field}\" 的内联取值域（正则 {pattern!r}）。"
        "要么它改成引用 TS 类型了（那这一条该删），要么它被删了——"
        "删了就是模型再也看不到这套词，回来把这一条连同 _GUARDED 一起改对。"
    )
    first, *rest = found
    for other in rest:
        assert first == other, (
            f"提示词里 \"{field}\" 抄了好几处却不一致：{sorted(first)} 对 {sorted(other)}。"
            "模型在不同命令里会看到两套词，而它只会挑一套用。"
        )
    return first


def _arith(text: str, what: str) -> int:
    """算一个 `2 * 60_000` 这样的常量表达式。

    不用 `eval`：这一行读的是别人仓库里的源码，而 `eval` 会把「读文件」
    变成「执行文件」。白名单只放整数与 `+ - * //`。
    """
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as exc:  # pragma: no cover - 形状变了就会走到
        raise AssertionError(f"{what} 不是一句能算的表达式：{text!r}") from exc
    return _fold(tree.body, what)


def _fold(node: ast.AST, what: str) -> int:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, int):
            raise AssertionError(f"{what} 里有不是整数的东西：{ast.dump(node)}")
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.FloorDiv)):
        left, right = _fold(node.left, what), _fold(node.right, what)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if right == 0:
            raise AssertionError(f"{what} 里除了零")
        return left // right
    raise AssertionError(f"{what} 里有不许有的东西：{ast.dump(node)}")


# ------------------------------------------------------- 判据零：闸自己的前提

#: 每一个被守的取值域，服务端那一份 + 客户端那一份（或几份）。
#: 单独列出来，是为了让「一个都没刨空」这条判据有对象——它不是断言某个具体值，
#: 是断言**每一处都真的刨到了东西**。
_GUARDED: dict[str, tuple[set[str], ...]] = {
    "天气（意图）": (set(INTENT_WEATHERS), const_list(_INTENT_SCHEMA, "WEATHERS"), type_union(_TYPES, "Weather")),
    "天气（事件）": (set(EVENT_WEATHERS), type_union(_TYPES, "Weather")),
    "天气（存档）": (type_union(_TYPES, "Weather"), const_list(_SAVE, "WEATHER_KINDS")),
    "神迹（意图）": (
        set(INTENT_MIRACLES),
        type_union(_ORACLE_MIRACLE, "MiracleKind"),
        type_union(_SIMULATION, "MiracleKind"),
        const_list(_INTENT_SCHEMA, "MIRACLES"),
    ),
    "神迹（事件）": (set(EVENT_MIRACLES), _quoted(field_type(_WORLD_CHANGES, "miracle"))),
    "活计（意图）": (set(INTENT_TASK_KINDS), type_union(_TYPES, "TaskKind")),
    "活计（事件）": (set(EVENT_TASK_KINDS), type_union(_TYPES, "TaskKind")),
    "交付来源": (set(SOURCES), _quoted(field_type(_WORLD_CHANGES, "source"))),
    "通行凭证": (set(CARRY_ITEMS), const_list(_GATE, "CARRY_ITEMS")),
    # 提示词里那几份：引用不了 TS 类型，只能照字面抄，而模型读的就是它。
    "天气（提示词）": (set(INTENT_WEATHERS), prompt_field("weather")),
    "神迹（提示词）": (set(INTENT_MIRACLES), prompt_field("miracle")),
    "通行凭证（提示词）": (set(CARRY_ITEMS), prompt_field("carries"), prompt_field("remove")),
}


#: 潮位上限，客户端那一份。与上面 `_GUARDED` 一样在**导入时**就读出来，
#: 为的是让「锚点没了」在任何一条判据上都长成同一个样子（collection error），
#: 而不是有的红成测试失败、有的红成收集错误——下一个人要先分清那是哪一类。
_CLIENT_TIDE_MAX = const_number(_TIDE, "TIDE_OVERRIDE_MAX_MS")


def test_取值域一个都没刨空() -> None:
    """每一个域的两边都必须真的刨到了词。

    这一条护的是**其他所有判据的前提**。上面 `_GUARDED` 里每一组都是
    「服务端那份 == 客户端那份」。要是某个正则悄悄失效，两边一起变成空集合，
    `set() == set()` 成立，一整套绿——而绿的前提是假的。这正是
    `test_prompt_whitelist_agreement.py` 判据零治的那个病：正则的盲区造成的
    不是静默的绿，是**绿得没有意义**。

    它也不问「那些词该不该在域里」——那是下面每一条比相等的事。
    """
    assert _GUARDED, "登记表空了——本文件的所有判据都从它身上取对象"
    for label, sides in _GUARDED.items():
        for index, side in enumerate(sides):
            assert side, (
                f"「{label}」的第 {index + 1} 份声明刨出来是空的。"
                "空集合与任何空集合相等，所以这条判据会假绿。"
                "要么那个文件里的声明被删了/改名了，要么刨它的正则失效了——"
                "两种都该回来看，不是把这条改绿。"
            )


# ------------------------------------------------------- 逐个域对

def test_两边各写一遍的取值域必须相等() -> None:
    """`_GUARDED` 里每一处，一处一处比。漂哪一处，红的信息里就点名哪一处。

    （这里原来写「七个域」。`_GUARDED` 是按「哪几份声明要比」登记的，
    不是按域——天气就分了意图 / 事件 / 存档 / 提示词四条。所以不写个数，
    写个数那天它就开始漂。真想知道今天有几处，数 `_GUARDED` 去。）
    """
    for label, sides in _GUARDED.items():
        first, *rest = sides
        for other in rest:
            assert first == other, (
                f"「{label}」两边不一样：{sorted(first)} 对 {sorted(other)}。"
                "同一个取值域两边各写一遍，漂开不会报错、不会黄字，"
                "只会在某一刻让两边对同一句话说出不一样的回答。"
                "改一边就得改另一边——这一条就是逼着你改的。"
            )


def test_神迹两套词的个数必须一样多() -> None:
    """意图侧 `light` 与事件侧 `lamp` 是两套词，个数必须对齐。

    词不同是**故意的**（`world-changes.ts` 那行注释说明翻译发生在
    `simulation.ts`），所以不直接比集合。但个数不等就是说不过去：
    一边加了一种神迹而另一边没有，那一头说得出口、这一头记不下来。
    """
    assert len(INTENT_MIRACLES) == len(EVENT_MIRACLES), (
        f"意图侧有 {len(INTENT_MIRACLES)} 种神迹（{sorted(INTENT_MIRACLES)}），"
        f"事件侧有 {len(EVENT_MIRACLES)} 种（{sorted(EVENT_MIRACLES)}）。"
        "翻译是逐词对应的，多出来的一侧没有对手。"
        "`simulation.ts` 里那个 `kind === 'light' ? 'lamp' : 'tree'` 就是翻译表，"
        "加一种神迹要同时改那边、这边、以及 `rules.schema.MIRACLES`。"
    )


def test_潮位上限两边是同一个数() -> None:
    """`TIDE_OVERRIDE_MAX_MS` 两处各写一遍，而注释里写着「必须一致」。

    已有的 `test_intent_api.py::test_拨潮超上限被拒_而且拒绝的话就是上限那个数`
    只守了服务端**自己**：它断言服务端的错误信息里出现 `120000`。
    服务端把上限从两分钟放宽到三分钟，那条测试会红——但客户端还停在两分钟，
    于是模型说三分钟、客户端拒了、服务端本来收得下。用户看到「没听懂」，
    而世界其实准备好了。**那一半今天没有人守。**

    数字从两边现读，不手写：手写的那一秒它就开始漂。
    """
    client = _CLIENT_TIDE_MAX
    assert client == TIDE_OVERRIDE_MAX_MS, (
        f"潮位上限两边不一样：服务端 {TIDE_OVERRIDE_MAX_MS}，"
        f"客户端 `tide.ts` {client}。放宽服务端而不放宽客户端，"
        "表现是模型给了一个服务端收得下的时长、被客户端拒在门外，"
        "用户看到「没听懂」——而世界那边一切就绪。"
    )


def test_事件里那两个字段引的是别名_不是在旁边抄了一份() -> None:
    """`world-changes.ts` 的 `weather` 与 `taskKind` 必须**引用** `types.ts`。

    它们是 `readonly weather: Weather` 而不是 `readonly weather: 'clear' | ...`。
    哪天有人图省事在旁边抄一行字面量，上面那条「天气（事件）」比的就还是
    `types.ts` 的 `Weather`——于是新抄的那份漂了也没人红。
    这一条钉住「没抄」这个前提，抄了就点名说抄在哪儿。
    """
    for field, alias in (("weather", "Weather"), ("taskKind", "TaskKind")):
        actual = field_type(_WORLD_CHANGES, field)
        assert actual == alias, (
            f"`world-changes.ts` 的 `readonly {field}` 现在写的是 {actual!r}，"
            f"不是别名 {alias!r}。它旁边多了一份取值域，"
            "而本文件比的是 `types.ts` 那一份——新抄的这份漂了不会响。"
            "改回引用别名，或者把这一条连同上面那条一起改对。"
        )


def test_活计两侧的服务端声明也是同一个域() -> None:
    """意图侧与事件侧的 `taskKind` 是同一个域，服务端自己就写了两遍。

    `oracle/wire.py` 的 `TASK_KINDS`（模型说「派一单研究」那一侧）与
    `events/world_changes.py` 的 `TASK_KINDS`（世界记下「研究做完了」那一侧）。
    两边不等的话：模型派得出一单客户端与世界都认不出的活，世界做完了，
    回写时被自己的服务端拒掉，那一单于是**做完了却什么也没留下**。
    """
    assert set(INTENT_TASK_KINDS) == set(EVENT_TASK_KINDS), (
        f"服务端两处 taskKind 不一样：`wire.py` {sorted(INTENT_TASK_KINDS)}，"
        f"`world_changes.py` {sorted(EVENT_TASK_KINDS)}。"
        "同一单活在进来的那一侧与记下来的那一侧是同一个域。"
    )
