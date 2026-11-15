# ADR_SITE_OUTPUT：作息里的作业真的产出东西（场所产出账）

- status: aligned
- verified_at: 2026-11-10
- verified_by: agent（用户拍板「场所产出账 / 先只累积不消耗」）
- evidence: `world-client/src/world/site-output.ts`, `world-client/src/world/simulation.ts`, `world-client/src/settings/dengchao/pack.ts`, `world-client/test/site-output.test.ts`, `docs/save-v8.sample.json`

## 1. 问题

`activity: 'work' / 'trade'` 只做**门控**（这个场所此刻允不允许这个词），
到点后只挂一句 `routineLabel` 站满 `dwellMs`。炉匠「搬炭」搬不出任何炭，
洗衣妇「收衣裳」收不出任何衣裳，账房「对零钱」不动任何账——世界状态一个字不变。
作息里的「作业」只是牌子上的字。

用户 2026-11-10 要求「先把最基础最需要的真实作业和生活跑起来」，
并拍板落到**场所产出账**、**先只累积不消耗**。

## 2. 决策

- **产出物由设定集按场所 id 声明**（`SettingSite.output`，闭集 `OutputKind`）。
  不按 `kind` 硬编码：两个 `workshop` 产物不同（锅炉房炭、叠浪湖衣裳）。
  省略 = 这个场所不产东西（花径的 rest/stroll 是过日子，不是作业）。
- **记在「走到场所那一刻」**（`finishIdleLeg`），与 `dwellOf` 回查同一拍
  （`routineIndex - 1`）。`finishIdleLeg` 每条腿只调用一次，所以不需要
  「这拍记过没有」的标记，也不会因为 `behavior.plan` 空转而重复记。
- **只记产出的活动**：`work` / `trade` 产出，`rest` / `stroll` 不产。
- **存档 v8**：`world.siteOutput` 是一段 JSON 字符串（场所 id → 累计数），
  空串 = 没有产出。与 `world.memory` 同口径：键是设定集里的事实，
  静态路径集合穷举不了；内部由 `site-output.ts` 解析、只收非负整数项。
- **日报加一行「今日作业」**，`LINE_LIMIT` 3→4：四类世界事实（交付 / 作业 /
  造楼 / 摆件）三条放不下，硬挤会静默丢一类。
- **`site-hours` 的「相位不入档」判据收窄为相位类键**：`world.siteOutput` 是
  累计产出的世界事实，不是从时钟算出来的派生相位，不该被那条守卫误伤。
  同时补一条正向断言，钉住它确实在档里。

## 3. 不在范围

- **不做消耗链**（用户拍板）：炭供炉火、衣裳供来客那条供需留下一轮。
  这里没有消耗速率，也没有缺货后果。
  - **2026-11-10 后续（只追加）**：消耗与对手方分两步补上了。第一步是
    「每个产出场所每世界日自己扣一份」，第二步把它换成**需求方跨场所划账**
    （`SettingSite.consumes`，见 `ADR_SITE_DEMAND`）。本节的「不在范围」
    只描述当时那一版；现在的语义以 `ADR_SITE_DEMAND` 为准。
- 不做熟练度 / 产出速率 / 多趟加成：一趟固定 `OUTPUT_PER_SHIFT = 1`。
- 不改作息节奏（dwell、walkCellMs）与场所开关时段。
- 不改 `ActivityId` 闭集（仍是 trade/work/rest/stroll）。

## 4. 验证

- `test/site-output.test.ts` 4/4：纯函数层（闭集/累加/摘要/空账不说 0 份）；
  真 `Simulation` 从 06:00 跑到 17:00（11 世界小时，5000ms 一拍），
  断言锅炉房炭、叠浪湖衣裳、集市成交都 > 0；花径不产；
  **反例**：不给 `siteOutputs` 时账为空（证明是这条接线在起作用）。
- 全量 2658 通过 0 失败；十一道闸门 11/11。
- 浏览器 `?art=1/0` 装载冒烟无 pageerror。
