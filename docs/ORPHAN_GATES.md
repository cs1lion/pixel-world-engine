# 孤儿闸门检测

一句话：回答「仓库里哪些检查脚本没有任何东西在跑」，并在**新增**一个没人调用的检查时变红。

## 三关（判据）

### 关 1：什么算「检查」

两个判据，任一命中即算，不靠模糊匹配：

1. 路径是任意 `scripts/` 目录下的 `check-*` 或 `audit-*`，扩展名 `.mjs` / `.ts`。
   只认 `scripts/` 的直接子文件，不向下递归。
2. npm 脚本名以 `test:` / `audit:` / `fixture:` / `check:` / `baseline:` 开头。
3. 允许清单里的 `extraChecks` 列出的 `file:` 条目如果指向 `scripts/` 下真实存在的 `.py` / `.mjs` / `.ts` / `.js`，也会被登记为检查。这是「盲区候选归类」的入口：python 与 `verify-*` 这类不按 `check-*` / `audit-*` 命名的脚本，只有写进 `extraChecks` 后才进入检查域；`entries` 只负责孤儿豁免，不负责命名。接线后从 `entries` 删条，但仍留在 `extraChecks`，所以检查总数不会因为接线反而变小。

不算检查：普通测试文件（`*.test.ts`）、不带这些前缀的 npm 脚本（如 `build`、`preview`、`worktrees:audit`）。

### 关 2：什么算「有消费方」

从 `.github/workflows/*.yml` 的 `run:` 出发，沿下面三条边可达即算：

1. workflow 的命令里出现 `npm run X` / `npm test` / `node scripts/...`。
   支持单行 `run:` 与 `- run: |` 多行块；`#` 开头的注释行不计。
2. 被调用 npm 脚本的体内再出现 `npm run Y` / `node scripts/...`。
3. 已到达的 JS/TS 文件用相对路径 `import` / `import()` / `require` 到的文件，逐跳追。

支持 job 级与 step 级 `working-directory`。除 `node` 外，也认 `tsx` / `npx [--flag] tsx` / `npx ts-node` / `python` 这几种命令形态，以及一层本地 composite action（`uses: ./.github/actions/<name>` → 该目录的 action 元数据里 `runs.using: composite` 的 `steps[].run:`）。
其中 `node` / `tsx` 目标与 composite 里的 JS/TS 目标照常算消费方；`python` 目标和不符 `check-*` / `audit-*` 命名的脚本不改变孤儿总数，只进「盲区候选」（见「已知边界」）。

**消费方还必须能判红**：`continue-on-error: true`、`if: false`、命令里的 `|| true` 会让失败穿过 CI，一律不算消费方（job 级同名字段同理）。`scripts/orphan-gates-selftest.mjs` 用 5 条用例钉住这个口径（一条正面对照 + 四条反例）。

### 关 3：允许清单

`scripts/orphan-gates-allowlist.json`。每条必须写：

- `id`：`file:<相对路径>` 或 `npm:<包>#<脚本名>`；
- `kind`：必须是下面四类之一（规则写死，不看印象）：
  - `pending-ci`：脚本有**客观 pass/fail**（失败会 exit 非 0），只缺环境（preview / 浏览器 / 服务 / 预期失败步骤）；
  - `manual`：有**判据**但需要**人在场干预**、无法无人值守（先 stash `src/`、一次性取证）；
  - `report`：**纯输出、没有可自动判定的红绿**——读数与图只供人看或供别的工具消费，它不是闸门，不设 exit 非 0；
  - `obsolete`：判据已失效或冗余，**应该删**。
- `reason`：这个检查是什么；
- `acceptedBecause`：现在为什么可以不接；
- `blockedBy`：卡在什么上（manual 写清为什么只能人工，pending-ci 写清接闸的阻塞项，report 写一行「为什么它不是闸门」，obsolete 写删除建议）。

「暂不接」不是债务描述。四类各自有**等值预算**（`pendingCiBudget` / `manualBudget` / `reportBudget` / `obsoleteBudget`）：实际条数必须与预算完全相等，多一条少一条都红。
输出会把四个数字分开打：`pending-ci M / manual N / report P / obsolete K`；`report` 与 `obsolete` 各另起一节，`report` 逐条给「为什么它不是闸门」一行。

以下情况直接红：

1. 有孤儿没登记；
2. 清单指向不存在的检查（防止清单自己烂掉）；
3. 清单条目已经有了消费方（说明该删了，不能让「临时接受」变成永久挡箭牌）；
4. 缺 `kind` / `reason` / `acceptedBecause` / `blockedBy`，`kind` 不在四个枚举内，或重复登记；
5. 四类条数中任何一类不等于自己的预算（`pendingCiBudget` / `manualBudget` / `reportBudget` / `obsoleteBudget`）；新增条目没同提交 +1、删条目没同提交 −1、改 `kind` 没同步两边，都会红；
6. `budgetLedger` 缺失、末条计数与预算不一致，或任一条缺 `approved_at` / `approved_by` / `reason`。

### 债务棘轮

顶层四个预算是显式数字，且都是**等值断言**：`pending-ci` 条数必须等于 `pendingCiBudget`，`manual` 必须等于 `manualBudget`，`report` 必须等于 `reportBudget`，`obsolete` 必须等于 `obsoleteBudget`。多一条不加预算会红，删一条不降预算也会红；改 `kind` 会让两边同时不相等，因此不能靠改分类绕过。

任何预算变更（新增/删除条目、`kind` 迁移）都必须在**同一提交**里往 `budgetLedger` 追加一条记录，写清 `approved_at`（`YYYY-MM-DD`）、`approved_by`、`reason`，以及变更后的四个条数；`budgetLedger` 末条的四个计数必须与四个预算一致（四类之前的旧记录没有 `report` 计数，历史不追改，但末条必须补齐）。CI 在中间提交上就会红，所以「先加条目、以后补预算」走不通，效果上等价于同一提交。

当前 `pendingCiBudget = 29`、`manualBudget = 2`、`reportBudget = 5`、`obsoleteBudget = 1`（`pending-ci 29 / manual 2 / report 5 / obsolete 1`）。原值 27，2026-11-07 连降三轮：27→24，`check-lamp-band` / `check-lamp-pool` / `check-rain-pin` 按关 3 的规则没有客观 `exit` 非 0，改归 `manual`，不再计入 `pending-ci`；24→21，`check-ground-shadow` / `check-shot-actor-pin` / `check-phases-negative` 接进 workflow，同提交删条；21→19，npm 别名 `test:lamp-band` / `test:lamp-pool` 跟着本体改 `manual`——别名和本体必须同一 `kind`，不能一个 `pending-ci` 一个 `manual`。同一轮总检查数从 49 变 50（合入 main 的 `00d3121` 带来 `check-glow-contrast`，它已明确「不是闸门，也不在 CI」，只能登记为 `manual`），所以 `manual` 从 2 变 8。同一天把 7 条盲区候选按有无客观判红归类：3 条 python 读数脚本 → `manual`（8→11），4 条有客观退出码的 `screens-diff` / `verify-*` → `pending-ci`（19→23）；它们按关 1 第 3 条登记，检查总数 50→57，已知孤儿 28→35。随后两批接线各删条：`verify-ledger-selfcheck.ts` → 23→22；`verify-screens-diff-selfcheck.py` 与 `screens-diff.py` → 22→20。`verify-animation-baseline.mjs` 仍留 `pending-ci`：CI 里它必被 `when` 跳过（路径指向 `pwe-anim`），接进去也是假绿。2026-11-08 撤回 `check-ground-shadow` 接线，20→21：30 轮实测 4 红（13.3%，Wilson 5.3%–29.7%），红因首张同刻图抓拍早于调色收敛，修法是 `shotStable`（连续 8 帧逐字节相同才允许比较）；**撤回理由：随机红会训练人忽略红**。脚本自身的 `PEAK_CEILING = 34,666` 不动。随后合并收尾（2026-11-08）把 `fixture:check` 接进 `world-client` job 并删条，21→20；skill 线 4 条只读审计（2 个脚本 + 2 个 npm 别名）按命名规则登记为 `manual`，11→15。两项共用一条 `budgetLedger` 终态记录（`pendingCi 20 / manual 15 / obsolete 1`）。2026-11-08 再撤回 `check-shot-actor-pin` 接线，20→21：CI main `d03f9d5` / run `42397872873` 上 `five-2800 ≠ five-1200`；本机 30 轮（idle/load 交替）0 红、三档同一哈希，根因未证，故不满足「加 `shotStable` 前提」的门槛。**撤回理由：随机红会训练人忽略红。** 2026-11-08 `manual` 语义重定义（四类）：`manual` 收窄成「有判据但需人在场/preview、无法无人值守」，15→2（只剩 `check-setting-scale.mjs` 与其 npm 别名，改前图必须先 stash `src/`）；有 exit 判红路径的 8 条迁 `pending-ci`（21→29）：`check-lamp-band` / `check-lamp-pool` 及两个 npm 别名、`audit-skill-docs` / `audit-verify-flows` 及两个 npm 别名；纯输出无判据的 5 条新立 `report`（0→5）；`obsolete` 不变。这一笔只动分类与账本，不动任何判据阈值。

这套机制拦得住：新增/删除条目却不调整预算；改 `kind` 静默迁移；抬预算不留审批记录；「先记账、后补预算」的跨提交操作（CI 会在中间提交红）。
拦不住：`budgetLedger` 是当前状态的账，不是 git 历史审计——有人可以把旧记录改写而不是追加，CI 只能看到改写后的自洽状态；也拦不住审批字段填得敷衍（`approved_by: "x"` 仍能通过），那要靠评审。

### report：五条「不是闸门」的东西

`report` 的判据只有一条：**没有可自动判定的红绿**。下面 5 条都登记为 `report`，各占一行理由（这一行同时写进允许清单的 `blockedBy`，由 `audit-orphan-gates` 原样打印）：

| 条目 | 为什么它不是闸门 |
| --- | --- |
| `file:world-client/scripts/check-rain-pin.mjs` | 只拍图与读数、退出码恒 0；配对判据在 `screens-diff.py`，不在这里 |
| `file:world-client/scripts/check-glow-contrast.mjs` | 只输出读数、不设 exit 非 0；D 已论证不可按当前测量标定（K6），要成为闸门须先补齐 K6 缺项 a–e 并定出阈值 |
| `file:world-client/scripts/homecoming-analyze.py` | 没有 `sys.exit` / `SystemExit`、退出码恒 0，只能人工看图；要成为闸门须先定出包围盒/色数阈值并补 exit 路径 |
| `file:world-client/scripts/interior-analyze.py` | 没有 `sys.exit` / `SystemExit`、退出码恒 0，只能人工看图；要成为闸门须先定出房间包围盒/冻结差阈值并补 exit 路径 |
| `file:world-client/scripts/material-analyze.py` | 没有 `sys.exit` / `SystemExit`、退出码恒 0，只能人工看图；要成为闸门须先定出纹理能量/重复率阈值并补 exit 路径 |

它们是**被观察**，不是**被信任**：读数变了不会红，只有人看图才知道。

## 命令与输出

```bash
npm run audit:orphan-gates
```

输出分节：**有消费方**（附消费路径）、**已知孤儿（允许清单）**、**report（只输出，无判据）**、**obsolete（应删）**、**新孤儿（未登记）**、**允许清单问题**、**盲区候选（只发现，不判红）**，最后是**债务读数**。
已知孤儿会按 `pending-ci M / manual N / report P / obsolete K` 四数分开计数；债务行打印 `pending-ci X / 预算 Y；manual … / 预算 …；report … / 预算 …；obsolete … / 预算 …`（四类都是等值断言），`report` 逐条打印「为什么它不是闸门」，`obsolete` 逐条给删除建议。
没有未登记孤儿且清单自洽时退出 0，否则退出 1。

## CI

`.github/workflows/ci.yml` 的 `repo-harness` job 两步：`npm run audit:orphan-gates`，以及 `node --test scripts/orphan-gates-selftest.mjs`。只用 node 内置模块，不需要 `npm ci`、不需要浏览器。

自检 17 条：正面对照、三种伪消费方（`continue-on-error: true` / `|| true` / `if: false`）、job 级 `continue-on-error`、新孤儿探针、四条预算反例（新增 `pending-ci` 不抬预算、新增 `report` 不抬 `reportBudget`、抬预算缺审批字段、改 `kind` 绕预算）、五条盲区解析用例（python 步骤、python 静态 `.py` 路径、`npx --yes tsx`、一层 composite action、静态 `child_process` 字面量数组），以及两条「清单登记入口」用例（`extraChecks` 把不按 `check-*` / `audit-*` 命名的脚本登记成检查、登记后的 python 检查被 workflow 直连时必须判红）。

具体读数不写死在文档里（它会随检查数增长）：第一次运行的完整清单见引入这个闸门的提交说明。

## 已知边界（盲区候选怎么用、什么不做）

`[盲区候选（只发现，不判红）]` 是**发现**，不是判定：本段不进入 exit code、不改分类、不改预算。检测器只把「清单之外、又不按 `check-*` / `audit-*` 命名」的东西列出来，并按一条依据给建议 `kind`：能不能给出客观的 `exit` 非 0。归类、账本条目与预算由 owner 单独决定。

能机械判、已经做了：

| 形态 | 处理 |
| --- | --- |
| workflow / npm 脚本里的 `python scripts/xxx.py` | 进盲区候选；含 `SystemExit` / `sys.exit` → 建议 `pending-ci`，否则建议 `manual` |
| `tsx` / `npx [--flag] tsx` / `npx ts-node` 目标 | 与 `node` 同权，算消费方（前提是它符合 `check-*` / `audit-*` 命名） |
| 一层本地 composite action 的 `run:` | 与 workflow step 同权；尊重 step 级 `continue-on-error` / `if: false` |
| JS/TS 里的 `child_process` + 字面量数组（`['scripts/check-x.mjs']`） | 只进盲区候选，不判红 |
| python 里的同目录静态 `.py` 字面量（`DIFF = HERE / "screens-diff.py"`） | 只进盲区候选，不判红 |
| `scripts/` 下所有 `.py` | 全部列进盲区候选；没人引用的标「仅文档手动命令」 |

明确不做，以及为什么不做：

- **`child_process` 拼字符串 / 变量展开的路径**（`spawnSync(cmd, [join('scripts', name)])`、`path.resolve(...)`、模板字符串）：静态分析只能猜，猜错会给出假消费方或假候选，比漏报更糟。要进闸就把目标写死成字面量，或由人登记。
- **`python -m` / `python -c` / `pipx` / `uv run` 等间接入口**：命令里没有可解析的 `.py` 路径，同理不猜。
- **嵌套 composite action**（composite 里再 `uses:` 另一个本地 action）：只解析一层；再往下追要在 YAML 层做递归解析，收益小于维护成本。
- **跨仓库 / 远端 action**（`uses: owner/repo@vN`）：代码不在本仓库，检测器无从判断它跑了什么。
- **`npx` 安装的包内部调用**（`npx some-cli` 内部再 spawn 的脚本）：入口在 `node_modules`，不是本仓库的检查。
- **`scripts/` 之外的 python / JS**（`server/**`、`docs/evidence/**`）：属于应用代码或一次性取证脚本，不在「检查」的命名域内；例如 `docs/evidence/pin-shots/reverse-structure-check.py` 只在文档里登记。
- **`package.json` 里用 shell 变量 / `npm_lifecycle_event` 动态拼出的脚本体**：同上，不猜。

判断标准：**做不了的部分要能一眼看出「这里没查」**。所以输出保留「仅文档手动命令」这类明确措辞，不让候选列表看起来像全量覆盖；新增候选也**不会**自动变红，必须先由 owner 决定 `kind`、补账本条目、同步预算。一旦在允许清单里登记，它就从候选列表消失，改由关 3 的三类预算与账本管理。

## 消费方出现后必须删条目（这是设计，不是故障）

清单条目一旦被接进 workflow、被 npm 脚本调用或被 import，必须在**同一提交**里删掉；否则 `audit-orphan-gates` 会红。
这是设计预期：清单只记录「还没人跑」的东西，不记录「正在跑」的东西。
例如某条 `pending-ci` 在另一条分支被接进 workflow：合并那一刻，那条改动给它接上消费方，CI 会先红一次；正确动作是删掉清单条目，而不是放宽判据。这次红是预期，不是故障。

## 已接线：`fixture:check`（随 2026-11-08 合并收尾落地）

已随收尾提交接进 CI，三步同提交完成：

1. 改 `.github/workflows/ci.yml` 的 `world-client` job（**不是** `world-client-browser`；`scripts/fixture-check.ts` 只读文件与内存重放，不连 preview、不需要浏览器），在 `- run: npm test` 之后加了一行：

   ```yaml
       - run: npm run fixture:check
   ```

   `world-client` job 已有 `working-directory: world-client`，`npm run fixture:check` 解析为 `node scripts/fixture-check.ts`，不用再写路径。没有加 `continue-on-error`、没有写 `|| true`、没有用 `if: false`——关 2 会把这些接线判成「无有效消费方」。
2. 同提交删掉了允许清单里的 `npm:world-client#fixture:check` 条目，`pendingCiBudget` 21→20，并往 `budgetLedger` 追加一条终态记录；同一提交还登记了 skill 线的 4 条只读审计为 `manual`（11→15），所以末条读数是 `pendingCi 20 / manual 15 / obsolete 1`。
3. 自证（原始输出见提交说明与合并报告）：
   - `world-client/` 下按 CI 形态跑 `npm run fixture:check`：6 条夹具 / 195 项断言，6 通过 / 0 失败，`exit 0`。
   - `node scripts/audit-orphan-gates.mjs`：`[有消费方] 26`、`[已知孤儿] 36（manual 15 / pending-ci 20 / obsolete 1）`、`[新孤儿（未登记）] 0`、债务三类等值、`exit 0`。
   - 反向证据：新加的那行若带 `|| true`，`npm:world-client#fixture:check` 会被重新判成「无有效消费方」；这条已由 `scripts/orphan-gates-selftest.mjs` 的 `|| true` 用例覆盖，提交说明点名该用例。
   - `git status --porcelain` 为空：fixture 校验只读，不写脏仓库。

**接不上时**：若 `fixture:check` 非全 PASS 或 `exit` 非 0，停下并回到本节，不要用放宽 `fixture:check` 判据或 `continue-on-error` 换绿。

## 已撤回：`check-shot-actor-pin`（2026-11-08）

它曾接在 `world-client-browser` 的同一 step 里（紧邻 `check-phases-negative`）。撤回只删那一行，同 step 的其它闸门与 `check-phases-negative` 不动，也没有加 `continue-on-error` / `|| true`。

1. 允许清单回填 `pending-ci` 条目；`pendingCiBudget` 20→21；同提交追加 `budgetLedger` 末条（`pendingCi 21 / manual 15 / obsolete 1`，与三个预算一致）。
2. 撤回依据：CI main `d03f9d5` / run `42397872873` 上 `five-2800 ≠ five-1200`（日志：冻结前世界分别是 301 / 302 / 303 分）。**撤回理由：随机红会训练人忽略红。**
3. 本机量化（同一台机器，30 轮，idle / load 交替）：`exit 0` 30 / 30，`five-1200` / `five-2800` / `five-5000` 30 轮全部同一 SHA-256 前缀 `9CA3160DE5FE`，含 3 个忙循环同时压 CPU 的 15 轮。三档之间逐字节相同，**不随冻结时刻变**；四钉组 `four-1200` 与 `four-2800` 每轮都不同，那是设计（四钉本就钉不住角色），不能当成对照。
4. 归因结论：`pinActors` 的 `v0` / `v1` 都命中（快照里角色 `id` 就是 `v0` / `v1`）；三档原始快照的差异字段只有 `now` / `villager` / `villagers` / `trails` / `tide`，全部在被钉的面上；画面上读的其它角色字段（`carrying` / `umbrella` / `lampOil`）三档同值。所以**既不是「等待条件不足」，也不是「钉帧没铺满」**；CI 那一次红不在被钉的输入面上，本机无法复现，根因未证 —— 因此不满足「加 `shotStable` 前提」的门槛，按与 `check-ground-shadow` 相同的口径撤回。
5. 尚未排除的嫌疑（已实测，不是推测）：`canvas.screenshot()` 会把 DOM 叠层截进字节（注入 40×40 纯红 DOM 后画布截图字节立刻变），而脚本注释写的是「DOM overlay 不在画布里」；`#topbar`（0–56px）、`#minimap`、`overlay-name` 都压在画布区域上。DOM 文本的抗锯齿/字体回退在 CI 与本地不同，这一点优先复核。
6. 撤回后读数：`[有消费方] 25`、`[已知孤儿] 37（manual 15 / pending-ci 21 / obsolete 1）`、`[新孤儿（未登记）] 0`、债务三类等值、`exit 0`；`orphan-gates-selftest.mjs` 16/16。

## 已知问题（记录，不在本工具里自行处置）

- `test:inprocess` 与 `npm test` 跑同一批用例，只是跑法变体，属于冗余入口。建议直接删除，不要长期留在豁免里。
- `check-lamp-blindspot` 依赖 `check-lamp-band` 的产物，本身不是独立检查。它的豁免理由必须写明「消费产物而非重跑」，不能当成一条独立闸门。
- `test:live` 会改写已入库的 `eval/live/` 截图，是危险入口。应由 owner 要求它默认写临时目录；否则谁手工跑一次就脏了基线证据。
- **预算等值断言已实现**（2026-11-07，2026-11-08 扩到四类）：四类条数必须分别等于四个预算，并由 `budgetLedger` 记录每次变更的 `approved_at` / `approved_by` / `reason`。它拦得住静默新增、静默删除和改 `kind` 绕预算；拦不住改写旧账本或敷衍审批，见「债务棘轮」。
- 命名判据会把「只读数的工具」也认成检查。归 `report` 是**owner 的决定**，不是脚本自证的：脚本仍不能自带「不是闸门」标记，检测器也不从退出码去猜；新增这类工具时必须由人登记 `kind` 并同步 `reportBudget`。

## 新增一个检查时

- 要进闸：接进 workflow，或让一个已被调用的脚本 `import` 它；接线步骤必须能判红（不许 `continue-on-error: true` / `|| true` / `if: false`）；同一提交里把清单对应条目删掉。
- 暂不进闸：在清单加一条，写清 `kind`、`reason`、`acceptedBecause`、`blockedBy`；四类的条数、对应预算与 `budgetLedger` 必须在同一提交里同步（+1 条 = 预算 +1 = 追加一条审批记录）。只输出、没有红绿的归 `report`，并在 `blockedBy` 写一行「为什么它不是闸门」。
- 该删但本轮不删：标 `obsolete`，`blockedBy` 写删除建议；它占用 `obsoleteBudget`，增删同样要同步预算与账本。
- 两件都没做：CI 红。
