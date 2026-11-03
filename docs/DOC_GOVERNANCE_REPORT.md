# 文档治理执行报告

- 分支：`feat/creator-engine-wire`
- 执行起点：`bc8a5e0`
- 执行完 HEAD：`55a9af1`（随后只追加本报告）
- 执行方式：治理阶段每步一笔提交、未 merge、未 push、未开 PR；`main` 上的两处过期断言在治理阶段按约定未动。随后按用户指示合入 `main`，见第七节。

## 一、提交清单

| 步骤 | 提交 | 做了什么 |
| --- | --- | --- |
| P0 | `4ad2ccb` | `SPEC.md` 为唯一权威；`SPEC_V2` 冻结归档；v2 内容收入 §8–§15；三入口统一 |
| P1 | `251a7ca` | 8 份 ADR 加 `status / verified_at / evidence` |
| P2 | `30477b5` | iterations 补实现状态列、18 节映射表，删掉“没有实现”的过期陈述 |
| P3 | `8f3aba5` | 新增 `audit-claims`；5 个标注式断言；已知假话清零 |
| P4 | `8fe3517` | 服务端依赖加上界；分支清理前置与 4 个本地已合并分支删除 |
| P5 | `29597bd` | 输出路径可配置；CI 加 audit-claims 与浏览器 job |
| P6 | `55a9af1` | 处理 P0 吸收 v2 后触发的两处联动断言（见第三节） |

## 二、逐项执行

### P0 权威入口唯一化

- `docs/SPEC_V2.md` 只加归档横幅（4 行），正文与旧节号未动，152+ 处 `SPEC_V2 §N` 仍可解析。
- `docs/SPEC.md` 追加第二部：§1–§8 → §8–§15、§4.1–§4.10 → §11.1–§11.10；顶部 8 行映射表；原 §1–§7 标题未改。
- `CLAUDE.md`、`README.md`、`docs/agents/domain.md` 三入口写死“唯一权威 + 禁止新增 `SPEC_*`”，README 最后一句“v1 定稿”已删。
- 验证：`audit-sections` 155 处全对；`audit-citations` 0 未解析；`git diff docs/SPEC.md` 只新增 §8–§15 标题。
- P0-4 的机器守卫并入 P3 的 `audit-claims`（`spec-authority` 探针：恰好 3 个 SPEC，唯一 `唯一权威` 是 `SPEC.md`，`SPEC_V2` 含“历史归档”）。

### P1 ADR 证据状态

按用户拍板采用 `status / verified_at / evidence`，AI **只填 `pending-review`**。8/8 份都写了具体代码/测试路径：

- 补记候选：`ADR_SAVE`、`ADR_WORLD_ALIVE`、`ADR_PALETTE_24`、`ADR_PACK_SKIPS_WORLD_BUDGET`。
- 复核候选：`ADR_MEMORY`、`ADR_DEFAULT_PACK_BYPASS`、`ADR_WORLD_FACTS_SOURCE`、`ADR_BUILDING_AT_OPTIONAL`。

验证：`status` 8/8 合法、`verified_at` 8/8、`evidence` 路径全部存在；`audit-claims` 的 `adr-schema: files=8 valid=8`。

### P2 迭代文档实现状态

- `docs/iterations/1027-task-1/README.md`：删掉“没有实现”的过期句子，补 18 节 → 模块/测试映射表（§14 标“部分”、§18 标“不适用”）。
- `docs/iterations/README.md`：索引加“实现状态”列：任务 1 已实现（22 模块 / 36 相关测试），任务 2 部分实现（仅 feat 分支，main 未合入）。
- `docs/iterations/1027-task-2/README.md`：标“部分实现，仅 feat 分支”。
- `issue-bright-shallow.md` 复核后保留现状：它已写明“原来的无解前提是假的”，无需再改。
- 验证：`memory_modules=22`、`memory_tests=36`；`git grep '没有任何实现已开始'` 0 命中。

### P3 `audit-claims` 与假话清零

实现 [audit-claims.ts](../world-client/scripts/audit-claims.ts)：

- 标记语法是 HTML 注释里的 `claim: name=value`（两侧分别是 `<!--` 与 `-->`，此处故意不写成完整注释，避免本报告自身被当成一条真标记）；探针是闭集（测试文件数、`CURRENT_SCHEMA_VERSION`、ADR 数、SPEC 唯一性、iterations 入库数），**不接受任意 shell**。
- 输出 `claims: markers / passed / failed`；0 标记也会提示“不是全绿”。
- 同时校验 8 份 ADR 的三字段与 evidence 路径存在性。
- 接上 5 个标记：README 测试文件数、SETTING 存档版本、SPEC 唯一权威、ADR 总数、iterations 入库数。

已知假话处理：

| 项 | 处理 |
| --- | --- |
| iterations “没有实现已开始” | 已改（P2） |
| BRANCH 摘要旧 HEAD `4d4e309` | 改为“写作快照”，不再冒充当前 HEAD |
| `audit-sections.ts` “iterations 从未入库” | 改为“已入库 12 个文件” |
| `memory/index.yaml` 过期派生值 | 按 entries/characters 实际文件更新为 1 / [0,1] / [莞尔]，并注明 days/characters 目前没有自动写入方 |
| README 两组通过数 | 补“feat 分支快照 `4d4e309`、同日 docs 提交未改数字” |
| `main` README 160 / SETTING v3 | **按约定未动**，合入后处理（见“待确认”） |

反证：把 README 的 `test-file-count` 改成 186 → `audit-claims` exit 1，报“实际是 187（期望 186）”；改回后 exit 0。

### P4 样例、分支与卫生

- `docs/save-v5.sample.json` 的 `schemaVersion=5` 与 `CURRENT_SCHEMA_VERSION=5` 一致；`save-fingerprint` 24 项通过。
- 分支前置（只读）：4 个分支均 `--merged main`、`main..分支` 为空；有上游的 `feat/oracle-whitelist` / `feat/tide-override-storm` 均 0 未推送；`cindy/zealous-jang` 在独立 worktree。
- 用 `-d` 删除：`backup-before-fix`、`feat/oracle-whitelist`、`feat/tide-override-storm`、`feat/world-reads-event-log`。
- 保留：`feat/creator-engine-wire`（未合入）、`fix/memory-persistence-docs`（feat 合入后再删）、`cindy/zealous-jang`（另一会话 worktree）、`main`。
- `server/requirements.txt` 全部加上界：`fastapi>=0.110,<1.0`、`uvicorn>=0.27,<1.0`、`starlette>=0.40,<2.0`、`pytest>=7.4,<9.0`、`httpx>=0.27,<1.0`、`pyyaml>=6.0,<7.0`；`pip install --dry-run` 通过；README 写明 CI 只有这一层安装。
- 删除根目录 0 子项的空 `node_modules`。

### P5 CI

- `smoke.mjs` / `check-phases.mjs`：`EVAL_OUT` 可覆盖，默认不变；`accept-live.mjs`：`EVAL_LIVE_OUT` 可覆盖。
- `world-client` job 增加 `node scripts/audit-claims.ts --strict`。
- 新增 `world-client-browser` job：build → preview 5188 → persistence → render-budget → phases；`EVAL_OUT` 指向 runner 临时目录，末尾检查工作区为空。
- 不进 PR：`test:browser`/smoke、`test:live`、`test:setting`、`test:buttons`。
- 顺带修 `check-persistence.mjs` 的“存档是当前版本 v3”为与 `saveStatus().schemaVersion` 对齐（它要钉“当前版本”，不是历史 v3）。
- 验证：`test:phases` 17 项、`test:persistence` 8 项、`test:render-budget` 6 项全过；`EVAL_OUT` 指到 TEMP 后 `eval/` 无改动；CI YAML 解析出 3 个 job。

## 三、全量验证（合入前）

| 命令 | 实际输出 |
| --- | --- |
| `npm run check` | `check-types：语法 0 处 / 语义 0 处` |
| `npm test` | `# tests 1879 / # pass 1870 / # fail 0 / # skipped 9 / # todo 0` |
| `npm run build` | `dist/assets/index-BU5AYBCL.js 1,530.68 kB │ gzip: 426.63 kB`、`✓ built in 631ms` |
| `python -m pytest` | 497 collected / 1 skipped / exit 0（输出无 failed） |
| `npm run test:browser` | `神谕闭环：124 项通过` |
| `node scripts/check-phases.mjs` | 17 项通过 |
| `node scripts/check-persistence.mjs` | 8 项通过 |
| `node scripts/check-render-budget.mjs` | 6 项通过 |
| `audit-palette --strict` | 0 超预算 |
| `audit-references --strict` | 141 处行号引用 0 存疑 |
| `audit-citations --strict` | 2249 处受查 0 未解析（含本报告） |
| `audit-sections --strict` | 155 处全对 |
| `audit-claims --strict` | `claims: markers=5 passed=5 failed=0`；`adr-schema: files=8 valid=8` |

## 四、待你确认

1. **ADR 签字**（当前全为 `pending-review`，AI 未升 `aligned`）：
   - 建议签 `backfilled`：`ADR_SAVE`、`ADR_WORLD_ALIVE`、`ADR_PALETTE_24`、`ADR_PACK_SKIPS_WORLD_BUDGET`（证据：补记提交 + 对应代码/测试路径）。
   - 建议复核后签 `aligned`：`ADR_MEMORY`、`ADR_DEFAULT_PACK_BYPASS`、`ADR_WORLD_FACTS_SOURCE`、`ADR_BUILDING_AT_OPTIONAL`。
2. **分支**：4 个本地已合并分支已按 `-d` 删除；`origin/feat/oracle-whitelist`、`origin/feat/tide-override-storm` 的远端删除需要你决定（本任务不 push）。`fix/memory-persistence-docs` 等 feat 合入 main 后再删。
3. **CI 影响**：新增的 `world-client-browser` job 会多一次 Playwright 安装与 preview 启动（约 1–2 分钟），三道判据目前稳定；`audit-claims` 目前只覆盖 5 条已知断言，误报率待观察。
4. **合入 `main` 后必须复核**：
   - `README.md` 的“160 个测试文件” → 合入后实际值（当前 feat 为 187）。
   - `docs/SETTING_DENGCHAO.md` 的“存档 v3” → 合入后实际版本（当前 feat 为 v5）。
   - `main` 是否还有其它只在 main 上成立的过期数字；合入后用 `audit-claims` 标记接住，不要凭记忆改。
5. **未做项（需人工）**：`world-client/.git` 嵌套克隆（需备份后确认无独有提交再移除）、`resume-v3/`（归属未确认）、`tmp/`（保留本次证据，未全清）；远端分支删除。

## 五、与计划不符/未完成的地方

- 计划里的 `docs/claims/claims.yaml` 台账没有采用：用户拍板了“标注式断言”，所以改为文档内 `<!-- claim: ... -->` + 固定探针；没有自然语言判断。
- `audit-claims` 不支持 `--ref <commit>` 与 `--stale-days`：当前只对工作区复算；CI 用法是 `--strict`。这是为了让第一版收敛，未假装已覆盖历史快照。
- P4 的嵌套 `.git`、`resume-v3`、`tmp`、远端分支删除未执行，原因见上；没有为了“清干净”而删除归属不明的东西。
- `main` 的两处过期断言按指令未动。

## 六、自检

一个没跟过这轮对话的人，读完应能回答：哪份文档是权威（P0）、ADR 为什么都是 `pending-review`（P1）、迭代文档实现到哪（P2）、哪些假话被机器接住（P3）、哪些分支被删/保留（P4）、CI 多了什么（P5），以及合入 `main` 后还有哪两处要复核。

## 七、合入 `main`

### 7.1 合入清单（合入前，`main` 为 `ef4d6ff`）

| 项 | 值 |
| --- | --- |
| `git rev-list --count main..feat/creator-engine-wire` | 24 笔提交 |
| `git diff --shortstat main...feat/creator-engine-wire` | 68 个文件，+5980 / −463 |
| 冲突文件 | 无。`git merge-tree --write-tree main HEAD` 写出 tree `3efc5e4` 且 exit 0 |
| `fix/memory-persistence-docs` 关系 | `git rev-list --count HEAD..fix/...` = 0，已完整包含在 feat 中 |
| `main` 与 `origin/main` | 合入前本地 `main` 已领先远端 6 笔（均未 push） |

### 7.2 合并提交

用 `git merge --no-ff`（未 squash、未 push、未开 PR）生成合并提交 `ffa3681`，提交信息分四块写明：记忆持久化 v5、外环接线、浏览器闸门修复、文档治理。随后为把本节写进本报告的对齐提交，HEAD 因此再前移一笔（合并提交本身仍是 `ffa3681`）。

`git log --oneline` 关键几行（合入后）：

```text
ffa3681 merge(feat): 外环造物接线并入 main（记忆持久化 v5 / 外环接线 / 浏览器闸门修复 / 文档治理）
5f65980 fix(docs): 报告里的标记语法示例不再写成完整注释
5fe1aac docs: 文档治理执行报告（P0–P6 提交、全量验证与待人工确认项）
55a9af1 fix(docs): 处理 P0 吸收 v2 触发的两处联动断言
29597bd ci: 浏览器闸门输出可配置，并把 persistence/render-budget/phases 与 audit-claims 接进 CI
```

### 7.3 `main` 上两处过期断言的实际处理

先核对了合入前 `main`（`ef4d6ff`）的原始文本：

- `README.md`：`└── test/ 160 个测试文件`。
- `docs/SETTING_DENGCHAO.md`：`存档 schema 仍是冻结的 v3`。

合入后这两处**已经由 feat 的内容取代**，没有需要再改的数字：

- `README.md:31` 已是“187 个测试文件”，并带 `claim: test-file-count=187` 标记（完整注释形式，P3 提交带上来的）。
- `docs/SETTING_DENGCHAO.md:172` 已是“当前的 v5”，并带 `claim: save-schema-version=5` 标记。

因此本步没有“改数”，而是核实“合入是否已经把假话换掉”，并用 `audit-claims` 接住：`claims: markers=5 passed=5 failed=0`。仍按合入后的现实改了三处**措辞**（不是数字）：README 的“feat 分支快照 `4d4e309`”改为“合入 main 之后”；迭代索引与任务 2 的“仅 feat 分支 / main 未合入”改为“已合入 main”。

### 7.4 合入前后全量验证对比

| 命令 | 合入前（`5f65980`） | 合入后（`ffa3681` + 文档措辞修改） | 差异 |
| --- | --- | --- | --- |
| `npm run check` | 语法 0 / 语义 0 | 语法 0 / 语义 0 | 无 |
| `npm test` | 1879 tests / 1870 pass / 9 skip / 0 fail，90.2s | 1879 / 1870 / 9 / 0，101.4s | 数量一致；耗时差属机器波动 |
| `npm run build` | 1,530.68 kB，gzip 426.63，593ms（产物哈希 BU5AYBCL） | 1,530.68 kB，gzip 426.63，635ms（哈希仍是 BU5AYBCL） | 产物内容未变；耗时波动 |
| `python -m pytest` | 496 passed / 1 skipped，6.36s | 496 passed / 1 skipped，7.69s | 数量一致；耗时波动 |
| `npm run test:browser` | 124 项通过 | 124 项通过 | 无 |
| `test:phases` | 17 项通过 | 17 项通过 | 无 |
| `test:persistence` | 8 项通过 | 8 项通过 | 无 |
| `test:render-budget` | 6 项通过 | 6 项通过 | 无 |
| `audit-palette --strict` | 0 超预算 | 0 超预算 | 无 |
| `audit-references --strict` | 141 处 / 0 存疑 | 145 处 / 0 存疑 | 本报告新增 4 处行号引用 |
| `audit-citations --strict` | 2249 处 / 0 未解析 | 2251 处 / 0 未解析 | 本报告新增 2 处引用 |
| `audit-sections --strict` | 155 处全对 | 155 处全对 | 无 |
| `audit-claims --strict` | markers=5 passed=5 failed=0；ADR 8/8 | 同左 | 无 |

合入后的浏览器命令都把 `EVAL_OUT` 指到 `tmp/eval-postmerge`，`git status` 只剩文档改动，没有截图脏提交。

### 7.5 分支清理与关系

- 已删除：`fix/memory-persistence-docs`（已完整合入 `main`，`git branch -d` 成功）。
- 保留：`feat/creator-engine-wire`（指向 `5f65980`，已完整合入 `main`；`git branch -d feat/creator-engine-wire` 可以安全执行，本步未删，留给用户决定是否保留这个指针）。
- 保留：`cindy/zealous-jang`（在独立 worktree，属另一会话，不动）。
- `main`：相对 `origin/main` 的领先笔数 = 合入前就未推的 6 笔 + 本次 feat 的 24 笔 + 合入后的文档对齐提交（笔数以 `git rev-list --count origin/main..main` 现查为准，不在此写死）。本次合入本身为 68 个文件 +5980/−463。**未 push、未删任何远端分支。**

### 7.6 风险与合入后仍需复核

1. **远端仍是旧世界**：`origin/main` 没有任何一笔合入的提交。未 push 前，GitHub 上的 CI 不会跑新增的 `audit-claims` 与 `world-client-browser` job；这两个 job 目前只在本地按同样步骤人工跑过。
2. **机器接住的只有这五条**：测试文件数（187）、ADR 数（8）、存档版本（5）、SPEC 权威、iterations 入库数。README 里的 `1870 通过 / 9 跳过 / 496 pytest` 仍是快照数字，没有 claim 标记；下一次跑数变化时它们会再漂，是否给通过数也加探针需要你定（通过数依赖运行环境，探针要设计成“跑一次测试”而不是数文件）。
3. **`main` 上此前没人碰过的过期引用**：`docs/MIGRATION_FROM_XIAOXI.md:93` 的“升存档 v3”是历史迁移步骤，不是现状断言，未改；`world-client/src/world/simulation.ts:704` 的注释“水位不落档”是旧版本号标签，“水位不落档”这个事实仍成立，但标签已过期，属代码注释，未在本轮改。
4. **合入后已失效的行为**：`feat` 分支不再是“未合入”状态，任何仍写“仅 feat / main 未合入”的文档都变成假话；本轮已改迭代索引与任务 2 两处，报告内 P2 段的历史描述保留原文并以此节为准。
5. ADR 仍是 8 份 `pending-review`，没有因为合入而升级；升级仍需人签字。

### 7.7 现在才可做的事

- push `main`（需要你明确同意；本轮不做）。
- 在远端第一次跑新 CI，观察 `world-client-browser` 的稳定性。
- 给 8 份 ADR 签字（`backfilled` / `aligned`）。
- 删除已被合入的远端分支（`origin/feat/oracle-whitelist`、`origin/feat/tide-override-storm`），需要远端写权限，本轮不做。
- 后续功能从 `main` 起新分支；`feat/creator-engine-wire` 只作为历史指针保留。
