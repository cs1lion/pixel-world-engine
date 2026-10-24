# pixel-world-engine

一个可换设定集的像素世界引擎。世界自己跑起来，LLM 按世界法则输出结构化命令去改变它。

## 这个仓库要做什么

- **世界优先**：真实运行的像素世界是主体，Agent 干活只是世界的一种输入。
- **引擎而非一款游戏**：换一套设定集就能长出另一个世界。视觉与数值数据走配置文件，潮汐与灯油的逻辑留在代码里。
- **规则约束下的生成**：LLM 只能输出白名单内的结构化命令，Schema 过不了就拒收并说明原因。
- **记忆是时间线**：按日期 + 人物经历 + 世界事件存成 Markdown，量大之后再谈检索。

## 目录

```text
world-client/   Phaser 前端（复用 pixel-world 的渲染与模拟内核）
server/         FastAPI：规则校验、事件日志、LLM 造物主
memory/         时间线记忆（Markdown + YAML）
docs/           设计与决策
```

## 与旧仓的关系

渲染与模拟内核来自 `cs1lion/xiaoxi` 的 `pixel-world/`。旧仓保留为参考，不再演进。
两边的差异与迁移记录见 `docs/MIGRATION_FROM_XIAOXI.md`。

## 状态

骨架阶段。规范见 `docs/`，票据见本仓 issues。
