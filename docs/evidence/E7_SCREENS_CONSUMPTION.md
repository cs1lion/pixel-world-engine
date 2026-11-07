# eval/screens 跟踪件消费审计（E7）

- 审计时间：2026-11-07；基线 `main`/`bfe4487`；工作树 `D:\project\pwe-baseline-audit`（分支 `chore/eval-screens-audit`）。
- 对象：`world-client/eval/screens`（不是仓库根的 `eval/screens`）。
- 计数：**169 件 = 157 PNG + 3 HTML + 9 JSON**（`git ls-files world-client/eval/screens`）。
  原记录里的 "157" 只指 PNG，不是全部跟踪件；全量件数一直是 169。删除 3 件后为 **166 件 = 154 PNG + 3 HTML + 9 JSON**。

## 一、判定方法（不按目录名猜）

1. `git ls-files` 取全量，按扩展名分类。
2. 对每个文件名做全仓**已跟踪文本文件**全文检索（md/json/mjs/ts/js/yml/py/html），排除该目录自身，得到精确名引用。
3. 对没有精确命中的文件，逐行读 `docs/evidence/scene-motion/README.md`、`docs/evidence/scene-artbook/README.md`、
   `docs/evidence/SCREENS_BASELINE_AUDIT.md`、`docs/evidence/ANIMATION_BASELINE_VERDICT.md`，
   按文档里的通配/简写（`-dusk-*`、`-t1`、`同一 JSON`）语义匹配；通配只在语义确实覆盖该帧时才算引用。
4. 读 12 个生产脚本（`check-*`、`smoke.mjs`），区分「写」与「读」：只有带路径的 `readFileSync` / `existsSync`，
   且在当前仓库数据上**实际执行成立**，才算 ①。仅被脚本写出的不算消费方。
5. 实跑读取方：`node scripts/check-lamp-blindspot.mjs`（读 after 三件）、
   `PIXEL_WORLD_URL=http://127.0.0.1:5251/ node scripts/check-lamp-band.mjs`（读 before 三件做像素差；
   2026-11-07 修死接后，缺件/协议不符会 exit 1）。

## 二、三类件数

| 类 | 定义 | 件数 | 其中 PNG |
|---|---|---|---|
| ① | 闸门脚本实测读取（缺件即红/退出） | **6** | 4 |
| ② | 只作为证据被文档/证据 JSON 引用 | **160** | 150 |
| ③ | 既无闸门消费，也无文档引用 | **3** | 3 |
| 合计 | | **169** | **157** |

> 2026-11-07 修死接后，`check-lamp-band` 实读 before 三件（`lamp-band-before.json`、`-lit.png`、`-dark.png`），
> 这三件从 ② 移到 ①：① 由 3 变 6、② 由 163 变 160。③ 不变。

② 里有 3 件是"清单/噪声"级引用而非读数引用：`banner-smoke.html`、`stall-motion.html`（`docs/evidence/ANIMATION_BASELINE_VERDICT.md:150` 的噪声 sidecar 清单）、
`lamp-band-before-seed-pinned.png`（同一次 39cff04 基线的合成页，`docs/evidence/ANIMATION_BASELINE_VERDICT.md:276` 的入库清单）。
其余 ② 都在证据表的读数行里点名或由同组通配语义覆盖。

③ 里的 ground-shadow-closed-t.png 在 `docs/evidence/ANIMATION_BASELINE_VERDICT.md:65` 的
"13 张一次性 before/合成/-1x 参照"清单里被点名，但那一行只说明它**默认口径不产出**，
没有给它挂任何读数或结论；按本审计口径，"被清单提到"不等于"作为证据引用"，因此归 ③ 而不是 ②。

## 三、事实修正（三条）

1. **"157 张基线没有消费方" 不准确。** 169 件里有 12 件 sidecar（3 HTML + 9 JSON）；其中
   `lamp-band-after.json`、`lamp-band-after-lit.png`、`lamp-band-after-dark.png` 被
   `check-lamp-blindspot.mjs` **实际读取**（:25-27，:34-36 缺件即抛错）。这一条与
   `docs/evidence/ANIMATION_BASELINE_VERDICT.md:150` 的 "lamp-band-after.json 是 read-only consumer" 一致。
2. **`check-lamp-band` 对 before 三件的读曾是死接（2026-11-07 已修复）。** 消费方
   `check-lamp-band.mjs` 要求 `beforeJson.params.seed === SEED` 且 `params.trueClear === true`；
   但产出方在 `fa24737` 写下的 `lamp-band-before.json` 还是旧 schema（顶层只有
   `label/shots/cam/stats/tideLevel/coverage/...`，没有 `params`）。`params` 是 `64ef771` 才加进
   `result` 的，`sameProtocol` 判据是 `909e9de` 才加的；从那时起 before JSON 一直没重产，
   于是判据永久 `false`、before/after 对比永久静默跳过，脚本却一直绿。
   **修复（同一分支）**：把 `POINT_POOL_RX` 临时回退 40→32（只改这一个常量）后重拍 before，
   产出方按当前协议写出 `params`（seed=20261019、trueClear=true、now=720、rainStrength=0），
   三件从 ② 升为 ①。消费方改为**缺件 / 缺 params / 种子不符 / 非真晴 / 尺寸不一 → 打印原因 + 退出 1**。
   实测跑通后：灯亮图 10476 / 563520（1.9%，最大差 19），灯灭图 0 / 563520（0.0%）。
   before 的新读数为 65.9% / 5.3 格 / avg 3.51pp / 34575 指令 / 155 Graphics（旧记录 66.3% 是
   fa24737 那次未钉种子的采样，差 0.4pp；暗带 5.3 格不变）。
3. **"没有消费方" 的真实含义是没有 CI 闸门。** 不是没有读取方：6 件有实测读取，160 件有文档/证据引用。
   157 张 PNG 里 150 张是证据，3 张是零引用，4 张是读取输入。

## 四、全量表

图例：① = 脚本实测读取；② = 文档/证据引用；③ = 无消费、无引用。
证据列写的是 **具体文件:行**；`通配` / `简写` 表示该行按同组命名规则语义覆盖本件。
③ 的文件名不带反引号，因为这些文件已删除，留作历史记录。

| 文件 | 类 | 证据（文件:行） | 处置 |
|---|---|---|---|
| `01-salute.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `02-working.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `03-deliver.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `04-rain.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `05-build.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `06-faith.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `07-debug-panel-1s.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `07-debug-panel-400ms.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `07-debug-panel-filtered.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `07-debug-panel.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `08-overlay-100.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `08-overlay-200.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `08-overlay-400.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:68-80 | 保留（证据引用） |
| `banner-smoke-banner-both-t.png` | ② | docs/evidence/scene-motion/README.md:279 | 保留（证据引用） |
| `banner-smoke-banner-both-t1.png` | ② | docs/evidence/scene-motion/README.md:279 | 保留（证据引用） |
| `banner-smoke-banner-off-t.png` | ② | docs/evidence/scene-motion/README.md:280（`-t/-t1` 简写） | 保留（证据引用） |
| `banner-smoke-banner-off-t1.png` | ② | docs/evidence/scene-motion/README.md:280（`-t/-t1` 简写） | 保留（证据引用） |
| `banner-smoke-banner-shadow-t.png` | ② | docs/evidence/scene-motion/README.md:280（`-t/-t1` 简写） | 保留（证据引用） |
| `banner-smoke-banner-shadow-t1.png` | ② | docs/evidence/scene-motion/README.md:280（`-t/-t1` 简写） | 保留（证据引用） |
| `banner-smoke-banner-sway-t.png` | ② | docs/evidence/scene-motion/README.md:280（`-t/-t1` 简写） | 保留（证据引用） |
| `banner-smoke-banner-sway-t1.png` | ② | docs/evidence/scene-motion/README.md:280（`-t/-t1` 简写） | 保留（证据引用） |
| `banner-smoke-pause-a.png` | ② | docs/evidence/scene-motion/README.md:287 | 保留（证据引用） |
| `banner-smoke-pause-b.png` | ② | docs/evidence/scene-motion/README.md:287 | 保留（证据引用） |
| `banner-smoke-shadow-dusk.png` | ② | docs/evidence/scene-motion/README.md:282 | 保留（证据引用） |
| `banner-smoke-shadow-night.png` | ② | docs/evidence/scene-motion/README.md:282 | 保留（证据引用） |
| `banner-smoke-shadow-noon.png` | ② | docs/evidence/scene-motion/README.md:282 | 保留（证据引用） |
| `banner-smoke-smoke-high-off-t2.png` | ② | docs/evidence/scene-motion/README.md:283（`关掉 0.00%` 的 off 输入；高烟 pair 简写） | 保留（证据引用） |
| `banner-smoke-smoke-high-off.png` | ② | docs/evidence/scene-motion/README.md:283（`关掉 0.00%` 的 off 输入；高烟 pair 简写） | 保留（证据引用） |
| `banner-smoke-smoke-high-on.png` | ② | docs/evidence/scene-motion/README.md:283（`关掉 0.00%` 的 off 输入；高烟 pair 简写） | 保留（证据引用） |
| `banner-smoke-smoke-high-pair-t.png` | ② | docs/evidence/scene-motion/README.md:283（`关掉 0.00%` 的 off 输入；高烟 pair 简写） | 保留（证据引用） |
| `banner-smoke-smoke-high-pair-t1.png` | ② | docs/evidence/scene-motion/README.md:283（`关掉 0.00%` 的 off 输入；高烟 pair 简写） | 保留（证据引用） |
| `banner-smoke-smoke-low-off-t2.png` | ② | docs/evidence/scene-motion/README.md:284（off/off-t2 显式列出） | 保留（证据引用） |
| `banner-smoke-smoke-low-off.png` | ② | docs/evidence/scene-motion/README.md:284（off/off-t2 显式列出） | 保留（证据引用） |
| `banner-smoke-smoke-low-on.png` | ② | docs/evidence/scene-motion/README.md:284（off/off-t2 显式列出） | 保留（证据引用） |
| `banner-smoke-smoke-low-pair-t.png` | ② | docs/evidence/scene-motion/README.md:284（off/off-t2 显式列出） | 保留（证据引用） |
| `banner-smoke-smoke-low-pair-t1.png` | ② | docs/evidence/scene-motion/README.md:284（off/off-t2 显式列出） | 保留（证据引用） |
| `banner-smoke.html` | ② | docs/evidence/ANIMATION_BASELINE_VERDICT.md:150（噪声 sidecar：generatedAt/帧哈希每次不同） | 保留（证据引用） |
| `banner-smoke.json` | ② | docs/evidence/scene-motion/README.md:281（`同一 JSON` 的 banner.units） | 保留（证据引用） |
| `creation-ghost.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:63-64 | 保留（证据引用） |
| `creation-rejected.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:63-64 | 保留（证据引用） |
| `dengchao-noon.png` | ② | docs/evidence/scene-artbook/README.md:15 | 保留（证据引用） |
| `dengchao-tide-high.png` | ② | docs/evidence/scene-artbook/README.md:15 | 保留（证据引用） |
| `dengchao-tide-low.png` | ② | docs/evidence/scene-artbook/README.md:15 | 保留（证据引用） |
| `ground-shadow-closed-a.png` | ② | docs/evidence/scene-motion/README.md:343（closed-a/b 同刻两页；跨 t/t+1s 用的 t1） | 保留（证据引用） |
| `ground-shadow-closed-b.png` | ② | docs/evidence/scene-motion/README.md:343（closed-a/b 同刻两页；跨 t/t+1s 用的 t1） | 保留（证据引用） |
| ground-shadow-closed-t.png | ③ | 无生产者：check-ground-shadow.mjs 的 shot tag 只有 closed-a(:541)/closed-b(:544)/closed-t1(:568)，e93d422 初版脚本亦无 closed-t；docs 全文无引用；check-ground-shadow 不读基线 | 删除：同名兄弟 closed-a/t1/b 已覆盖同刻/跨 t 两组读数，本件是旧命名残留 |
| `ground-shadow-closed-t1.png` | ② | docs/evidence/scene-motion/README.md:343（closed-a/b 同刻两页；跨 t/t+1s 用的 t1） | 保留（证据引用） |
| `ground-shadow-foot-dusk-3x.png` | ② | docs/evidence/scene-motion/README.md:346 | 保留（证据引用） |
| `ground-shadow-foot-dusk-off-3x.png` | ② | docs/evidence/scene-motion/README.md:346 | 保留（证据引用） |
| `ground-shadow-foot-dusk.png` | ② | docs/evidence/scene-motion/README.md:346 | 保留（证据引用） |
| `ground-shadow-pause-a.png` | ② | docs/evidence/scene-motion/README.md:344 | 保留（证据引用） |
| `ground-shadow-pause-b.png` | ② | docs/evidence/scene-motion/README.md:344 | 保留（证据引用） |
| `ground-shadow-stall-dusk-off.png` | ② | docs/evidence/scene-motion/README.md:339（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-stall-dusk-on.png` | ② | docs/evidence/scene-motion/README.md:339（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-stall-night-off.png` | ② | docs/evidence/scene-motion/README.md:339（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-stall-night-on.png` | ② | docs/evidence/scene-motion/README.md:339（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-stall-noon-off.png` | ② | docs/evidence/scene-motion/README.md:339（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-stall-noon-on.png` | ② | docs/evidence/scene-motion/README.md:339（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-villager-dusk-off-1x.png` | ② | docs/evidence/scene-motion/README.md:342（`-off-1x` 简写） | 保留（证据引用） |
| `ground-shadow-villager-dusk-off.png` | ② | docs/evidence/scene-motion/README.md:340（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-villager-dusk-on-1x.png` | ② | docs/evidence/scene-motion/README.md:342（`-off-1x` 简写） | 保留（证据引用） |
| `ground-shadow-villager-dusk-on.png` | ② | docs/evidence/scene-motion/README.md:340（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-villager-night-off.png` | ② | docs/evidence/scene-motion/README.md:340（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-villager-night-on.png` | ② | docs/evidence/scene-motion/README.md:340（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-villager-noon-off-1x.png` | ② | docs/evidence/scene-motion/README.md:342（`-off-1x` 简写） | 保留（证据引用） |
| `ground-shadow-villager-noon-off.png` | ② | docs/evidence/scene-motion/README.md:340（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow-villager-noon-on-1x.png` | ② | docs/evidence/scene-motion/README.md:342（`-off-1x` 简写） | 保留（证据引用） |
| `ground-shadow-villager-noon-on.png` | ② | docs/evidence/scene-motion/README.md:340（`-dusk-*`/`-night-*` 通配） | 保留（证据引用） |
| `ground-shadow.json` | ② | docs/evidence/scene-motion/README.md:390（`ground-shadow.json` 的 closed/step 读数） | 保留（证据引用） |
| `lamp-band-after-dark.png` | ① | check-lamp-blindspot.mjs:26-27,34-36,35（读像素） | 保留（闸门实测读取） |
| `lamp-band-after-lit.png` | ① | check-lamp-blindspot.mjs:26-27,34-36,35（读像素） | 保留（闸门实测读取） |
| `lamp-band-after.json` | ① | check-lamp-blindspot.mjs:25,39（readFileSync；:34-36 缺失即 exit 1） | 保留（闸门实测读取） |
| `lamp-band-after.png` | ② | docs/evidence/scene-motion/README.md:79（表内只引 after 主图；lit/dark/json 另为 ①） | 保留（证据引用） |
| `lamp-band-before-dark.png` | ① | check-lamp-band.mjs:380-410（读像素做像素差；缺件即 exit 1） | 保留（闸门实测读取） |
| `lamp-band-before-lit.png` | ① | check-lamp-band.mjs:380-410（读像素做像素差；缺件即 exit 1） | 保留（闸门实测读取） |
| `lamp-band-before-seed-pinned-dark.png` | ② | docs/evidence/scene-motion/README.md:232-236（同一次 39cff04 基线；lit/dark 被该 JSON 的 shots 字段 :79-81 指向；ANIMATION_BASELINE_VERDICT.md:276 清单） | 保留（证据引用） |
| `lamp-band-before-seed-pinned-lit.png` | ② | docs/evidence/scene-motion/README.md:232-236（同一次 39cff04 基线；lit/dark 被该 JSON 的 shots 字段 :79-81 指向；ANIMATION_BASELINE_VERDICT.md:276 清单） | 保留（证据引用） |
| `lamp-band-before-seed-pinned.json` | ② | docs/evidence/scene-motion/README.md:232-236（39cff04 同协议基线原始 JSON） | 保留（证据引用） |
| `lamp-band-before-seed-pinned.png` | ② | docs/evidence/scene-motion/README.md:232-236（同一次 39cff04 基线；lit/dark 被该 JSON 的 shots 字段 :79-81 指向；ANIMATION_BASELINE_VERDICT.md:276 清单） | 保留（证据引用） |
| `lamp-band-before.json` | ① | check-lamp-band.mjs:380-410（读 params 校验协议 + 与 after 做像素差；缺件/缺 params/种子不符/非真晴 → exit 1） | 保留（闸门实测读取） |
| `lamp-band-before.png` | ② | docs/evidence/scene-artbook/README.md:13（改前/改后 66.3%→76.6%，明确列 before.png 及 -lit/-dark） | 保留（证据引用） |
| `lamp-pool-curve-dark.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `lamp-pool-curve-lit.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `lamp-pool-dark.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `lamp-pool-lit.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `lamp-pool-tide-10.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `lamp-pool-tide-100.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `lamp-pool.png` | ② | docs/evidence/scene-artbook/README.md:12 + docs/evidence/scene-motion/README.md:80（`lamp-pool-*.png` 通配） | 保留（证据引用） |
| `phase-dawn.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:81-85 | 保留（证据引用） |
| `phase-dusk.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:81-85 | 保留（证据引用） |
| `phase-night-rain.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:81-85 | 保留（证据引用） |
| `phase-night.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:81-85 | 保留（证据引用） |
| `phase-noon.png` | ② | docs/evidence/SCREENS_BASELINE_AUDIT.md:81-85 | 保留（证据引用） |
| `placement-behind.png` | ② | docs/evidence/scene-artbook/README.md:11 | 保留（证据引用） |
| `placement-front.png` | ② | docs/evidence/scene-artbook/README.md:11 | 保留（证据引用） |
| `placement-stall.png` | ② | docs/evidence/scene-artbook/README.md:11 | 保留（证据引用） |
| `scene-motion-1759.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1800-10.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1800-30.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1800.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1801.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1802.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1803.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1804.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1805.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1806-20.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1806.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1810.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-1811.png` | ② | docs/evidence/scene-motion/README.md:74（… 范围列出 13 帧点火序列） | 保留（证据引用） |
| `scene-motion-all-off-t.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-all-off-t1.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-all-on-t.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-all-on-t1.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-breathe-only-t.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-breathe-only-t1.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| scene-motion-dark-t.png | ③ | check-scene-motion.mjs:398 只生成本次运行的 darkDiff 输入；docs/evidence/scene-motion/README.md:76 的六对清单不含 -dark；无其它脚本/文档引用（全仓 grep 0 命中） | 删除：该帧组的读数从未入库，tracked 副本无人再读 |
| scene-motion-dark-t1.png | ③ | check-scene-motion.mjs:398 只生成本次运行的 darkDiff 输入；docs/evidence/scene-motion/README.md:76 的六对清单不含 -dark；无其它脚本/文档引用（全仓 grep 0 命中） | 删除：该帧组的读数从未入库，tracked 副本无人再读 |
| `scene-motion-ignite-off-t.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-ignite-off-t1.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-ignite-only-t.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-ignite-only-t1.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-pause-a.png` | ② | docs/evidence/scene-motion/README.md:77 | 保留（证据引用） |
| `scene-motion-pause-b.png` | ② | docs/evidence/scene-motion/README.md:77 | 保留（证据引用） |
| `scene-motion-residual-after-lit.png` | ② | docs/evidence/scene-motion/README.md:78 | 保留（证据引用） |
| `scene-motion-residual-lit.png` | ② | docs/evidence/scene-motion/README.md:78 | 保留（证据引用） |
| `scene-motion-residual-never.png` | ② | docs/evidence/scene-motion/README.md:78 | 保留（证据引用） |
| `scene-motion-run2-1759.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1800-10.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1800-30.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1800.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1801.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1802.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1803.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1804.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1805.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1806-20.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1806.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1810.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-run2-1811.png` | ② | docs/evidence/scene-motion/README.md:75（`scene-motion-run2-*.png` 通配 + 每帧两张的 13/13 确定性） | 保留（证据引用） |
| `scene-motion-sway-only-t.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion-sway-only-t1.png` | ② | docs/evidence/scene-motion/README.md:76（六对 `-t / -t1` 通配） | 保留（证据引用） |
| `scene-motion.html` | ② | docs/evidence/scene-motion/README.md:74 | 保留（证据引用） |
| `scene-motion.json` | ② | docs/evidence/scene-motion/README.md:74 | 保留（证据引用） |
| `setting-scale-after.json` | ② | docs/evidence/scene-artbook/README.md:14 | 保留（证据引用） |
| `setting-scale-after.png` | ② | docs/evidence/scene-artbook/README.md:14 | 保留（证据引用） |
| `setting-scale-before.json` | ② | docs/evidence/scene-artbook/README.md:14 | 保留（证据引用） |
| `setting-scale-before.png` | ② | docs/evidence/scene-artbook/README.md:14 | 保留（证据引用） |
| `setting-scale.png` | ② | docs/evidence/scene-artbook/README.md:14 | 保留（证据引用） |
| `stall-motion-both-off-t.png` | ② | docs/evidence/scene-motion/README.md:157 | 保留（证据引用） |
| `stall-motion-both-off-t1.png` | ② | docs/evidence/scene-motion/README.md:157 | 保留（证据引用） |
| `stall-motion-both-on-t.png` | ② | docs/evidence/scene-motion/README.md:157 | 保留（证据引用） |
| `stall-motion-both-on-t1.png` | ② | docs/evidence/scene-motion/README.md:157 | 保留（证据引用） |
| `stall-motion-cover-off-t.png` | ② | docs/evidence/scene-motion/README.md:159 | 保留（证据引用） |
| `stall-motion-cover-off-t1.png` | ② | docs/evidence/scene-motion/README.md:159 | 保留（证据引用） |
| `stall-motion-cover-on-t.png` | ② | docs/evidence/scene-motion/README.md:159 | 保留（证据引用） |
| `stall-motion-cover-on-t1.png` | ② | docs/evidence/scene-motion/README.md:159 | 保留（证据引用） |
| `stall-motion-fire-off.png` | ② | docs/evidence/scene-motion/README.md:160 | 保留（证据引用） |
| `stall-motion-fire-on.png` | ② | docs/evidence/scene-motion/README.md:160 | 保留（证据引用） |
| `stall-motion-only-cloth-t.png` | ② | docs/evidence/scene-motion/README.md:155 | 保留（证据引用） |
| `stall-motion-only-cloth-t1.png` | ② | docs/evidence/scene-motion/README.md:155 | 保留（证据引用） |
| `stall-motion-only-fire-t.png` | ② | docs/evidence/scene-motion/README.md:156 | 保留（证据引用） |
| `stall-motion-only-fire-t1.png` | ② | docs/evidence/scene-motion/README.md:156 | 保留（证据引用） |
| `stall-motion-pause-a.png` | ② | docs/evidence/scene-motion/README.md:161 | 保留（证据引用） |
| `stall-motion-pause-b.png` | ② | docs/evidence/scene-motion/README.md:161 | 保留（证据引用） |
| `stall-motion-rain.png` | ② | docs/evidence/scene-motion/README.md:158 | 保留（证据引用） |
| `stall-motion-repeat-t.png` | ② | docs/evidence/scene-motion/README.md:162（确定性 2/2 的第二次运行输入） | 保留（证据引用） |
| `stall-motion-repeat-t1.png` | ② | docs/evidence/scene-motion/README.md:162（确定性 2/2 的第二次运行输入） | 保留（证据引用） |
| `stall-motion.html` | ② | docs/evidence/ANIMATION_BASELINE_VERDICT.md:150（噪声 sidecar） | 保留（证据引用） |
| `stall-motion.json` | ② | docs/evidence/scene-motion/README.md:158（`同一份 JSON` 的 dry/rain 段） | 保留（证据引用） |

## 五、③ 类处置（已执行）

| 文件 | 判定依据 | 处置 |
|---|---|---|
| ground-shadow-closed-t.png | `check-ground-shadow.mjs` 的 shot tag 只有 closed-a（:541）、closed-b（:544）、closed-t1（:568）；初版 `e93d422` 的脚本也没有 closed-t。docs 全文无该文件名的读数引用；脚本不读基线。 | 删除。同刻两页与跨 t/t+1s 两组读数已由 closed-a/closed-b/closed-t1 覆盖，本件是旧命名残留，留着反而会诱导别人拿它和 closed-t1 做假差分。 |
| scene-motion-dark-t.png | `check-scene-motion.mjs:398` 只用本次运行生成的图算 darkDiff；`docs/evidence/scene-motion/README.md:76` 的六对清单不含 -dark；全仓 grep 0 命中。 | 删除。该帧组的读数从未入库，tracked 副本无人再读。 |
| scene-motion-dark-t1.png | 同上。 | 删除。 |

删除提交说明包含：删了什么、凭什么判定无消费方、如何复核。复核命令：

```powershell
git -C D:\project\pwe-baseline-audit ls-files world-client/eval/screens | Measure-Object -Line
# 代码与证据文档里应 0 命中（exit 1）。范围故意排除 OPEN_ISSUES / ANIMATION_BASELINE_VERDICT /
# 本审计文档，因为它们按设计要写这三个文件名来记录删除本身。
git -C D:\project\pwe-baseline-audit grep -n "ground-shadow-closed-t|scene-motion-dark-t" -- world-client docs/evidence/scene-motion docs/evidence/scene-artbook docs/evidence/SCREENS_BASELINE_AUDIT.md
```

## 六、受影响闸门复跑（E7 删除 + 死接修复后）

| 闸门 | 结果 | 证明什么 |
|---|---|---|
| `check-lamp-blindspot.mjs` | 通过，exit 0：原图 76.5625% / 4.4375 格 @ x471；JSON 内容未变（仅行尾差异，已还原） | ① 的 after 三件仍读得到，删除没有误伤 |
| `check-lamp-band.mjs`（5251） | 通过，exit 0：after 76.6% / 4.4 格 @ x471；**before/after 差首次跑出来**：灯亮 10476/563520（1.9%，max 19），灯灭 0/563520（0.0%，max 0）；灯亮 bbox 为 x226..959 / y238..449（横跨整街且高于地面光池 y435..535，说明该半径常量同时波及灯体周围光照，"只在池子附近变"的旧假设不成立） | before 三件现在是真读；这一步让一个被静默很久的假设失效暴露出来 |
| `check-lamp-band.mjs` 负测（`BAND_SEED=1111`） | **退出 1**，`[改前/改后对比] 判红：种子不一致…` | 协议不符不再静默跳过 |
| `check-lamp-band.mjs` 负测（移走 before JSON） | **退出 1**，`[改前/改后对比] 判红：缺少改前基线JSON…` | 缺输入即红 |
| `check-scene-motion.mjs`（5251） | 通过：13/13 确定性；灯灭池指令 0/0、帧差 0.00%；dark 帧改写 tmp | 删 dark 副本不影响脚本，tmp 仍产出该帧 |
| `check-ground-shadow.mjs`（5251） | 通过，exit 0：判据绿；全关同刻两页 0.00%，跨 t/t+1s 0.00%；closed 组不读基线 | 删 closed-t 不影响读数 |
| `npm test` | 2528 tests / 2518 pass / 1 fail / 9 skip（删除那轮）；**2026-11-08 已修**：`docs/OPEN_ISSUES.md:429` 原来的 pixel-world-engine/docs/DESIGN_ACCEPTANCE.md 写法靠「目录名恰好等于 pixel-world-engine」才被后缀匹配放过，改成仓内相对路径 `docs/DESIGN_ACCEPTANCE.md` 后，`audit-citations --strict` 在本工作树也是 **0 未解析**，该测试转绿。 | 环境差异不是缺陷，改写法即消除 |

## 七、E7 结案取舍

- **选 B：降级为人工视觉参考 / 证据，不接 CI。** 证据保留、零引用件删除、不新增闸门。
  尺寸裁切与材质漂移的标注仍在 `docs/evidence/ANIMATION_BASELINE_VERDICT.md` 第二节
  （§2.2 的 44px 裁切、§2.3 的 7.8–8.9% 材质漂移）。
- **否决 A（接 CI）**：144 张可生产图里 108 张与当前视口尺寸不一致（硬裁切/缩放），
  23 张同尺寸但同构建重跑就会变（`docs/evidence/ANIMATION_BASELINE_VERDICT.md` §2.1）；
  先接闸门会把裁切与噪声当成红，属于"闸门红线比问题还糊"。
- **否决 C（整批删除）**：① 6 件被实测读取，② 160 件是 README / scene-artbook / 审计表的引用对象；
  整批删除会打断证据链，且 delete 提交无法证明"零消费"。
- **无重新接闸门项**：本轮没有需要接既有脚本的 ③ 件。若将来把某组证据转成回归，
  唯一现成的读取入口是 `check-lamp-blindspot.mjs`（after 组）；其余组需要改各自 `check-*` 的读取逻辑，
  那已属于"新建闸门语义"，不在 E7 范围内。

## 八、独立复核

```powershell
# 1) 计数
git -C D:\project\pwe-baseline-audit ls-files world-client/eval/screens | Measure-Object -Line
# 2) 本表每一行的证据：按"文件:行"打开对应脚本/文档
# 3) 被删 3 件在代码与证据文档里 0 命中（exit 1；范围排除记录删除本身的文档）
git -C D:\project\pwe-baseline-audit grep -n "ground-shadow-closed-t|scene-motion-dark-t" -- world-client docs/evidence/scene-motion docs/evidence/scene-artbook docs/evidence/SCREENS_BASELINE_AUDIT.md
# 4) 重拍改前基线（只在半径改动前需要；本条用「临时回退常量」在同构建上复现）
#   a. world-client/src/render/lamp-pool.ts 的 POINT_POOL_RX 临时改回 32，npm run build
#   b. $env:BAND_LABEL='before'; node scripts/check-lamp-band.mjs --write-baseline
#   c. 常量改回 40 并重新 build —— 这一步的临时改动不要提交
# 5) 读取方实跑（先 npm run build，再 npm run preview -- --port 5251 --strictPort）
cd D:\project\pwe-baseline-audit\world-client
node scripts/check-lamp-blindspot.mjs
node scripts/check-lamp-band.mjs            # 应打印「灯亮 / 灯灭 changed」，exit 0
# 6) 判红验证：换种子应 exit 1，不再静默跳过
$env:BAND_SEED='1111'; node scripts/check-lamp-band.mjs; echo "exit=$LASTEXITCODE"   # 期望 1
```
