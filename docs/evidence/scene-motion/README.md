# 场景动态 · 第一条：灯柱 / 灯串（渐次点亮 · 呼吸 · 风摆）

灯潮界 28 盏灯（10 根灯柱 + 3 串 × 6 盏）由「有形无动态」改为会动，三支动态可分别关掉、分别量。
全部图与数据在仓内：图与合成页在 `world-client/eval/screens/`，生成脚本在 `world-client/scripts/check-scene-motion.mjs`；
没有一张图留在仓外临时目录。

## 一、索引

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

## 二、怎么重跑

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

## 三、口径与隔离

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

## 四、没有改动的东西

- 相位与总闸仍是既有的 `lampStreetLitAt`：`?time=dusk` 强制相位、`autoAdvancing=false`；
渐次只是在总闸亮着时决定「这一盏几时亮到几成」。
- 夜街读数未被动画改坏：覆盖 76.6%、最长暗带 4.4 格与改前一致；2 格处 ΔY 0.66pp 与改前一致。
- 摊位（6 件）、幌布（3 件）、烟（主楼烟囱 / 炉底）、人物与摊位落地投影属于后续条目，本条未动。
