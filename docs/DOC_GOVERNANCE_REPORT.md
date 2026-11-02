# 文档治理执行报告

- 分支：`feat/creator-engine-wire`
- 执行起点：`bc8a5e0`
- 执行完 HEAD：`55a9af1`（随后只追加本报告）
- 执行方式：每步一笔提交；未 merge、未 push、未开 PR。`main` 上的两处过期断言按约定未动。

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

- 标记语法 `<!-- claim: name=value -->`；探针是闭集（测试文件数、`CURRENT_SCHEMA_VERSION`、ADR 数、SPEC 唯一性、iterations 入库数），**不接受任意 shell**。
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
| `audit-citations --strict` | 2229 处受查 0 未解析 |
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
