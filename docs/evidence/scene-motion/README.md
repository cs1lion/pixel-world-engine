# 场景动态 · 证据（按条记录）

灯潮界的「有形无动态」逐条改成会动，一条一交；本文件与提交顺序一致。
全部图与数据在仓内：图与合成页在 `world-client/eval/screens/`，生成脚本在 `world-client/scripts/`；
没有一张图留在仓外临时目录。

## 第一条：灯柱 / 灯串（渐次点亮 · 呼吸 · 风摆）

灯潮界 28 盏灯（10 根灯柱 + 3 串 × 6 盏）由「有形无动态」改为会动，三支动态可分别关掉、分别量。

### 一、索引

| 证据 | 文件 | 关键读数 | 生成脚本 |
|---|---|---|---|
| 渐次点亮序列（11 帧，17:59 → 18:06:20） | `world-client/eval/screens/scene-motion-1759.png` … `scene-motion-1806-20.png`；合成页 `scene-motion.html`、`scene-motion.json` | 28 盏：第 1 盏 **18:00:00**，最后一盏 **18:06:00**（6 世界分钟；默认倍率 60 下约 6 真实秒）；单盏起亮 **12 世界秒**（smoothstep）；`litAt` 单调 0→28 | `world-client/scripts/check-scene-motion.mjs` |
| 同一序列跑两遍（每帧两张） | `scene-motion-*.png` 与 `scene-motion-run2-*.png` | **13/13 帧逐像素 sha256 完全一致**（PNG 字节带编码差异，不作判据） | 同上 |
| 三支分别开关的 t / t+1s 帧差 | `scene-motion-all-on-*`、`-all-off-*`、`-sway-only-*`、`-breathe-only-*`、`-ignite-only-*`、`-ignite-off-*` | ROI（世界 x 228..735、y 372..547）变化占比：全开 **11.77%**（max 158）；全关 **0.00%**；只风摆 **1.28%**（max 158）；只呼吸 **10.62%**（max 5）；只渐次（18:02→18:03）**8.89%**（max 140）；渐次关掉同一对时刻 **0.00%** | 同上 |
| 暂停世界 → 画面静止 | `scene-motion-pause-a.png`、`scene-motion-pause-b.png` | 世界冻住后等 1 真实秒（渲染帧 **+62**），ROI 与全画面变化均 **0.00%**；世界时刻 18:10:00 → 18:10:00 未推进 | 同上 |
| 灯灭残留（同页、同一世界时刻） | `scene-motion-residual-never.png`、`-residual-lit.png`、`-residual-after-lit.png` | 18:10:00 同一页：从没亮过 / 强亮 / 亮过再灭；「亮过再灭」与「从没亮过」逐像素差 **0.00%（0 像素，max 0）**；亮 → 灭本身 19.51%；地面光池指令 灭 **0** / 亮 **2552** / 再灭 **0** | 同上 |
| 夜街光带回归 | `lamp-band-after.png`、`-lit.png`、`-dark.png`、`lamp-band-after.json` | 覆盖 **76.6%**、最长暗带 **4.4 格（起点 x 471）**、ΔY min 0.00 / avg 3.33 / max 7.39pp；光池指令 灯亮 **2552** / 灯灭 **0** | `world-client/scripts/check-lamp-band.mjs`（`npm run test:lamp-band`） |
| 光池近景回归 | `lamp-pool.png` 及 `lamp-pool-*.png` | 距灯 2 格 ΔY **0.66pp**（与改前一致）；灯亮 Y 0.098 / 灯灭 Y 0.031；绘制指令 **16634**、Graphics **50** | `world-client/scripts/check-lamp-pool.mjs`（`npm run test:lamp-pool`） |
| 指令预算 | 无截图（闸门输出） | 本证据序列黄昏峰值 **16644**（改前 16529，+115；预算 29000）；`render-budget` **6/6**，默认世界 16130 / 25 个 Graphics | `world-client/scripts/check-render-budget.mjs`（`npm run test:render-budget`） |

### 二、怎么重跑

```bash
cd world-client
# 浏览器类证据读 PIXEL_WORLD_URL；端口必须指向**本 worktree** 的服务（本条用 5202，CI 用 preview 5188）
PIXEL_WORLD_URL=http://127.0.0.1:5202/ node scripts/check-scene-motion.mjs
PIXEL_WORLD_URL=http://127.0.0.1:5202/ npm run test:lamp-band
PIXEL_WORLD_URL=http://127.0.0.1:5202/ npm run test:lamp-pool
PIXEL_WORLD_URL=http://127.0.0.1:5202/ npm run test:render-budget
npm test
node scripts/audit-palette.mjs --strict
```

### 三、口径与隔离

- **世界时钟**：三支动态只读 `snapshot.now`（世界毫秒），经 `world/lamp-motion.ts` 的纯函数算出；
不读 `Date.now`、不读 `performance.now`。关掉一支时该函数退化为常量。
- **钉死世界**：开局 `?world=dengchao&time=dusk&feed=off&ledger=off&debug=1&now=1075`（17:55），
冻住世界后只用 `debugStepWorld` 按世界毫秒推进（每步 100ms × timeScale），每一帧的世界时刻都钉死；
同一序列跑两遍逐像素比较。
- **隔离手段**（只为量灯，不代表世界里的它们不在了）：
村民钉到画面外 (2,2)；渲染潮位钉到 1.0（世界里那条潮汐照常走）；鸟 / 蝙蝠（`ambience-view`）隐藏——
它们也由世界时刻驱动，会在灯街 ROI 上留下像素差，混进来就分不清是灯在动。
- **逐像素哈希**：PNG 字节带编码器与元数据差异，不能用 PNG 的 sha256 判定确定性；
页面内用 `crypto.subtle.digest('SHA-256', RGBA)` 逐像素比较，解码页必须先落在同源 http 上。
- **灯灭残留为什么用同一页比**：不同页面开局的存活帧数不同，会带进另一处既有的逐页差异
（左下角雾 / 罩层，约 1%、max 10），混进来就分不清是不是灯池残留。同一页、同一世界时刻、
同一摆相位下比，才是真的「没有上一帧的光池留在这一帧」。

### 四、没有改动的东西

- 相位与总闸仍是既有的 `lampStreetLitAt`：`?time=dusk` 强制相位、`autoAdvancing=false`；
渐次只是在总闸亮着时决定「这一盏几时亮到几成」。
- 夜街读数未被动画改坏：覆盖 76.6%、最长暗带 4.4 格与改前一致；2 格处 ΔY 0.66pp 与改前一致。
- 摊位（6 件）、幌布（3 件）、烟（主楼烟囱 / 炉底）、人物与摊位落地投影属于后续条目，第一条未动。
- **基线前移**：上表读数（夜街 76.6% / 4.4 格、2 格 0.66pp、峰值 16644、Graphics 50）出自第一条提交时的基线
`eab9e36`。开工第二条前按指令 `git fetch` 并把 `origin/main`（`39cff04`）合入本分支；main 自己的光池改动
让基线读数变为覆盖 **76.9%** / 最长暗带 **1.8 格（x 482）** / 2 格 ΔY **0.54pp**。第二条的「没变坏」以 `39cff04`
为对照，见第二节。

## 第二条：摊位（棚布 / 盖布 · 火光跳动）

6 个摊位（灯潮界设定集 `stalls`）原来只有静态棚布与柜台。本条加三件事：棚布风摆（晴天）、
盖布风摆（`weather-stalls` 把盖布落下之后）、柜台上火盆的火光跳动。三件与灯街同一口径：
只读世界时刻、纯函数、可分别关掉。

### 一、索引

| 证据 | 文件 | 关键读数 | 生成脚本 |
|---|---|---|---|
| 晴：棚布摆 t / t+1s | `stall-motion-only-cloth-t.png`、`stall-motion-only-cloth-t1.png` | ROI（世界 x 130..830、y 160..490，231000 px）变化 **0.51%**（1168 px，max 134）；关掉同一对时刻 **0.00%**（0 px，max 0） | `world-client/scripts/check-stall-motion.mjs` |
| 晴：火光跳 t / t+1s | `stall-motion-only-fire-t.png`、`-t1.png` | **0.35%**（808 px，max 127） | 同上 |
| 晴：两件一起 / 全关 | `stall-motion-both-on-t/-t1`、`-both-off-t/-t1` | 一起 **0.86%**（1976 px，max 134）；全关 **0.00%**（0 px，max 0） | 同上 |
| 晴 / 雨两态对照 | `stall-motion-both-on-t.png`（晴）、`stall-motion-rain.png`（雨）；读数在同一份 JSON 的 `dry` / `rain` 段 | 晴：`awningSway` 此刻 2/6 摊为 ±1、盖布不摆；雨：`weather=rain`、`packed=true`、`awningSway` 六摊全 **0**、盖布 `dx` = `[0,-1,0,0,1,1]`（有位移的那几块 `droop=1`） | 同上 |
| 雨：盖布摆 t / t+1s（晴天 + 强制已盖，隔离雨幕） | `stall-motion-cover-on-t/-t1`、`-cover-off-t/-t1` | 盖布开 **0.95%**（2200 px，max 120）；关掉 **0.00%** | 同上 |
| 火光是否照亮地面 | `stall-motion-fire-on.png`、`stall-motion-fire-off.png`（同页、同一世界时刻） | 开关差 **0.43%**（988 px，max 146），全在柜台上沿；地面取样 10×5 px **0.00%**；`debugLampPool` 仍 **2552** | 同上 |
| 暂停世界 → 画面静止 | `stall-motion-pause-a.png`、`-pause-b.png` | 世界冻住后等 1 真实秒（渲染帧 **+63**），ROI 与全画面 **0.00%**；世界时刻 18:10:00 未推进 | 同上 |
| 确定性 | 同一 `only-cloth` 序列跑两遍 | **2/2** 帧逐像素 sha256 一致（`fd2287…`、`cfbb16…`）；PNG 字节不作判据 | 同上 |
| 指令峰值 | 无截图（脚本输出） | 摊位证据 晴 **17270** / 雨 **19824**（预算 29000）；灯街证据序列黄昏峰值 **17224** | 同上 |
| 夜街光带回归（对 39cff04） | `lamp-band-after.png`、`-lit.png`、`-dark.png`、`lamp-band-after.json` | 覆盖 **76.9%**、最长暗带 **1.8 格（x 482）**、ΔY avg 2.77 / max 10.88pp；基线 76.9% / 1.8 格 —— **未变坏**；光池指令 灯亮 **2552** / 灯灭 **0**；指令 19846 / Graphics 57 | `world-client/scripts/check-lamp-band.mjs`（`npm run test:lamp-band`） |
| 光池近景回归 | `lamp-pool.png` 及 `lamp-pool-*.png` | 距灯 2 格 ΔY **0.54pp**（与 39cff04 一致）；指令 19822 / Graphics 57 | `world-client/scripts/check-lamp-pool.mjs`（`npm run test:lamp-pool`） |
| 渲染预算 | 无截图（闸门输出） | **6/6**；默认世界 **16130** 指令 / **27** Graphics（与 39cff04 相同） | `world-client/scripts/check-render-budget.mjs`（`npm run test:render-budget`） |

### 二、怎么重跑

```bash
cd world-client
# 端口必须指向**本 worktree** 的服务（本条用 5202，CI 用 preview 5188）
PIXEL_WORLD_URL=http://127.0.0.1:5202/ node scripts/check-stall-motion.mjs
PIXEL_WORLD_URL=http://127.0.0.1:5202/ npm run test:lamp-band
PIXEL_WORLD_URL=http://127.0.0.1:5202/ npm run test:lamp-pool
PIXEL_WORLD_URL=http://127.0.0.1:5202/ npm run test:render-budget
npx tsx --test test/stall-motion.test.ts
npm test
```

### 三、口径与隔离

- **世界时钟**：三件只读 `snapshot.now`，经 `world/stall-motion.ts` 的三个纯函数
（`stallClothSwayAt` / `stallCoverSwayAt` / `stallFireAt`）算出；与灯街同一只钟、同一套表驱动整数动画。
不读 `Date.now` / `performance.now`，不存上一帧。
- **雨态与 `weather-stalls` 同一判据**：`packed` 来自 `stallsPackedFor(weather) || sim.preCoveredToday()`，
与盖布落下同一来源。`packed` 为真时 `setting-scenery` 不摆棚布（`cloth && !packed`），由 `weather-stalls`
摆盖布；为假时反过来。任意时刻只有一件在摆，不会出现「盖布落下了、棚布还在飘」。
- **真实雨态怎么触发**：`debugSetWeather('rain')` 走世界自己的天气状态机
（`sim.enqueue({kind:'setWeather', weather})`），不是往画面贴雨点；`packed`、盖布、棚布都由这个世界状态推出来。
- **盖布为什么另用「晴天 + 强制已盖」量**：雨幕本身逐帧在动（雨也是世界时钟驱动），会把盖布的帧差淹没；
`debugForcePacked(true)` 用的是同一个 `packed` 判据，量的是盖布本身。真实雨态另给单帧 + 读数
（`stall-motion-rain.png` 与 JSON 的 `rain` 段）。
- **火光不写地面光池**：火盆画在柜台面（`y+12..15`），只提亮柜台像素，不调用灯池；`debugLampPool` 仍是 2552，
地面取样 10×5 像素差 0。这条是返工后才成立的：火盆最初画在地面（`y+16..18`），把夜街扫描带里加了暗像素，
覆盖从 76.9 掉到 73.8、最长暗带 1.8→3.9；移到柜台面后读数守住。
- **隔离手段**：灯的三支动态全关（`debugLampMotion` 三 false）、村民钉到画面外、渲染潮位钉 1.0、
ambience 隐藏、DOM 叠层隐藏（`screenshot({clip})` 会把顶栏的在线状态/帧计数截进来，混进哈希就误判不确定）。
- **确定性怎么判**：同一页面序列（`only-cloth`，世界时刻 18:10:00 → 18:11:00）连续跑两遍，逐像素 sha256；
PNG 字节带编码差异，不作判据。

### 四、与基线（origin/main 39cff04）对比

| 读数 | 39cff04 | 本条 | 结论 |
|---|---|---|---|
| 夜街覆盖 | 76.9% | 76.9% | 不变 |
| 最长暗带 | 1.8 格（x 482） | 1.8 格（x 482） | 不变 |
| ΔY avg / max | 2.73 / 11.01pp | 2.77 / 10.88pp | 持平（火光只提亮柜台，不在扫描带） |
| 灯池 2 格 ΔY | 0.54pp | 0.54pp | 不变 |
| 光池指令 亮 / 灭 | 2552 / 0 | 2552 / 0 | 不变 |
| render-budget | 16130 / 27，6/6 | 16130 / 27，6/6 | 不变 |
| 摊位峰值 晴 / 雨 | — | 17270 / 19824 | ≤29000 |
| 灯街三支帧差（全开 / 全关 / 只风摆 / 只呼吸 / 只渐次） | — | 11.73 / 0.00 / 1.27 / 10.58 / 8.89% | 与第一条 11.77 / 0.00 / 1.28 / 10.62 / 8.89% 持平（±0.05pp：棚布重绘后落在灯街 ROI 里的几行像素遮住了灯晕） |

