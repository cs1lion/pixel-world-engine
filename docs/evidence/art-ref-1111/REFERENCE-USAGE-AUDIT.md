# 十张 11-11 参考图：真实用途审计（2026-11-12）

> 用户质疑「我昨天买的十张参考图哪个真用了哪个没用上」。这份表按**四层证据**
> 逐张追，不把「文档里写了」当成「用上了」。本次只审计，未改任何产品代码。

## 判定口径

| 层 | 判据 |
|---|---|
| L1 被脚本读取 | 原图（或压到长边 768 的副本）真的被 `server/scripts/` 下的脚本打开 |
| L2 有产物 | 产出进了 `world-client/public/assets/manifest.json` |
| L3 有消费方 | `world-client/src/` 里有代码能把该 id 拼成 `src` 或纹理 key |
| L4 真的可见 | 真实开局 + 常规交互下，元素可见（未被 `hidden` / `display:none` 挡住） |

**关键区分**：作为生图锚点传给 Agnes 的是 768 长边 JPEG 副本，模型输出的图是
**重新画的**，参考图本身没有一像素进引擎；「切成 PNG 进清单」也不等于上屏。
`preloadArt` 会按清单把每件都装进 Phaser 纹理缓存，所以死素材照样占首屏请求。

## 逐张结论

| # | 参考图 | L1 | L2 产物 | L3 消费方 | L4 实测可见 | 判定 |
|---|---|---|---|---|---|---|
| 1 | `sacred-oracle-altar-states.png` | 切图源 | 3 张 `state/altar-*` | `altarStateId` 三态全覆盖 | `altar-00` / `altar-02` 可见，`altar-01` 在成功回执时出现 | ✅ 完整用上 |
| 2 | `steampunk-coding-workshop-states.png` | 切图源 | 4 张 `state/workshop-*` | `activityDecorId` 四态全覆盖 | `workshop-00` 可见（其余依楼的 activity 切换） | ✅ 完整用上 |
| 3 | `villager-sprite-sheet.png` | 生图锚点 + 切图源 | 7 张 `villager/v*` + `plate/cast-00` | 立绘按 `villager.id` 全命中；`cast-00` 只在 `plateIdFor(12)` | 7 张立绘全上屏；`cast-00` 开局不可见 | 🟡 锚点那一路真用了，贴片没上屏 |
| 4 | `agent-role-icon-sheet.png` | 生图锚点 + 切图源 | 10 张 `icon/role-*` | `villagerBadgeId` 只返回 `role-00..04`（序号模 5）；`role-05..09` **零消费方** | `role-03` 可见 | 🟡 一半是死素材 |
| 5 | `pixel-world-map-16x9.png` | 生图锚点 + 切图源 | 4 张 `plate/map-*` | 唯一调用是日历周视图 `plateIdFor(weekIndex)` | 开局 `dayCards=0` → 0 张可见 | 🟠 只作锚点，贴片没上屏 |
| 6 | `pixel-ui-emote-vfx-sprite-sheet.png` | 切图源 | 12 张 `emote/*` | 11 张有入口；`emote-09` 被 `EMOTE_IDS` 明确排除 → 死 | 实测只有 `emote-00` 可见 | 🟡 1 张死、其余要特定语义才出现 |
| 7 | `pixel-village-asset-sheet.png` | 生图锚点（建筑重画）+ 切图源 | 4 张 `plate/village-*` | 同日历周视图 | 0 张可见 | 🟠 锚点真用了，贴片没上屏 |
| 8 | `scholarly-zone-buildings.png` | 生图锚点 + 切图源 | 1 张 `plate/scholarly-00` | 同上 | 0 张可见 | 🟠 同上 |
| 9 | `pixel-tileset-props-sheet.png` | 生图锚点 + 切图源 | 1 张 `plate/tileset-00` | 同上 | 0 张可见 | 🟠 同上 |
| 10 | `pixel-world-engine-desktop-ui-mockup.jpg` | 切图源 | 2 张 `plate/ui-*` | 同上 | 0 张可见 | ❌ 几乎没用上 |

**汇总**：完整用上 2 张、部分用 3 张、只作生图锚点 / 贴片不上屏 4 张、基本没用上 1 张。

第 10 张要单独说：第四轮的主界面 CSS 是**照着气质手写**的，没有从这张图取任何
像素、颜色值或布局数值（`audit-palette` 甚至要求只能用现有 9 个色值）。所以它对
引擎的实际贡献只有 2 张在真实开局里看不到的贴片。把它写成「设计稿落地」是夸大。

## 死素材清单（进了清单、首屏被装、但没有真实消费）

用纯函数枚举可达 id 的实测读数：

```
ICON reachable  5  ["role-00".."role-04"]          清单 10 张
EMOTE reachable 11 ["emote-00".."emote-08","emote-10","emote-11"]   清单 12 张
ALTAR reachable  3  全
WORKSHOP reachable 4 全
PLATE 全部可达 13，但近 30 天最多 5 周 -> 只有 5 张轮得到；开局 dayCards=0 -> 0 张
```

- **确定零消费方 14 件**：`icon/role-05..09`（5）、`emote/emote-09`（1）、
  `plate` 里近 30 天永远轮不到的 8 张（`village-01..03`、`ui-00/01`、
  `scholarly-00`、`tileset-00`、`cast-00`）。占清单 66 件的 21%。
- 另有 5 张 `plate/map-*` 与 `village-00` 只有在世界跑过日界关账、
  `dayCards()` 非空之后才可能出现。
- 浏览器实测：开局 `preloadArt` 请求 71 个 PNG（66 件清单 + DOM 装饰重复请求），
  而**可见的装饰图只有 5 个文件**：`altar-00`、`altar-02`、`emote-00`、
  `role-03`、`workshop-00`。
- `building/waiting_shelter` 开局没有实例，但 `oracle-build.ts` 有「候车亭」
  建造映射，玩家说出来时会用上，不算死素材。`scenery/*` 7 件都有
  `addSceneryImage` 消费点。

## 此前文档 / 回答里的不实之处

1. ADR 与根 README 写「十张图至此都有消费方（生图锚点 / 切片 / 贴片）」——
   把「传给模型当风格参考」和「切出 PNG 进清单」都算成用上，但两者都不等于
   产物可见。按 L4 口径，完整用上的只有 2 张。
2. 两版录屏里日历抽屉的贴片与表情是**注入示例日卡**拍出来的。证据 README 的
   录屏章节注明了这个口径，但在对话里把录屏当「接线成果」展示时没有强调：
   真实开局 `dayCards()` 返回空，日历是空的，贴片 0 张可见。
3. 「桌面 UI 设计稿落地视觉层」——CSS 与图之间没有像素 / 色值 / 布局数值的
   对应关系，只是气质参考；图本身只有 2 张不上屏的贴片。
4. 把「徽记五张轮转给七人」写成一个**设计取舍**（「不是身份对应」）。实际是
   `villagerBadgeId` 用序号模 5，导致切出来的另外 5 张根本没人调用——
   这是漏接，不是取舍。

## 可修的三条（等用户定夺，本次未执行）

- **接上**：`villagerBadgeId` 改成 10 张轮转或按角色身份映射；把 `plate/*` 从
  「按周轮转、日历空态时全不可见」改成固定可见的位置（例如镇志页眉或画廊页
  用真的 `<img>` 展示十张）；`emote-09` 从清单删除。
- **删掉**：把上述 14 件确定无消费方的产物从清单与 `public/assets/` 移除，
  少装 14 张小图，并把文档改成「2 张完整用上、8 张只作参考」的实话。
- **补证据**：用真实开局（不注入数据）重录一段屏，作为「接线是否真的可见」
  的验收依据；现在两版录屏不能当这个证据。
