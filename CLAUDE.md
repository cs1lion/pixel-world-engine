# pixel-world-engine

一个可换设定集的像素世界引擎：世界自己跑，LLM 只能输出白名单内的结构化命令去改变它。

- 规范：`docs/SPEC.md` 是**唯一权威**（含 2026-10-25 v2 增补，见 §8–§15）。`docs/SPEC_V2.md` 已冻结为历史归档；`docs/SPEC_DRAFT_20261025.md` 只是草案。**禁止新增 `SPEC_*` 文件**；新决策写进 `docs/SPEC.md` 或 `docs/adr/`，历史草案只归档不删除。
- 迁移盘点：`docs/MIGRATION_FROM_XIAOXI.md`。
- 迭代目标暂存：`docs/iterations/`（目前：1027 迭代任务 1 · 内环、1027 迭代任务 2 · 外环）。
- 美术设定（初版视觉基准）：《千与千寻视觉设定集》，见 `docs/art/`。

## 命令

前端在 `world-client/`，CI 的前端 job 跑的是这几条（`npm run check` 就是
`node scripts/check-types.ts`，`npm run build` 在它之后才 `vite build`）：

```bash
cd world-client && npm ci
```

```bash
cd world-client && npm run check && npm test && npm run build
```

```bash
cd world-client && node scripts/audit-palette.mjs --strict
```

```bash
cd world-client && node scripts/audit-references.ts --strict && node scripts/audit-citations.ts --strict && node scripts/audit-sections.ts --strict
```

服务端在 `server/`，CI 有第二个 job：`pip install -r requirements.txt` 然后
`python -m pytest`。

**这几条要一起跑，别只跑前两条。** CI 现在跑**十九道闸门**：前端 job 十八道，
服务端 job 一道。其中第 5/6/18 道是条件触发（`test:meta` 只在 scripts/ 或
`test/meta/` 变更时跑；`test:nightly` 与 `audit:reports` 只在每日 schedule /
推 main 兜底或对应目录变更时跑），第 8 道 `red:first` 自 2026-11-19 起非阻断
（`continue-on-error: true`，近 20 次提交它 2 次红在 module 类纪律问题而非产品 Bug）。
后七道（色板 + 三份审引用 + `audit-claims` + 两条指标账本）的输出
有个共同性质：**断言对不上、节号不存在、色板超预算、夹具回放漂了，全都只让输出变长，
不会让 `check`/`test` 变红。** 所以只跑前三条的人会以为自己是绿的，而后面十几道
一个都没过。完整清单以 `.github/workflows/ci.yml` 为准——那一份加了新步骤时，
这里要跟着改（`fixture:check` 就是这么漏掉的：表里没有，PR 里就红了 CI）。

| # | 闸门 | 命令（`world-client/` 下执行） | 在 CI 里 |
| --- | --- | --- | --- |
| 1 | 类型检查 | `npm run check` | 前端 job |
| 2 | 端口纪律 | `npm run audit:ports` | 前端 job |
| 3 | 基线字节自证 | `npm run audit:baseline` | 前端 job |
| 4 | 单元测试（不含 meta/nightly 两层） | `npm test` | 前端 job |
| 5 | meta 自审计单测（仅 scripts/ 或 `test/meta/` 变更时跑） | `npm run test:meta` | 前端 job |
| 6 | nightly 重用例（仅 schedule / 推 main 兜底） | `npm run test:nightly` | 前端 job |
| 7 | 回放夹具 | `npm run fixture:check` | 前端 job |
| 8 | 先红后绿（非阻断） | `npm run red:first` | 前端 job |
| 9 | 构建 | `npm run build` | 前端 job |
| 10 | 色板预算（?art=0 兜底层 + UI Token） | `node scripts/audit-palette.mjs --strict` | 前端 job |
| 11 | 行号引用 + 符号锚点 | `node scripts/audit-references.ts --strict` | 前端 job |
| 12 | 文件引用 | `node scripts/audit-citations.ts --strict` | 前端 job |
| 13 | 节号引用 | `node scripts/audit-sections.ts --strict` | 前端 job |
| 14 | 标注断言 + ADR 字段 | `node scripts/audit-claims.ts --strict` | 前端 job |
| 15 | 指标账本口径 | `node scripts/eval-ledger.ts` | 前端 job |
| 16 | 指标账本自检 | `node scripts/verify-ledger-selfcheck.ts` | 前端 job |
| 17 | 截图比对自检 | `python scripts/verify-screens-diff-selfcheck.py` | 前端 job |
| 18 | 交付报告审计（仅报告目录变更 / 兜底时跑） | `npm run audit:reports` | 前端 job |
| 19 | 服务端测试 | `cd server && python -m pytest` | 服务端 job |

CI 另有一个**浏览器 job**：matrix job `browser-lanes` 三条 lane（`test:phases`〔脚本内
四刻并发页〕 / `test:render-budget` / light〔`test:persistence`+`test:building-bake`
+`test:art-assets`+`check-phases-negative`+`eval-interaction --split main`〕，只读、
写到 runner 临时目录；变更只落在 docs/test/scripts/server 等不进口浏览器断言面的
目录时三条 lane 全跳过并正常 exit 0，push main 与每日 schedule 兜底跑全量）。分支
保护强绑的检查名 `world-client-browser` 是一个同名**汇总 gate**（needs 三条 lane，
`if: always()`，任意 lane 非绿则它红）——matrix 化后 lane 的实际上报名带
`(phases)` 等后缀，不改 GitHub 侧保护，靠这个 gate 对齐原检查名。它是验收，
不在这十九道计数里。

## 闸门分层口径（2026-11-19 起）

- **palette 24/24 只管逻辑兜底层与 UI Token**：`?art=0` 渲染路径必须严格 24 色世界
  调色板 + 9 色 UI 基础语义 Token、零外部图片请求（后者由 `check-art-assets.mjs`
  的 `?art=0` 零素材请求断言守）；`?art=1` 表现层允许全色域像素图集、WebGL 光照与
  混合色调，`src/render/art1/` 与资产图集目录（`public/assets/`）放行。
- **行号引用与符号锚点**：`audit-references.ts` 首选锚点是 `path#symbolName`
  （函数/类/导出符号存在性校验），既有行号引用向后兼容；文档优先写符号锚点，
  改代码不必再陪行号漂移。
- **两条边界**（`test/layer-guard.test.ts` 静态守）：
  a) `src/world/**` 继续 100% 禁绝 `Date.now()` / `Math.random()`（含
  `performance.now` / `new Date(`），确保存档与 Trajectory 指纹确定性；
  b) `src/render/fx-ambient/**`（纯装饰环境动效：风摆、飞鸟、涟漪、光晕呼吸、
  镜头阻尼）豁免视觉时钟与独立视觉 PRNG，严禁向 WorldState 写入任何状态。
- **labs 沙盒**：`world-client/src/labs/` 下实验原型免跑 red:first 与 screens-diff
  （跳过登记在 `scripts/red-first-lib.ts`），转正移出 labs 后再补全 EDD 评测；
  实验代码不得被生产路径 import。
- **screens-diff 5/5 锁定 `?art=0`**：pin 夹具五项判定（三组基线 0/0/0 + 两条扰动
  非零）只在程序化兜底基准模式执行，见 `check-shot-actor-pin.mjs` /
  `check-rain-pin.mjs` 头注。
- **前置 `changes` job 路径分流与装依赖前跳过**：`.github/workflows/ci.yml` 顶部新增 `changes` job（`fetch-depth: 0` + `git diff --name-only` 对比 PR base SHA，非 `pull_request` 事件全量输出 `true`），输出 `server_changed`、`client_changed`、`browser_changed`、`workflow_changed`。各下游 job（`world-client`、`browser-lanes`、`server`）通过 `needs: changes` 在 `checkout` / `setup-node` / `setup-python` / `npm ci` / `pip install` 等装依赖步骤前用 `if:` 条件短路跳过，未命中路径时直接退出 `0` 以保持必需检查全绿。
- **CI 门控瘦身**：`red:first` 仅在 `main`/`schedule` 或 `scripts/`/`test/meta/` 变更时触发；`audit:docs` 合并 4 道文档元审计；`verify-screens-diff-selfcheck` 按 `screens_diff` 路径条件触发。
- 
决策全文：`docs/adr/ADR_PRESENTATION_GATE_LAYERS.md`；规范口径见 `docs/SPEC.md`
§11.2 与 §12。

## 权限边界（远端 + 本地）

**main 已开远端分支保护（2026-11-09 起）**：必须走 PR、四项必要检查（`world-client` / `world-client-browser` / `repo-harness` / `server`）全绿才能合、禁强推、禁删除、`enforce_admins=true`（管理员不豁免）。此前"API 返回 404 所以上不了"是误判——404 的语义是「分支未受保护」，不是没权限。本地另有一道：

- `.githooks/pre-push` 拒绝任何以 `refs/heads/main` 为目标的 push（含删除远端 main）。
- 安装：`git config core.hooksPath .githooks`；自检：`npm run check:hooks`
  （仓库根目录）。**没装时这一道会安静消失**（远端仍会拒直推 main），所以这仍是一条必跑读数。
- 豁免：`PWE_ALLOW_PUSH_MAIN=1 git push <remote> <ref>:main` 只跳过**本地**这一道；
  远端保护仍会拒（`GH006`）。灾难恢复得先在 Settings → Branches 临时关掉保护，
  或者走 PR 合入。大文件检查（默认 5 MB）不受这个豁免影响；
  `--no-verify` 才会跳过整条 pre-push。
- 第二道：新增 blob ≥ `PWE_PREPUSH_MAX_BLOB_BYTES`（默认 5242880）即拒推，因为
  证据图/大快照进历史后只能重写历史才能删。确需放宽时用同名环境变量，
  **并必须在本次推送的提交说明里写明放宽到多少、为什么、谁批准的**；
  钩子看不到提交说明，这一条靠 review 核。
- review 责任落在 `.github/CODEOWNERS`；变更入口用
  `.github/pull_request_template.md`，必填「改了什么 / 为什么 / 验证命令与读数」。

## Worktree 登记

## 分支卫生与清理

分支合并即自动删远端分支（`delete_branch_on_merge=true`），例外登记与巡检见
`docs/BRANCH_HYGIENE.md`、`docs/BRANCH_EXCEPTIONS.md`；一次性的清理快照在
`docs/BRANCH_AUDIT_20261115.md`（已到期，不再随状态更新，后续看例外表与 git log）。

`docs/WORKTREES.md` 是登记表（路径 / 分支 / owner / 创建时间 / 预计回收时间 / 状态）。
`npm run worktrees:audit` 列出未登记、过期未回收、已合入但仍在的 worktree；
**只列不删**，回收由 owner 手动作业。

## 断点续跑

中断前按 `docs/RESUME.md` 覆盖写五项：最后 HEAD、未提交改动、已跑/未跑闸门、下一步命令。
恢复时先 `git status --short --branch` 与 `git log -1` 核对，再补跑记录之后改动过的闸门。

## Agent skills

### Issue tracker

GitHub Issues in `cs1lion/pixel-world-engine`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
