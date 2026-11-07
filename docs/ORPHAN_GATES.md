# 孤儿闸门检测

一句话：回答「仓库里哪些检查脚本没有任何东西在跑」，并在**新增**一个没人调用的检查时变红。

## 三关（判据）

### 关 1：什么算「检查」

两个判据，任一命中即算，不靠模糊匹配：

1. 路径是任意 `scripts/` 目录下的 `check-*` 或 `audit-*`，扩展名 `.mjs` / `.ts`。
   只认 `scripts/` 的直接子文件，不向下递归。
2. npm 脚本名以 `test:` / `audit:` / `fixture:` / `check:` / `baseline:` 开头。

不算检查：普通测试文件（`*.test.ts`）、不带这些前缀的 npm 脚本（如 `build`、`preview`、`worktrees:audit`）。

### 关 2：什么算「有消费方」

从 `.github/workflows/*.yml` 的 `run:` 出发，沿下面三条边可达即算：

1. workflow 的命令里出现 `npm run X` / `npm test` / `node scripts/...`。
   支持单行 `run:` 与 `- run: |` 多行块；`#` 开头的注释行不计。
2. 被调用 npm 脚本的体内再出现 `npm run Y` / `node scripts/...`。
3. 已到达的 JS/TS 文件用相对路径 `import` / `import()` / `require` 到的文件，逐跳追。

支持 job 级与 step 级 `working-directory`。不追：child_process 拼字符串的调用、composite action、仓库外脚本。

**消费方还必须能判红**：`continue-on-error: true`、`if: false`、命令里的 `|| true` 会让失败穿过 CI，一律不算消费方（job 级同名字段同理）。`scripts/orphan-gates-selftest.mjs` 用 5 条用例钉住这个口径（一条正面对照 + 四条反例）。

### 关 3：允许清单

`scripts/orphan-gates-allowlist.json`。每条必须写：

- `id`：`file:<相对路径>` 或 `npm:<包>#<脚本名>`；
- `kind`：必须是下面三类之一（规则写死，不看印象）：
  - `pending-ci`：脚本有**客观 pass/fail**（失败会 exit 非 0），只缺环境（preview / 浏览器 / 服务 / 预期失败步骤）；
  - `manual`：需要**人的目视判断**（没有可自动判定的红绿），或需要**人在场干预**（先 stash `src/`、一次性取证）；
  - `obsolete`：判据已失效或冗余，**应该删**。
- `reason`：这个检查是什么；
- `acceptedBecause`：现在为什么可以不接；
- `blockedBy`：卡在什么上（manual 写清为什么只能人工，pending-ci 写清接闸的阻塞项，obsolete 写删除建议）。

「暂不接」不是债务描述。只有 `pending-ci` 计入预算；`manual` 和 `obsolete` 不计。
输出会把三个数字分开打：`manual N / pending-ci M / obsolete K`；`obsolete` 另起一节，逐条给删除建议。

以下情况直接红：

1. 有孤儿没登记；
2. 清单指向不存在的检查（防止清单自己烂掉）；
3. 清单条目已经有了消费方（说明该删了，不能让「临时接受」变成永久挡箭牌）；
4. 缺 `kind` / `reason` / `acceptedBecause` / `blockedBy`，`kind` 不在三个枚举内，或重复登记；
5. `pending-ci` 条数超过顶层 `pendingCiBudget`。

### 债务棘轮

顶层 `pendingCiBudget` 是显式预算。实际 `pending-ci` 条数一旦大于它，CI 就红。新增一条 `pending-ci` 豁免必须同时抬高这个数字——评审时看得见，清单不能只长不短。
当前 `pendingCiBudget = 19`（`manual 8 / pending-ci 19 / obsolete 1`）。原值 27，2026-11-07 连降三轮：27→24，`check-lamp-band` / `check-lamp-pool` / `check-rain-pin` 按关 3 的规则没有客观 `exit` 非 0，改归 `manual`，不再计入 `pending-ci`；24→21，`check-ground-shadow` / `check-shot-actor-pin` / `check-phases-negative` 接进 workflow，同提交删条；21→19，npm 别名 `test:lamp-band` / `test:lamp-pool` 跟着本体改 `manual`——别名和本体必须同一 `kind`，不能一个 `pending-ci` 一个 `manual`。同一轮总检查数从 49 变 50（合入 main 的 `00d3121` 带来 `check-glow-contrast`，它已明确「不是闸门，也不在 CI」，只能登记为 `manual`），所以 `manual` 从 2 变 8。
这不是「可以长期不动」的基线：每次接闸、重分或删条目，都要按实测重设。`manual` 与 `obsolete` 不占预算。

## 命令与输出

```bash
npm run audit:orphan-gates
```

输出分节：**有消费方**（附消费路径）、**避免孤儿（允许清单）**、**obsolete（应删）**、**新孤儿（未登记）**，再加**允许清单问题**和**债务读数**。
已知孤儿会按 `manual N / pending-ci M / obsolete K` 三数分开计数；债务行打印 `pending-ci X / 预算 Y（余量 Z）`，`obsolete` 另起一节逐条给删除建议。
没有未登记孤儿且清单自洽时退出 0，否则退出 1。

## CI

`.github/workflows/ci.yml` 的 `repo-harness` job 两步：`npm run audit:orphan-gates`，以及 `node --test scripts/orphan-gates-selftest.mjs`。只用 node 内置模块，不需要 `npm ci`、不需要浏览器。

具体读数不写死在文档里（它会随检查数增长）：第一次运行的完整清单见引入这个闸门的提交说明。

## 消费方出现后必须删条目（这是设计，不是故障）

清单条目一旦被接进 workflow、被 npm 脚本调用或被 import，必须在**同一提交**里删掉；否则 `audit-orphan-gates` 会红。
这是设计预期：清单只记录「还没人跑」的东西，不记录「正在跑」的东西。
例如某条 `pending-ci` 在另一条分支被接进 workflow：合并那一刻，那条改动给它接上消费方，CI 会先红一次；正确动作是删掉清单条目，而不是放宽判据。这次红是预期，不是故障。

## 待命接线：`fixture:check`（等 J1 合入 main 后再执行）

**现在不要改 `ci.yml`。** J1 分支（`chore/j1-fixture-drift`，`fe460a1`，5/5 PASS）合入 main 之前接上，只会把既有的红带进 CI；合并顺序由 owner 定。下面是合入 main 后的动作，三步必须同一提交。

1. 改 `.github/workflows/ci.yml` 的 `world-client` job（**不是** `world-client-browser`；`scripts/fixture-check.ts` 只读文件与内存重放，不连 preview、不需要浏览器），在 `- run: npm test` 之后加一行（当前是第 32 行之后）：

   ```yaml
       - run: npm run fixture:check
   ```

   `world-client` job 已有 `working-directory: world-client`，`npm run fixture:check` 解析为 `node scripts/fixture-check.ts`，不用再写路径。不许加 `continue-on-error`、不许写 `|| true`、不许用 `if: false`——关 2 会把这些接线判成「无有效消费方」。
2. 同一提交删掉允许清单里的 `npm:world-client#fixture:check` 条目，并把 `pendingCiBudget` 从 19 降到 18。只删条目不减预算不会红，但会悄悄放大余量；只减预算不删条目会红。两件事必须一起。
3. 自证（贴原始输出，不要只写「通过」）：
   - `world-client/` 下按 CI 形态跑 `npm run fixture:check`，记录耗时与退出码；期望 fixture 全 PASS、`exit 0`。
   - `node scripts/audit-orphan-gates.mjs`：期望 `[有消费方] 23`、`[已知孤儿] 27（manual 8 / pending-ci 18 / obsolete 1）`、`[新孤儿（未登记）] 0`、债务 `pending-ci 18 / 预算 18（余量 0）`、`exit 0`。
   - 反向证据：新加的那行若带 `|| true`，`npm:world-client#fixture:check` 必须被重新判成「无有效消费方」。这条已由 `scripts/orphan-gates-selftest.mjs` 的 `|| true` 用例覆盖，接线时不必再手工改坏一次，但要在提交说明里点名是哪条用例。
   - `git status --porcelain` 必须为空：fixture 校验只读，不许写脏仓库。

**接不上的情况**：J1 合入后若 `fixture:check` 仍非全 PASS 或仍 `exit` 非 0，停下并回到本节，不要用放宽 `fixture:check` 判据或 `continue-on-error` 换绿。

## 已知问题（记录，不在本工具里自行处置）

- `test:inprocess` 与 `npm test` 跑同一批用例，只是跑法变体，属于冗余入口。建议直接删除，不要长期留在豁免里。
- `check-lamp-blindspot` 依赖 `check-lamp-band` 的产物，本身不是独立检查。它的豁免理由必须写明「消费产物而非重跑」，不能当成一条独立闸门。
- `test:live` 会改写已入库的 `eval/live/` 截图，是危险入口。应由 owner 要求它默认写临时目录；否则谁手工跑一次就脏了基线证据。
- **预算只是上限，不是单调递减**（本轮只登记，不实现）。删掉几条后余量变大，后续可再塞新 `pending-ci` 而无需显式抬预算；`manual` / `obsolete` 不占预算，改 `kind` 也能绕开「只长不短」。下一版提案：把预算钉成等值断言——`pending-ci` 条数必须**等于** `pendingCiBudget`，删一条必须同一提交降 1，加一条必须同一提交升 1；或对清单做只允许缩减方向的快照校验，并在 CI 里跑。
- 命名判据会把「只读数的工具」也认成检查（`check-glow-contrast` 已被 owner 明确降级为非闸门）。本轮只能登记 `manual`；下一版应允许脚本自带「不是闸门」标记，由检测器尊重。

## 新增一个检查时

- 要进闸：接进 workflow，或让一个已被调用的脚本 `import` 它；接线步骤必须能判红（不许 `continue-on-error: true` / `|| true` / `if: false`）；同一提交里把清单对应条目删掉。
- 暂不进闸：在清单加一条，写清 `kind`、`reason`、`acceptedBecause`、`blockedBy`；若标 `pending-ci`，同时确认预算数字。
- 该删但本轮不删：标 `obsolete`，`blockedBy` 写删除建议；它不占预算，只会被单独打出来。
- 两件都没做：CI 红。
