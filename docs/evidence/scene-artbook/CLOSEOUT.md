# 灯潮界 · 场景美术线收尾清单（2026-11-04）

状态：**收工**，停在分支 `feat/scene-artbook`（基点 `main` `54139dd`），等合并。
不再开新条目，不再做半径 / 强度 / 尺度的进一步微调。

## 结论

29 件灯街资产（125 格）的静态形 **29/29** 都能指到渲染分支：**4 件「已实现」、25 件「有形无动态」、0 件「仍缺」**。
四件结构问题（两套色板 / 遮挡 / 光池 / 尺度）都已落地，并留有可复核读数；但 25 件的专属动态、投影、室内层，以及街外建筑（主楼、桥、渡口、摊位棚、灯串）的同类尺度校正**没有做**，列在第三节。

## 一、29 件资产

| 状态 | 件数 | ID |
|---|---|---|
| 已实现 | 4 | `street_paving`；`signpost_west`、`signpost_mid`、`signpost_east` |
| 有形无动态 | 25 | `lamp_post_1`–`lamp_post_10`（10 根）；`lamp_string_west`、`lamp_string_east`、`lamp_string_south`（3 串）；`shopfront_west`、`shopfront_mid`、`shopfront_east`（3 面）；`stall_north_1`、`stall_south_1`、`stall_north_2`、`stall_south_2`、`stall_south_3`、`stall_east`（6 摊）；`banner_west`、`banner_south`、`banner_east`（3 幅） |
| 仍缺 | 0 | — |

25 件「有形无动态」现在剩余缺层（遮挡、受光、窗光同源已补，不再列入）：

- `lamp_post_*`：逐盏渐次 / 呼吸 / 风摆 / **投影**；
- `lamp_string_*`：风摆 / 高低错落 / 灯绳下垂 / **投影**；
- `shopfront_*`：室内暗部 / 二层 / 暖帘动；
- `stall_*`：摊主 / 货层 / 棚布动 / **投影**；
- `banner_*`：摆动 / **投影**；
- `street_paving`、`signpost_*`：无（铺装的湿面与污渍记在氛围层，不算这 29 件的缺层）。

口径：清单与格数仍以 `world-client/src/settings/dengchao/lamp-street.ts` 的 `LAMP_STREET_ASSETS` 为准；四件结构问题的读数见下一节。

## 二、四件结构问题

| 问题 | 状态 | 关键读数 | 复核方式 | 提交 |
|---|---|---|---|---|
| 两套 24 色同屏 | 已修：色板按当前世界解析（间接层） | `audit-palette --strict`：世界层 24/24、UI 层 8/8、共享 1、并集 31、超出 0；源色 CIEDE2000 24 个槽全为 0（改前 `plaza` 22.3、`stone` 13.3） | `node scripts/audit-palette.mjs --strict`；`docs/adr/ADR_PALETTE_24.md` | `9cafa18`、`411df7a` |
| 遮挡 / 深度错乱 | 已修：灯街构件按落地行分层 | 摊位 depth **1428**；同一格后排脚底 **1424**（被挡）、前一格 **1456**（挡住柜台） | `npm run test:scene-depth`；`world-client/eval/screens/placement-stall.png` | `54ca1ff`、`d9e9cb1`、`4e2af7c` |
| 光不进人 / 墙 / 地 | 已修：落地的地面光池（depth 3.2） | 灯亮 Y **0.100** / **5309K**，灯灭 Y **0.031** / **13429K**，ΔY **+6.9pp**；距灯 2 格 ΔY **0.66pp**（改前 0）；夜间街面覆盖 **66.3%→76.6%**；灯灭时光池指令 **0** | `npm run test:lamp-pool`、`npm run test:lamp-band`；`world-client/eval/screens/lamp-pool.png`、`world-client/eval/screens/lamp-band-after.png` | `4cbff1c`、`7072a15`、`fa24737` |
| 尺度偏小 | 已修：店面与灯柱（只这两类） | 店面墙 32→**48**（1.07→**1.60×**）；灯柱 37→**58**（1.23→**1.93×**）；灯体下沿净空 24→**43**；常量读数与像素扫描同为 **48 / 4 / 43** | `npm run test:setting-scale`；`world-client/eval/screens/setting-scale.png` | `2194c52` |

## 三、明确没做（不在本次交付）

1. **29 件的专属动态：0 件。** 只有全局「亮 / 灭」一个布尔；灯不摆、不呼吸，摊布不飘，幌布不摆，灯串不晃。蒸汽只在 2 处、无高度渐隐。
2. **投影：0 件。** 地面光池是提亮，不是物件的影子；摊位、灯柱、幌布都没有落地投影。
3. **潮位驱动的其它后果。** 只有地面光池随潮位改半径与强度；水面上涨对街道、船位、桥墩、倒影位置的影响没有做。
4. **室内层。** 店面室内暗部与二层、`wave_house` / `boiler_annex` 室内、叠浪楼 8 层与屋顶庭院都没有。
5. **街外同类尺度校正。** 只做了店面（墙 48）与灯柱（58）；叠浪楼（主楼）、朱红桥、渡口站台、摊位棚布、灯串高度都没有按人的 30px 复核。
6. **氛围层与「雾」的口径。** 水面灯影、对岸窗火、湾面低雾已在 `world-client/src/render/scene-artbook.ts`，但它们是补绘层，不计入 29 件的专属动态；灯潮界本身的「雾」仍是空（authored，设计如此），没有内容可漂。

## 四、闸门与未验证项

今天现跑：

- `npm run check` 0 error / 0 warning；
- `npm test` **2070 / 2061 pass / 0 fail / 9 skip**；
- `npm run build` 通过；
- `audit-palette --strict` 世界 24/24、UI 8/8、超出 0；
- `render-budget` **6/6**，灯潮界满潮夜街绘制指令峰值 **16529 ≤ 29000**；
- `test:scene-depth`、`test:lamp-pool`、`test:lamp-band` 均可复跑。

**`check-buttons` 仍未验证。** 它需要带服务端的完整启动，本轮没有启动服务端；这一条不改成绿，留给合并后的完整启动复核。
