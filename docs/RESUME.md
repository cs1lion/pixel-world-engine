# 断点续跑

## 当前断点

- 最后 HEAD: `cda6ee2`（`chore/unlock-presentation-gates`，worktree `D:/project/pwe-unlock-gates`；
  基点 `6b57287` = origin/main，PR #64 之后）。本轮另有 `docs/WORKTREES.md` 补登记两行
  （pwe-creator-overlay / pwe-world-bundle，11-19 巡检发现他人未登记）与本文件，见下一笔提交。
- 未提交改动: 无已跟踪改动（上笔提交后仅剩 WORKTREES 补登记与本文件）；
  主仓 `D:/project/pixel-world-engine` 的 15 个未跟踪图片/JSON 资产原样保留，未入仓。
- 已跑闸门: 17 道 CI 闸门全绿——类型/端口/基线字节（166/166）/单测 2801 项/夹具回放
  6 条 195 项/先红后绿（RESULT=RED 在断言）/构建/色板 24+9 零越界/行号引用+符号锚点
  551 处 0 存疑/文件引用/节号/标注断言+ADR schema 26 valid/指标账本 25 条/账本自检/
  截图自检 5/5/服务端 pytest 579 passed 1 skipped/交付报告审计 issues=0；
  三套 EDD 全绿（sensory 16/16、creator 16/16、rewind 16/16）；`check:hooks` 绿；
  孤儿闸门 0 未登记。
- 未跑/失败: `worktrees:audit --strict` exit 1——未登记项已清零（本分支补登记 2 行），
  剩余红是 6 个**过期未回收** worktree 的 owner 债务（`pwe-audit-fix`/`pwe-eval`/
  `pwe-flaky-gates`/`pwe-material`/`pwe-palette-before`/`pwe-verify`），main 基线同样红、
  非本轮引入；脚本口径「只列不删，回收由 owner 手动作业」。
- 下一步命令: `git push -u origin chore/unlock-presentation-gates` → `gh pr create`；
  合入后 `git worktree remove ../pwe-unlock-gates` 并删分支。

## 本轮改动（表现层松绑与闸门分层改造，2026-11-19）

- **palette 闸门分层**：`audit-palette.mjs` 收窄至 `?art=0` 兜底层（严格 24 色 + 9 色
  UI Token；零外部图片请求由 `check-art-assets.mjs` 的 `?art=0` 零素材请求断言守）与
  UI 基础语义 Token；`src/render/art1/` 与资产图集目录 `public/assets/` 显式放行。
- **符号锚点**：`audit-references.ts` 支持 `path#symbolName`（声明/导出存在性校验，
  可选再带 `:行号` 两样都查），首选锚点；既有行号引用向后兼容；`file://` URL 与
  GitHub `#L413` 行锚点不误报；测试新增 5 组用例。
- **确定性与表现层防火墙**：`test/layer-guard.test.ts` 三条边界——`src/world/**`
  全目录零 `Date.now`/`Math.random`/`performance.now`/`new Date(`（127 文件实测零
  真实调用，唯一例外是 Simulation 注入墙钟默认值那一行，整行钉死）；
  `src/render/fx-ambient/**` 豁免视觉时钟与独立视觉 PRNG、严禁 import `src/world/**`
  与出现 `WorldState` 标识符；`src/labs/` 实验原型不得被生产路径 import。
  `red-first-lib.ts` 加 labs 目录级免跑规则 + `layer-guard.test.ts` 文件级登记。
- **screens-diff 5/5 锁定 `?art=0`**：`check-shot-actor-pin.mjs` / `check-rain-pin.mjs`
  截图 URL 加 `art=0`，头注写明五项判定只在程序化兜底基准上执行。
- **口径文档**：CLAUDE.md 闸门分层小节、SPEC §11.2/§12 指针、
  `docs/adr/ADR_PRESENTATION_GATE_LAYERS.md`（status: aligned）。
- **账本**：`eval/ledger.json` 两条 palette 读数按分层后口径重读
  （script_sha `f953f714…`，引用 791→834 / 202→237 为 main 自然增长，唯一色与越界不变）。

## 回收与本线收尾

- 本线核心确定性零退化：world 全目录扫描面从「部分文件」扩到「全目录」，
  实测零真实调用；24/24 与 9/9 预算读数不变。
- 合入后记得：worktree 登记表的 `pwe-unlock-gates` 行按「已合入 3 个工作日内回收」
  口径清理；过期 6 行的回收仍归各自 owner。
