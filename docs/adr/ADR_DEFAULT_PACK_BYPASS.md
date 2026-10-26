# ADR：默认设定集绕开配置包编译器，以 authored:false 的 stub 复用 buildLargeWorld

- 状态：已接受
- 日期：2026-10-26
- 关联票据：#13 #9
- 上游：`docs/SPEC.md` §4.8 可扩展性（「换设定集 = 换一份配置包…不改引擎骨架」）、`docs/SPEC.md`（「设定集可换…在第一版只有一套设定集时是纸面的，要有一条测试证明」）

## 背景

SPEC §4.8 要求「换设定集 = 换一份配置包 + 可能改几个常量，不改引擎骨架」。最自然的落地是**所有世界都走配置包编译器**：`RawSettingPack → loadSettingPack（校验）→ buildSettingWorld（编译）`。#13 的验收还有一条硬约束——**默认世界莞尔镇必须逐像素不变**。

矛盾在于：莞尔镇不是「写出来的」，是 `buildWorld` **程序生成**的——地形、常驻铺子按郊野锚点落位、居民作息都在运行时算（`world/setup.ts` 的 `buildLargeWorld → buildWorld`，以及 `WorldGrid.findBestSlot`/`paveFrom`）。把这些塞进一份静态设定集，等于把「要生成的东西」冻成数据；而 `LEGACY_PACK` 的 `terrain/regions/placements/villagers/scenery` 因此全是空的（`settings/index.ts:12-14`）。

空的 `villagers` 过不了编译器的铁律：`loadSettingPack` 要求「居民必须至少一位且不重名」（`settings/load.ts:107`）。所以默认世界**不能**原样走编译器这条路：地形与铺位确是程序生成的，塞不进静态包；居民作息本可入包，却是 #13 里刻意留在代码中的一项（`routines.ts` 尚未搬）。二者叠加，`LEGACY_PACK` 今天就是一份**描述符 stub**，不是一份写定的设定集。

## 决策

默认世界继续走**原封不动的 `buildLargeWorld`**。`LEGACY_PACK` 是一份**描述符 stub**：它按引用复用 `WORLD`/`TERRAIN_COLORS`/`LARGE_WORLD_SPEC`/`LARGE_ALTAR`/`parseBlueprintTable(prefabs)`（`settings/index.ts:9-15`），`authored: false`，**不进 `loadSettingPack`**，直接当 `SettingPack` 供给走 pack 的通用代码（色板、存档槽、蓝图）。

第二座镇子灯潮界是一份**真正写定的** `DENGCHAO_RAW`，走完整编译器（`loadSettingPack → buildSettingWorld`），`authored: true`（`load.ts:113`）。`selectSetting('?world=')` 分流：默认 → stub，`dengchao` → 编译后的包（`settings/index.ts:17-22`）。

## 理由

**默认世界逐像素不变是硬约束，绕开编译器是唯一能证明做到的路。** 默认世界不走新的编译路径，**编译器就结构上碰不到它**。默认世界确实被改走了一条经 pack 读颜色的渲染路径（`tilemap.ts` 的 `palette = theme?.palette ?? WORLD`、`main.ts` 按 `pack.authored` 分支），但它逐像素不变，靠的正是 stub 按引用共享 `WORLD` 这一份真相——`palette-data.ts` 一改两边同时跟着变，没有第二份会漂移。

**编译器是给「写定的世界」用的，默认世界不是。** 它的内容由 `buildWorld` 生成。强行 author 成静态包会把生成物冻死、把包撑爆，还过不了居民铁律。`authored: false` 是诚实的：它明说「这份没经过编译器校验」，而不是用 `authored: true` 撒谎。

**「设定集可换」要的是一份真编译的世界作证，不是一份 stub。** SPEC 自己点破：只有一套设定集时，可换是纸面的，要有一条测试证明。灯潮界是写定的（6 处显式落位、5 个语义区域、2 位带作息的居民、构件），把编译器每条规则都跑到——24 色不重、八种地形各有其色在 `test/setting-palette.test.ts`；6 处落位真的建成、2 位居民真的进入日常、存档槽互不覆盖在 `test/settings.test.ts`。这才是 #13「可换」承诺的实证。

**通用代码不必为默认世界开特例。** stub 仍是 `SettingPack`，供给 palette/saveKey/blueprints，所以渲染、存档隔离、造物意图这些 pack-generic 代码对两座镇子一视同仁。

## 后果

- 好：默认世界逐像素不变（`buildLargeWorld` 一字未动），#13 的硬约束无需一次像素比对就成立。
- 好：编译器在一座真世界上被证明（灯潮界），「可换设定集」从纸面变成实证。
- 好：stub 按引用共享常量（单一真相）；`test/settings-default-pack.test.ts`（提交 aaba2ed）钉住它绕开的那几条数据不变量——palette 同源、八种地形各落 24 色、中心是整数格且在图内。
- 代价：默认包**绕开** `loadSettingPack`，它携带的数据（palette/terrainColors/hub）不受编译器保护——由上面那条专属测试兜底。
- 代价：存在两条建世界路径（`buildLargeWorld` 与 `buildSettingWorld`）。二者在落位上必须行为一致——`buildSettingWorld` 复用 `placeBlueprint`/`grid.place`（`load.ts:122-147`；`checkPlacement` 由 `placeBlueprint` 内部走，调用在 `setup.ts:435`、规则 `setup.ts:188-236`，`load.ts:121` 只写「占地/留白/门口检查」未点名它）。但 `buildSettingWorld` 不跑 `assertWorldInvariants`（`setup.ts:562`，`buildWorld` 会跑），所以「同一套法则」目前只覆盖落位、不含世界预算不变量。**（2026-10-27 更正）** 此处原写「今天无害（灯潮界每个模板 `boundTask` 都为 null）」是错的——`boundTask` 为 null 意味着每种活 0 栋铺子，正触发 `assertWorldInvariants` 的 1–2 栋下限（`setup.ts:568-580`）而抛错（`:603`）；即「跑了就会把灯潮界整体拒掉」，不是无害。详见 `ADR_PACK_SKIPS_WORLD_BUDGET`。
- 将来若要把默认世界也变成写定的包：那是一次刻意的迁移——把世界 author 成数据、改走编译器、退役 stub。在那之前，stub 是对「默认世界是程序生成的」这一事实的诚实表示。

## 备选

| 方案 | 为什么没选 |
| --- | --- |
| 默认世界也走编译器，配一份写定的完整包 | 把程序生成物冻成数据、包爆炸，还过不了居民铁律；更拖累 #13 的逐像素硬约束 |
| 两条路径但把 `WORLD` 拷进包里（不按引用） | 第二份真相会漂移：改 `palette-data.ts` 未必传导到默认包 |
| 默认包标 `authored: true` 但跳过校验 | 不只是不诚实：`authored` 在 `main.ts`/`SandboxScene.ts` 多处是分支开关，翻成 true 会把默认世界导进 `buildSettingWorld`，而它的 terrain/placements/villagers 全是空的——得到的是一张没有建筑的空网格 |
| 只支持一套世界，砍掉配置包系统 | 正是否决 #13/#9「可换设定集」这根支柱 |
