"""意图提示词的服务端版本。

与 `world-client/src/world/intent-prompt.ts` 是**同一份协议的两端**：
那边规定了前端发什么，这边规定了模型看到什么。两者必须说同一套命令名。

为什么服务端要自己造提示词，而不是让前端发过来：
提示词是**服务端的能力声明**。#6 之后世界执行的是服务端校验过的命令，
让前端决定告诉模型什么，等于让前端决定白名单长什么样。前端只发
`templates`（世界能建什么）与 `context`（世界现在什么样）这两份数据。

模板表仍然由前端发——那是世界的内容，不是服务端的常量。
"""

from __future__ import annotations

from typing import Any

#: 五条命令，逐条写清能带什么。模型抄错一个字段名就被校验器拒。
#:
#: 只列世界真能执行的五条。`npc.setSchedule` 还在规则层白名单里（它是一条
#: 合法的世界命令），但客户端与世界都还没有对应的意图，写进提示词就是让模型
#: 去说一件世界办不到的事——用户会看到「听懂了」然后什么也没发生。
COMMAND_LINES = """- {"command":"weather.set","args":{"value":"clear"|"rain"|"storm"}} 改天气；storm 是暴雨，比 rain 重
- {"command":"tide.setLevel","args":{"value":0..1,"durationMs":毫秒}} 把潮位拨住一会儿；到期自己回到潮汐节律。
  durationMs 可省略（省略时取上限 120000）；不能超过 120000，也不能是 0 或负数
- {"command":"building.add","args":{"prefabId":"<模板>","at":{"x":整数,"y":整数}}} 落一栋楼。**at 可省略**：用户没说地点时就别填，世界自己挑空地方；用户说了坐标（「在 40,45」「靠河边」）才填
- {"command":"building.remove","args":{"instanceId":"<实例 id>"}} 拆一栋楼；instanceId 必须原样抄世界现状里的那个，不要自己拼
- {"command":"miracle.spawn","args":{"kind":"light"|"tree"|"cat"}} 点灯 / 种树 / 召唤猫；可带 "at\""""


def build_system_prompt(templates: list[dict[str, Any]], context: dict[str, Any] | None = None) -> str:
    """造系统提示词。`templates` 是前端发来的模板表，`context` 是世界现状。"""
    template_lines = "\n".join(
        f'  - {item["id"]}（{item.get("displayName", item["id"])}，'
        f'{("接" + item["boundTask"] + "活") if item.get("boundTask") else "不接活"}）'
        for item in templates
    )

    context_section = ""
    if context:
        context_section = f"""
## 世界现在长什么样

{render_context(context)}

## 看到现状之后怎么判断

**现状不改变你输出的命令。** 它是背景，不是判据。

- 已经有了某栋楼，仍然照常输出 building.add。世界会拒绝并说明已经有了。
  你替世界提前判 unknown，用户会以为你没听懂。
- **要拆楼就抄现状里的 instanceId。** 「已经建了」那行给了每一栋的 instanceId，
  原样抄；不要在模板名后面自己拼一个 `#1`——那可能指着另一栋，世界会照你说的拆。
  上下文里没有的楼，答 unknown 并说明你没找到。
- 只有用户在**问现状**时才答 unknown。「镇上现在有几栋楼」是在打听，不是在要求改。

判断口诀：看用户**要你做什么**，不看世界**现在是什么样**。
"""

    return f"""你是像素世界里那个世界的**意图解析器**。用户对世界说一句话，你把它翻成命令。

## 你能表达的命令

只输出下面五种之一，别的都不存在。命令名与字段名都写死在 schema 里，
多一个字段、少一个字段、拼错一个字母，都会被拒：

{COMMAND_LINES}

## 能建的模板（只有这些，不能发明）

{template_lines}
{context_section}
## 四条纪律

1. **听不出就答 unknown。** 闲聊、提问、感叹、抱怨——一律 unknown，
   并在 reason 里说清是什么。世界宁可不动，也不替用户做他没说的事。
2. **只输出 JSON。** 不要解释、不要 Markdown 代码块、不要前后缀。
3. **不要编造字段。** 每种命令能带的字段是固定的。
4. **越界就照实输出，不要自己改数。** 用户说「把潮位调到 5」，你就输出 5，
   让世界拒绝并告诉他为什么。**你不替他改主意**——把 5 悄悄改成 1，用户会以为
   他要的办成了。

## 输出的 JSON 形状

```json
{{"commands": [{{"command": "weather.set", "args": {{"value": "rain"}}}}],
 "narrative": "一句话说说你听懂了什么，给用户看"}}
```

`commands` 可以为空（当 user 不是命令时），此时 `narrative` 要说清为什么不动。
一次最多一条命令。想改多件事就请用户分开说，不要批量输出。
"""


def render_context(context: dict[str, Any]) -> str:
    """把世界现状写成几句人话。字段缺了就不说，不写「未知」——
    一句「未知」会让模型以为它该去猜。"""
    lines: list[str] = []

    built = context.get("built") or {}
    buildings = [entry for group in ("town", "wild") for entry in built.get(group, [])]
    if buildings:
        lines.append(
            "已经建了："
            + "、".join(f"{entry['name']}（instanceId={entry['instanceId']}）" for entry in buildings)
            + "。"
        )

    busy = context.get("busy") or []
    if busy:
        lines.append(
            "正在干活："
            + "、".join(f"{item['name']}（{item['taskKind']}）" for item in busy)
            + "。"
        )
    else:
        lines.append("现在没人干活。")

    if context.get("queued"):
        lines.append(f"还有 {context['queued']} 条神谕在排队。")

    weather = context.get("weather")
    if weather == "clear":
        lines.append("天晴。")
    elif weather == "storm":
        lines.append("外面在刮暴雨。")
    elif weather == "rain":
        lines.append("外面在下雨。")

    return "\n".join(lines)


def build_messages(
    templates: list[dict[str, Any]],
    utterance: str,
    context: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """一段话的请求体。温度给 0：意图解析要的是稳定，不是文采。"""
    return [
        {"role": "system", "content": build_system_prompt(templates, context)},
        {"role": "user", "content": utterance},
    ]
