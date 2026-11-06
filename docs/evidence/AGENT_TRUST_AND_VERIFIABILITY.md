# 老项目如何培养 agent 信任、如何构建可验证环境

## 0. 依据、标注与边界

这份文档以 `poteto-mode` 的实际内容为依据，再落到本仓库的存量代码库场景。

- 采用规范：poteto-mode 技能安装目录下的 SKILL.md（本机路径 C:\Users\18712\.agents\skills\poteto-mode\SKILL.md，下称「该规范文件」）。
- 同目录的 playbooks/investigation.md 用于本次只读盘点（仓外文件，不在本仓库）。
- 叶技能读自本机 pstack 副本 `D:\project\neurosama\.agents\skills\pstack\`：`principle-build-the-lever`、`principle-prove-it-works`、`principle-sequence-verifiable-units`、`principle-explain-the-number`、`principle-encode-lessons-in-structure`。这些叶技能没有随 `poteto-mode` 单独安装；本轮是只读引用，不是“已装进本工作区”。
- 论断标注分三类：`[模式]` 来自上述 poteto-mode 文件；`[本仓]` 来自本仓库可查文件或本次实测；`[推断]` 是我的判断，不是任何一方的原文。

本仓库的盘点对象与读数见 `docs/evidence/VERIFIABLE_FLOWS.md`。本文不重复那张总表，只回答三个问题：信任从哪来、最小构成是什么、老项目按什么顺序补。

## 1. 信任从哪来

一句话：信任不来自 agent 的自信，也不来自代码量，而来自「一个能重跑、会判红、失败可归因、读数可复算」的判据链。

`[模式]` 规范文件 SKILL.md 第 126 行要求「Every claim carries its evidence or its label in the same sentence」。`[模式]` `principle-prove-it-works` 第 11 行要求「Verify every task output by checking the real thing directly」，第 22 行要求「The strongest proof is a deterministic script that re-runs the same comparison」。这两条把信任从“我说我做了”改成“你跑这条命令”。

本仓库把这条链拆成四层。

### 1.1 判据层：命令 + 退出码 + 数值

`[本仓]` 九道离线闸门在 `docs/evidence/fatigue/gates.txt` 有完整读数：`npm run check` 退出 0；`npm test` 2113 通过 / 0 失败 / 9 跳过；`npm run build` 退出 0；`audit-palette --strict` 退出 0（UI 9/9、并集 32）；`audit-references` 154 处 0 存疑；`audit-citations` 0 处不在；`audit-sections` 159 处 §N 全对；`audit-claims --strict` markers 5 / passed 5 / failed 0；`pytest server/tests -q` 退出 0。

这九条之所以能承载信任，不是因为数量多，而是每条都有退出码，且读数能复算。反过来，`[本仓]` 四个抓拍脚本 `check-scene-motion.mjs`、`check-stall-motion.mjs`、`check-banner-smoke.mjs`、`check-ground-shadow.mjs` 全仓没有 `process.exit`，0.00% 与 13/13 只是打印。它们是测量器，不是闸门。这就是“看起来有验证、实际没有门”的典型。

### 1.2 归因层：失败必须能指到具体输入

`[本仓]` 钉子契约把渲染输入钉成四类：`now`、`tide`、`trails`、`villagers`；25 个快照键 = 4 pin + 10 stable + 11 dom；`test/pin-shot-state.test.ts:403-479` 断言未登记字段为空、11 个 dom 字段在绘制路径 0 命中。三档等待 1200/2800/5000 的精确差、可见差、结构块全为 0（`04-RENDER-INPUT-TABLE.md:94-108`）。

失败也能归因：把 v0 的 `pos.x` 加 1 格，精确差 2.6396%、可见差 2.4920%、最大块 14704 px；把痕迹从 `(49,36)` 移到 `(48,36)`，精确=可见 0.0104%（64 px，8×8）。一个失败样本直接告诉你“是角色位置”还是“是痕迹”，不需要人猜。`[本仓]`

`[模式]` `principle-sequence-verifiable-units` 第 15 行要求交付顺序是「先失败的测试，再修复」。`[模式]` `principle-prove-it-works` 第 11 行要求核对真实产物，第 22 行要求把检查脚本化。`[本仓]` 的钉子三档、相位帧自检、账本六红，都是这个形状，但「切成小单元」这一点只挂在 `principle-sequence-verifiable-units`，不替 `principle-prove-it-works` 加戏。

### 1.3 证据层：读数要落盘，且要能被别人复算

`[本仓]` `eval/ledger.json` 有 25 条 metric，12 个必填字段；`script_sha` 会按当前脚本内容复核，CRLF→LF 归一化后比对，不一致就报“脚本改过，读数需重测”（`eval-ledger-lib.ts:24-37,62-64,135-150`）。外部来源 `pwe-soak/` 必须给 `input_sha`，或者写 `input_status='not_measured'` + `input_note`，否则红（`:152-174`）。这条规则的价值是：账本不能拿“来自某个提交”当证据，必须钉住是哪份输入。

`[本仓]` 旁证分桶更直接：`docs/evidence/soak/witnessed-corroboration.json` 记 71 条 witnessed、12 条未解析 `eventRef`，分桶 `0 / 10 / 2`（无旁证 / 单旁证 / 多旁证）；`test/memory-witnessed-corroboration.test.ts` 断言 `violations.length === 0`。孤证不是“大概没事”，是一条会红的断言。

`[本仓]` 本次新增的 `verify-ledger-selfcheck.ts` 证明这条判据不是永远绿：缺 `seed`、`value=0` 且 `source=not_measured`、`script_sha` 篡改、外部来源删 `input_sha`、重复 `id`、`version=2`，六种坏账本全部判红。

### 1.4 记账层：把“谁在用什么、什么时候回收”也变成读数

`[本仓]` `npm run worktrees:audit` 本次实测输出 11 个“已合入 main 但 worktree 仍在”的回收候选，退出 0；`--strict` 下“未登记”或“过期未回收”才退出 1，因为合并后是否立刻回收由 owner 判断（见仓库根的 scripts/worktrees-audit.mjs 第 3-16 行）。`docs/OPEN_ISSUES.md` 用 `[事实]` / `[推断]` 标注，每条带证据链接和“需要决策”，把“我记得”变成“登记在案”。

`[模式]` `principle-encode-lessons-in-structure` 第 11 行说：“If the fix is structural, only use the structural fix. The instruction is the symptom.” 本仓库的对应物不是更多说明，而是 `WORKTREES.md` 登记表、`OPEN_ISSUES` 字段、`eval/ledger.json` schema、`unregisteredRenderFields` 守卫。`[本仓]`

### 1.5 信任的单位是“一条论断”，不是“一个 agent”

`[推断]` 不要让“这个 agent 上次很靠谱”成为信任来源。可迁移的信任单位是：一条论断 + 一条可重跑命令 + 一个失败样本 + 一个落盘读数。`[本仓]` `verify-all.mjs` 把 8 条流程串起来，任一 FAIL 退出 1；`--self-test` 注入必红项后整体判红，本次实测通过。入口本身也必须有反向验证，否则“汇总入口”只是另一个永远绿的壳。

## 2. 可验证环境的最小构成

`[推断]` 最小构成是五件，缺一不可；再多就该先问“谁维护”。

| # | 构成 | 缺了会怎样 | 本仓对应物 |
|---|---|---|---|
| 1 | 确定性输入钉 | 同一改动两跑不同，差异无法归因 | `pinShotState` 四类 pin 字段；07:34 + 潮位 0 + 相机 (52,32)×16 + 静置 2600 ms |
| 2 | 可重跑判据（脚本 + 退出码 + 数值） | 只剩“看起来对” | `screens-diff.py` 三层差；`compare-ledger` 逐像素 sha；`audit-palette --strict` |
| 3 | 必须判红的反向样本 | 判据可能永远绿 | 角色偏移 2.6396%、痕迹偏移 0.0104%、2900 px 烟柱、差 7 级、账本六红 |
| 4 | 读数落点（路径 + schema） | 数字无法复算，只能信口述 | `eval/ledger.json` 25 条；`palette-9/*.txt`；`screens-diff.json`；`runs.json` |
| 5 | 单一入口 + 红传播 | 每条都要人记命令，漏跑没人发现 | `verify-all.mjs`；`--self-test` 证明会判红 |

为什么是这五件：

1. **确定性输入钉**是前提。没有钉住世界时钟、潮位、相机、角色位置和痕迹，像素差会把“世界自己动了”算成“你的改动”。`[本仓]` 钉子契约里 25 个快照键只有 4 个需要钉，另外 10 个 stable、11 个 dom 字段不进画面；这个划分不是拍脑袋，是 `RENDER_INPUT_TABLE` 逐字段核对出来的。
2. **可重跑判据**是信任的载体。`[模式]` `principle-build-the-lever` 第 10 行说：“A deterministic script turns ‘trust me’ into ‘run this’.” 本仓的 lever 是 `screens-diff.py`、`verify-all.mjs`，以及当前 main 上还没有、只在 pwe-anim 分支上的 compare-ledger.mjs。
3. **反向样本**是判据的体检。没有它，你不知道阈值是判据还是装饰。`[本仓]` 相位帧 `--self-test` 把差区平移出区、把面积长到 ×1.5，两条都必须红；render-budget 单测用 `(60,58)`、`(60,21)`、`(37,12.5)`、`NaN` 四条必红边界证明双条件没被放宽。
4. **读数落点**是复算的入口。`[本仓]` 旁证测试会覆盖写 `witnessed-corroboration.json`，固定键序、无时间戳、末尾 `\n`；账本有 schema 和 `script_sha`，所以别人能重跑并对照。
5. **单一入口**是防漏。`[本仓]` 九道闸门加浏览器套件已经很多，人记不住；`verify-all.mjs` 先把离线能跑的 8 条串起来，SKIP 显式打印原因，不把“没跑”伪装成“绿”。

“多了就没人维护”的证据在本仓是具体的：

- `[本仓]` `test:buttons` 仍是已知缺口：`/api/memory/list` 回 404，脚本退出 2；`test:phases`、`test:persistence`、`test:setting`、`test:render-budget` 各自要浏览器和服务。加门容易，维护门的运行环境难。
- `[本仓]` `palette-9/audit.txt` 的 root 写成 `D:\project\pwe-lively\world-client`，不是当前树；`palette.txt:180` 的复跑路径已过时。读数一旦离开它诞生的树，就会变成“看起来有、实际复算不了”。
- `[本仓]` 相位帧只有 stdout，没有 JSON/掩膜；`eval/screens/actor-pin` 当前为空，六图与 `runs.json` 未落盘。证据不落盘，流程就退化成一次性人工验收。

所以最小构成不是“越全越好”，而是“五件都硬”。九道闸门是扩展，不是起点。

## 3. 老项目迁移路径

`[推断]` 顺序比工具重要。建议按下面六步，每步结束在一个可检查的状态。

### 第 0 步：只读盘点，先分类

把现有流程分成四类：离线可跑、需要浏览器与服务、被前置卡住、只有文档。`[本仓]` 本次盘点结果就是 `VERIFIABLE_FLOWS.md` 的 10 行总表：8 条进汇总，1 条 SKIP，1 条只能校结构。

这一步不要急着写新判据。先回答“哪条流程现在根本没有退出码”，否则会重复建设。

### 第 1 步：挑一条最常吵架的流程，先钉输入

老项目最贵的不是写测试，是不知道“这次差异是不是世界自己动了”。先挑一条大家反复争论的视觉流程，把世界时钟、相机、角色、痕迹钉住。

`[本仓]` 选的是入口截图与角色站位：`pinShotState` 钉 `now/tide/trails/villagers`，`check-shot-actor-pin.mjs` 三档等待，`five-shift`/`trail-shift` 两个反向样本。做完这一步，后面的像素判据才有意义。

### 第 2 步：写判据脚本，同时写一个必须红的样本

`[模式]` `principle-sequence-verifiable-units` 第 15 行说，交付顺序应该是“先失败的测试，再修复”。老项目可以先补“能判红的检查”，再补“让检查变绿的工作”。

`[本仓]` `screens-diff.py` 的三层差是判据，`reverse-structure-check.py` 是反向样本；本次又加了 `verify-screens-diff-selfcheck.py`，5 例里 2 绿 3 红。判据和反向样本必须同一天落地，否则很容易只留下“绿的那一半”。

### 第 3 步：把读数落盘，并登记进账本

判据跑完要留下可复算的东西：JSON、掩膜、账本行、截图。`[本仓]` `eval/ledger.json` 的 25 条 metric、`script_sha` 复核、外部输入 `input_sha`/`input_note` 就是这一步；`palette-9`、`screens-diff.json`、`*-pixel-ledger.json` 是同一层。

这一步最容易半途而废，因为“测试绿了”已经能交差，落盘看起来是额外工作。但不落盘，下一次只能重跑，不能复算；跨 worktree 时更糟，读数会指回错误的树。

### 第 4 步：建一个入口，先只收离线流程

`[本仓]` `verify-all.mjs` 只收 8 条离线流程；浏览器流程显式 SKIP 并写原因。入口必须自己也能判红：`--self-test` 注入 `process.exit(1)`，整体退出非零。

不要在这一步追求“全量”。先让入口可信，再逐步收编浏览器流程。

### 第 5 步：把重复的教训做成结构，不再写说明

`[模式]` `principle-encode-lessons-in-structure` 要求把重复指令变成 lint、metadata flag、runtime check 或脚本。

`[本仓]` 对应物：

- `unregisteredRenderFields(snapshot)`：新增快照字段没登记进渲染输入表，直接红（`test/pin-shot-state.test.ts:403-406`）。
- `palette-budget.test.ts`：换色值、加裸 `0xRRGGBB`、蓝图槽位不符，直接红。
- `eval-ledger-lib.ts`：缺字段、`script_sha` 不符、外部输入没钉，直接红。
- `worktrees-audit.mjs`：worktree 未登记或过期，`--strict` 退出 1。
- `OPEN_ISSUES.md`：`[事实]`/`[推断]` 分栏 + 证据链接 + 需要决策。

这些都比“请在文档里注意”更难绕过。

### 第 6 步：再扩浏览器闸门，且必须先解决自动起停与产物保留

浏览器流程的维护成本不在断言，在环境。`[本仓]` 现状是：抓拍脚本默认端口落在禁用名单，`eval/screens/actor-pin` 为空，相位帧无产物，`pixel-ledger`/`compare-ledger` 只在 `pwe-anim`。在这些前置没解决前，把浏览器流程塞进入口只会制造更多“红得莫名其妙”。

### 哪一步最容易半途而废

`[推断]` 是第 2 步和第 3 步的交界：**写了判据，但没写反向样本；跑了判据，但没落盘**。

本仓库有直接证据：

- `[本仓]` 四个抓拍脚本有读数、没有退出码，0.00% 只是打印。
- `[本仓]` 相位帧判据有效，但只有 stdout，没有 JSON/掩膜。
- `[本仓]` 动画基线账本 232 行、157 张图，原来没有任何脚本校验；本次补的是结构校验，语义真值仍要重录后由人确认。
- `[本仓]` `03-ACTOR-PIN.md` 与 `04-RENDER-INPUT-TABLE.md` 对五钉 1200 vs 2800 记了 0.0104% 与 0，两个读数不在同一口径；`render-budget` 有 15514/28 与 16130/27 两套。判据在演进，读数没有同步重录，就会出现“文档看起来有结论、实际对不上”。

## 4. 失效边界

### 4.1 这套做法判不了什么

- **主观观感与卡通感**：像素差能判“变了多少”，判不了“好不好看”。`[本仓]` 动画基线账本自己写明，卡通感/主观观感的像素判据本就判不了。
- **时序手感**：相位帧弱判据只判区外 0、区内面积/块数上限；`01-salute.png` 的允许上限是 34529 px/14 块（观测 24663/9），它不判“这一段节奏舒不舒服”。`[本仓]`
- **DOM 覆盖层**：截图主要抓画布；`test:buttons` 仍因 `/api/memory/list` 404 退出 2，镇志抽屉点不到。DOM 层的可验证性目前是缺口。`[本仓]`
- **未钉住的呈现态**：雨幕、天气过渡、角色渐隐这类“呈现态”还没有像四钉那样钉死；相位帧只能给弱判据。`[本仓]` 账本里 18 张被降级为“相位相关”，28 张不可归因，29 张三跑 0 差但基线不可复现，2 张不可比。
- **跨树读数**：读数一旦出自另一棵 worktree，主仓复算不了。`[本仓]` `palette-9/audit.txt` 的 root 是 `pwe-lively`，`pixel-ledger`/`compare-ledger` 只在 `pwe-anim`。

### 4.2 “判据看起来绿但其实是空判”的四种形态

| 形态 | 本仓表现 | 判定 |
|---|---|---|
| 无门的 gate | 四个抓拍脚本没有 `process.exit`，0.00% 只是读数 | 不能进闸门，只能当测量器 |
| 判据被放宽到能包住一切 | 本仓未发现显式放宽阈值的改动；但存在规格漂移风险：`structure-spec.json` 里 `05` 的 kind 写成 `smoke`；`03`/`04` 五钉读数矛盾；render-budget 15514/28 与 16130/27 并存 | 规格漂移，需重录与对齐口径 |
| 断言永远为真 | 账本允许 `not_measured`，但 `not_measured` 不等于通过；`verify-all` 把 exit 2 记为 SKIP，不记为 pass | 只能标“不可判”，不能标绿 |
| 生成物未入库无法复算 | `eval/screens/actor-pin` 为空；`pwe-anim` 的 r1/r2/r3 不随仓提交；相位帧无产物 | 证据链断，流程退化为一次性人工 |

`[模式]` `principle-explain-the-number` 第 9-11 行要求：说清是什么限制了数字、列出这个数字还可能测到什么、把跑次数与散布留在证据里。本仓的 15514/16130 两套读数、0.0104%/0 两套五钉读数，正是“没有把跑次数与口径留在同一条证据里”的后果。

## 5. 结论

1. `[推断]` 老项目培养 agent 信任，第一步不是让 agent 更可信，而是让**论断可重跑**。一条命令、一个退出码、一个必红样本，比十页说明有用。
2. `[推断]` 可验证环境的最小构成是五件：确定性输入钉、可重跑判据、反向样本、读数落点、单一入口。九道闸门与浏览器套件是扩展；先有这五件，再谈扩展。`[本仓]` 的对应物见第 2 节表格。
3. `[推断]` 迁移顺序应该是：盘点分类 → 钉一条最常吵架的流程 → 判据 + 反向样本 → 落盘 + 账本 → 单一入口 → 把重复教训做成结构 → 最后扩浏览器闸门。最容易半途而废的是「判据写了但没反向样本、跑了但没落盘」。`[本仓]` 的四条证据见第 3 节末尾。
4. `[本仓]` 当前事实是：四个抓拍脚本只有读数没有退出码；`pixel-ledger`/`compare-ledger`/`phase-frames` 只在 `pwe-anim`；浏览器流程没有自动起停与产物保留。`[推断]` 因此最该补的是这三件。
5. `[推断]` 这套做法判不了主观观感、时序手感、DOM 覆盖层和未钉住的呈现态。承认这些边界，比把它们伪装成绿更可信。`[本仓]` 的具体缺口见第 4 节。

## 附：poteto-mode 引用对照

| 文件 | 节/行 | 用到的内容 | 本文标注 |
|---|---|---|---|
| poteto-mode 安装目录的 SKILL.md（C:\Users\18712\.agents\skills\poteto-mode\SKILL.md） | `## Principles`，第 54 行 | Build the Lever：把工作和证明做成可重跑的工具 | `[模式]` |
| 同上 | `## Principles`，第 65-71 行 | Prove It Works / Sequence Verifiable Units / Test Behavior / Explain the Number | `[模式]` |
| 同上 | `## Delegation`，第 75-76 行 | Guard the Context Window / Never Block on the Human | `[模式]` |
| 同上 | `## Meta`，第 80 行 | Encode Lessons in Structure | `[模式]` |
| 同上 | `## Writing the reply`，第 120-126 行 | 每条论断带证据或标签，禁止编造引用 | `[模式]` |
| 同上 | `## Playbooks`，第 140 行 | Investigation：只读问题、给出有引用的答案 | `[模式]` |
| 本机 pstack 副本的 principle-build-the-lever 叶技能 SKILL.md | 第 8-22 行 | 确定性脚本把 “trust me” 变成 “run this” | `[模式]` |
| 本机 pstack 副本的 principle-prove-it-works 叶技能 SKILL.md | 第 11-24 行 | 核对真实产物，脚本化检查并保留产物 | `[模式]` |
| 本机 pstack 副本的 principle-sequence-verifiable-units 叶技能 SKILL.md | 第 9-15 行 | 每个单元结束在可检查状态，失败先于修复 | `[模式]` |
| 本机 pstack 副本的 principle-explain-the-number 叶技能 SKILL.md | 第 9-11 行 | 说明限制因素、排除其他解释、保留跑次数与散布 | `[模式]` |
| 本机 pstack 副本的 principle-encode-lessons-in-structure 叶技能 SKILL.md | 第 11 行 | 结构性修复优先于重复说明 | `[模式]` |

本仓库实践部分（九道闸门、四钉、三层像素差、反向用例、账本与旁证、`worktrees:audit`、`OPEN_ISSUES`）全部标为 `[本仓]`，读数来自 `docs/evidence/` 与本次实测，未从 poteto-mode 反推。
