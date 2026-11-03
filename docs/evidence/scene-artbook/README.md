# 场景美术线 · 证据索引

这条线（灯潮界街景）的全部证据都在仓库内，没有一张图留在仓外临时目录。
图与数据落在 `world-client/eval/screens/`，生成脚本在 `world-client/scripts/`，关键读数抄在下面这张表里；
收尾状态与 29 件资产的分档见同目录的 `CLOSEOUT.md`。

## 一、索引

| 证据 | 文件 | 关键读数 | 生成脚本 | 提交 |
|---|---|---|---|---|
| 遮挡摆位（后一格 / 前一格） | `world-client/eval/screens/placement-stall.png`（另有 `placement-behind.png`、`placement-front.png`） | 摊位 depth **1428**；后排脚底 **1424**（被挡）；前一格 **1456**（挡住柜台） | `world-client/scripts/check-scene-depth.mjs`（`npm run test:scene-depth`） | `d9e9cb1`、`4e2af7c` |
| 光池近景（亮 / 灭 / 衰减 / 潮位两档） | `world-client/eval/screens/lamp-pool.png`，及 `lamp-pool-lit.png`、`lamp-pool-dark.png`、`lamp-pool-curve-lit.png`、`lamp-pool-curve-dark.png`、`lamp-pool-tide-10.png`、`lamp-pool-tide-100.png` | 灯亮 Y **0.100** / **5309K**，灯灭 Y **0.031** / **13429K**（ΔY **+6.9pp**）；距灯 0.5 / 1 / 1.5 / 2 / 2.5 格 = **6.88 / 3.36 / 1.73 / 0.66 / 0.00pp**；潮位 10%→100%：Y 0.072→0.100、外圈 31→40px、强度 0.505→1.0；绘制指令 **16529** | `world-client/scripts/check-lamp-pool.mjs`（`npm run test:lamp-pool`） | `4cbff1c`、`7072a15`、`fa24737` |
| 夜街整条街全景（改前 / 改后） | `world-client/eval/screens/lamp-band-before.png`、`lamp-band-after.png`，各自带 `-lit.png`、`-dark.png` 与同名 `.json` | 覆盖 **66.3%→76.6%**；最长暗带 **5.3→4.4 格**；ΔY 平均 2.86→3.33pp；改前/改后像素差：灯亮图 **1.7%**（最大差 19）、灯灭图 **0.00%**；灯灭光池指令 **0** | `world-client/scripts/check-lamp-band.mjs`（`npm run test:lamp-band`；改前一次用 `BAND_LABEL=before`） | `fa24737` |
| 尺度（常量 + 像素扫描） | `world-client/eval/screens/setting-scale.png`，及 `setting-scale-before.json`、`setting-scale-after.json`、对应的两张 png | 店面墙 32→**48**（1.07→1.60×）；灯柱 37→**58**（1.23→1.93×）；灯体下沿净空 24→**43**；常量与扫描同为 **48 / 4 / 43**；人 **30px** | `world-client/scripts/check-setting-scale.mjs`（`npm run test:setting-scale`） | `2194c52` |
| 潮位三档全景 | `world-client/eval/screens/dengchao-noon.png`、`dengchao-tide-high.png`、`dengchao-tide-low.png` | 昼 / 满潮 / 退潮三态；灯潮界场景装载与地形配色 | `world-client/scripts/check-dengchao.mjs`（`npm run test:setting`） | `2194c52` |
| 色板预算 | 无截图（审计文本 + ADR） | `audit-palette --strict`：世界层 **24/24**、UI 层 **8/8**、共享 1、并集 31、超出 **0**；源色 CIEDE2000 24 个槽全为 **0**（改前 `plaza` 22.3、`stone` 13.3） | `world-client/scripts/audit-palette.mjs`；口径记在 `docs/adr/ADR_PALETTE_24.md` | `9cafa18`、`411df7a` |
| 绘制预算 | 无截图（闸门输出） | `render-budget` **6/6**；灯潮界满潮夜街峰值 **16529 ≤ 29000** | `world-client/scripts/check-render-budget.mjs`（`npm run test:render-budget`） | `fa24737` |

## 二、怎么重跑

```bash
cd world-client
# 浏览器类证据需要一个服务：脚本读 PIXEL_WORLD_URL，本机本 worktree 用 5200
# （CI 用的是 preview 的 5188）
PIXEL_WORLD_URL=http://127.0.0.1:5200/ npm run test:scene-depth
PIXEL_WORLD_URL=http://127.0.0.1:5200/ npm run test:lamp-pool
PIXEL_WORLD_URL=http://127.0.0.1:5200/ npm run test:lamp-band
PIXEL_WORLD_URL=http://127.0.0.1:5200/ npm run test:setting-scale
PIXEL_WORLD_URL=http://127.0.0.1:5200/ npm run test:setting
PIXEL_WORLD_URL=http://127.0.0.1:5200/ npm run test:render-budget
# 不需要服务端的
node scripts/audit-palette.mjs --strict
```

- 截图脚本都会覆写 `Math.random`（LCG，种子 `20261019`）、`performance.now`（按帧 × 16.67ms）并把 rAF 冻结在 `FREEZE_AT = 180`；`SETUP_AT = 80`、`ACTION_AT = 170`。同一代码、同一分支重跑应逐像素一致——灯池那次的灯灭图就是靠这一点证明「半径加大没有留残留」。
- `BAND_LABEL=before` 只用于产生改前基线；正常复核用默认的 `after`（默认值即 `after`）。
- 合成页里所有图像都是页内 data URL，单张 png 自带读数，不依赖外部服务。

## 三、不在本索引的图

`world-client/eval/screens/` 里还有其它线（相册、创作、天气、调试面板等）的截图，不在这条场景美术线的证据范围。
这份索引只覆盖灯潮界街景的四个结构问题与光池 / 光带两条证据链。
