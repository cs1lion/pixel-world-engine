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

**这几条要一起跑，别只跑前两条。** CI 现在跑**十六道闸门**：前端 job 十五道，
服务端 job 一道。后七道（色板 + 三份审引用 + `audit-claims` + 两条指标账本）的输出
有个共同性质：**断言对不上、节号不存在、色板超预算、夹具回放漂了，全都只让输出变长，
不会让 `check`/`test` 变红。** 所以只跑前三条的人会以为自己是绿的，而后面十几道
一个都没过。完整清单以 `.github/workflows/ci.yml` 为准——那一份加了新步骤时，
这里要跟着改（`fixture:check` 就是这么漏掉的：表里没有，PR 里就红了 CI）。

| # | 闸门 | 命令（`world-client/` 下执行） | 在 CI 里 |
| --- | --- | --- | --- |
| 1 | 类型检查 | `npm run check` | 前端 job |
| 2 | 端口纪律 | `npm run audit:ports` | 前端 job |
| 3 | 基线字节自证 | `npm run audit:baseline` | 前端 job |
| 4 | 单元测试 | `npm test` | 前端 job |
| 5 | 回放夹具 | `npm run fixture:check` | 前端 job |
| 6 | 先红后绿 | `npm run red:first` | 前端 job |
| 7 | 构建 | `npm run build` | 前端 job |
| 8 | 色板预算 | `node scripts/audit-palette.mjs --strict` | 前端 job |
| 9 | 行号引用 | `node scripts/audit-references.ts --strict` | 前端 job |
| 10 | 文件引用 | `node scripts/audit-citations.ts --strict` | 前端 job |
| 11 | 节号引用 | `node scripts/audit-sections.ts --strict` | 前端 job |
| 12 | 标注断言 + ADR 字段 | `node scripts/audit-claims.ts --strict` | 前端 job |
| 13 | 指标账本口径 | `node scripts/eval-ledger.ts` | 前端 job |
| 14 | 指标账本自检 | `node scripts/verify-ledger-selfcheck.ts` | 前端 job |
| 15 | 截图比对自检 | `python scripts/verify-screens-diff-selfcheck.py` | 前端 job |
| 16 | 服务端测试 | `cd server && python -m pytest` | 服务端 job |

CI 另有一个**浏览器 job**（`test:persistence` / `test:render-budget` /
`test:building-bake` / `test:art-assets` / `test:phases`，只读、写到 runner
临时目录）。它是验收，不在这十六道计数里。

## 权限边界（本地强制）

远端分支保护 API 在本仓当前凭据下返回 404，暂时上不了；所以 main 的直推边界放在本地：

- `.githooks/pre-push` 拒绝任何以 `refs/heads/main` 为目标的 push（含删除远端 main）。
- 安装：`git config core.hooksPath .githooks`；自检：`npm run check:hooks`
  （仓库根目录）。**没装时 push 不会报错，保护会安静消失**，所以这是一条必跑读数。
- 豁免：`PWE_ALLOW_PUSH_MAIN=1 git push <remote> <ref>:main`。只给灾难恢复用；
  日常走分支 + PR。豁免**只跳过 main 保护**，第二道大文件检查（默认 5 MB）照跑；
  `--no-verify` 才会跳过整条 pre-push。
- 第二道：新增 blob ≥ `PWE_PREPUSH_MAX_BLOB_BYTES`（默认 5242880）即拒推，因为
  证据图/大快照进历史后只能重写历史才能删。确需放宽时用同名环境变量，
  **并必须在本次推送的提交说明里写明放宽到多少、为什么、谁批准的**；
  钩子看不到提交说明，这一条靠 review 核。
- review 责任落在 `.github/CODEOWNERS`；变更入口用
  `.github/pull_request_template.md`，必填「改了什么 / 为什么 / 验证命令与读数」。

## Worktree 登记

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
