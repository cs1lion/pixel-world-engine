# ADR_PRESENTATION_GATE_LAYERS：表现层松绑与闸门分层改造

- status: aligned
- verified_at: 2026-11-19
- verified_by: agent（用户「组合 1 与组合 2 已合入 main，基于最新 main 做表现层松绑与闸门分层改造，守住核心确定性零退化」）
- evidence: `world-client/scripts/audit-palette.mjs`, `world-client/scripts/audit-references.ts`, `world-client/test/layer-guard.test.ts`, `world-client/scripts/red-first-lib.ts`, `world-client/scripts/check-shot-actor-pin.mjs`, `world-client/scripts/check-rain-pin.mjs`, `CLAUDE.md`

## 1. 问题

表现层（`?art=1`，默认开）起来之后，三道闸门的口径还停在「全仓只有一层渲染」的时代：

- palette 24/24 把表现层的图集色与 WebGL 光照混合色也按 24 色管：要么误杀表现力，
  要么逼人把表现层颜色藏进注释里假装没有；
- 行号引用闸靠「文档写 `:行号`」自证，行号随每次提交漂移，改代码必爆文档维护，
  于是「改代码必改文档行号」成了常态成本；
- 世界内核的确定性纪律（零墙钟、零随机）与表现层的视觉随机（风摆、飞鸟、涟漪、
  光晕呼吸、镜头阻尼）没有写成分层防火墙：新人最容易把 `Math.random()` 放进世界，
  或把世界状态写进装饰层，两头都是事故。

## 2. 决策

- **闸门分层**：palette 24/24 只管逻辑兜底层（`?art=0`：严格 24 色世界调色板 +
  9 色 UI 基础语义 Token；零外部图片请求由 `check-art-assets.mjs` 的 `?art=0`
  零素材请求断言守，不重复造轮子）与 UI Token；对 `src/render/art1/` 与资产图集目录
  （`public/assets/`）显式放行。`?art=1` 表现层允许全色域像素图集、WebGL 光照与
  混合色调，不进 24 色预算口径。
- **符号锚点为首选**：`audit-references.ts` 支持 `path#symbolName`（函数/类/导出符号
  存在性校验，按声明形态与 export 名单认，不认「只是被调用」），可选再带行号
  （`文件#符号:行号`，两样都查）；既有行号引用一律向后兼容。行号会漂，符号不会——
  文档首选符号锚点，改代码不必再陪行号。
- **两条边界**（`test/layer-guard.test.ts` 静态守 + `CLAUDE.md` 写明）：
  a) `src/world/**` 继续 100% 禁绝 `Date.now()` / `Math.random()`（含
  `performance.now` / `new Date(`），确保存档与 Trajectory 指纹确定性；唯一例外是
  `Simulation` 收下注入墙钟的默认值那一行，形态整行钉死；
  b) `src/render/fx-ambient/**`（纯装饰环境动效）豁免视觉时钟与独立视觉 PRNG，
  但严禁向 WorldState 写入任何状态——静态面守「不得 import `src/world/**`、
  不得出现 `WorldState` 标识符」，装饰只许读世界、不许写世界。
- **labs 沙盒**：`world-client/src/labs/` 下实验原型免跑 red:first 与 screens-diff
  （`test/labs/` 与 `src/labs/` 的流程豁免登记在 `red-first-lib.ts` 的跳过清单，
  理由是 base 上无红可证）；转正移出 labs 后再补全 EDD 评测。静态面另守一条：
  实验代码不得被生产路径接走（`src/` 下除 labs 自己外不得 import `src/labs/**`）。
- **screens-diff 5/5 锁定 `?art=0`**：两个 pin 夹具的五项判定（三组基线逐字节
  0/0/0 + 两条扰动必须非零）只在 `?art=0` 基准模式执行；`?art=1` 的图集与光照
  不进基线。

## 3. 验证

- 17 道 CI 闸门全绿（含 `audit-palette.mjs --strict` 24/24、`audit-references.ts
  --strict` 0 存疑）；核心确定性零退化：`src/world` 零墙钟零随机的扫描面从「部分
  文件」扩到「全目录」，实测 127 个文件零真实调用。
- 三套 EDD（sensory / creator / rewind）全过；`worktrees:audit --strict` 绿。
- 本 ADR 自身也过 `audit-references`：文中不写行号坐标，文件名引用走
  `audit-citations` 的存在性校验。
