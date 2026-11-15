# 工程验收纪律（按需组合）

> 适用：本仓的开发、验收、证据、合并窗口。  
> 用法：先查 §0 取值表，按任务类型取条款编号；不要每轮全文通读。  
> 状态标签：
> - `[已实现]` 仓里有脚本/测试/CI 步骤，跑起来会红。
> - `[人工步骤]` 有明确书面检查点或台账字段，但不会自动红；失效边界写在条款里。
> - `[尚未实现]` 仓里没有对应物；不得当作既有闸门引用。
>
> 条款编号稳定：新增条款只追加，不改旧号，避免跨文档互引错位。

## 0. 取值表：任务类型 → 必须用的条款

| 任务类型 | 必用条款 |
| --- | --- |
| 改渲染 / 世界实现 | C1、C3、C4、C5、B1、B2、B4、B5、T1、T2、V1、V3、V4、E1、E2、E4、E6 |
| 加 / 改测试 | T1、T2、T3、V1、V2、E1、E4 |
| 改判据 / 阈值 | C1、C2、C3、C4、C5、B1、B5、T1、T2、V4、E1、E4、E6 |
| 写证据 / 读数 | C2、C3、C5、C6、E1、E2、E3、E4、E5、E6、E8、V5 |
| 修 bug | T4、T1、T2、V1、V4、E1、E4 |
| 起服务 / 新建 worktree | W1、W3、V2、X1 |
| 同树多线 / 接手别人的树 | W1、W2、W4、M1 |
| 开合并窗口 | M1、M2、M3、M4、M5、W1、W2、L1、L2、L3、E6 |
| 接孤儿闸门 | L2、L3、M1、V2、E6 |
| 只改文档 / 编号 | C6、E4、E5、E6、E8、L3、V2 |
| 环境化 / 流程改进 | X1、X2、L1、L2、E6 |
| 改造 / 迭代 skill 或工作流文档 | X3、X1、X2、E1、E4、E6 |
| 交付前自查（任何改动） | V1、V2、V5、E1、E4、E6 |

> 实话：标 `[人工步骤]` 的多数条款只是**检查点**，不是可复现动作 —— 照做不等于复现。真正具备「命令 + 判绿口径」的只有 **E3 / M1 / M2 / M5**；其余需要先补成命令与判据，才能当作可执行的验收项来依赖。

## 1. 判据与设计

### C1 全称断言必须附枚举或测试依据

**状态**：`[人工步骤]`（写作规矩已有，通用 lint `[尚未实现]`）
- **触发**：写或改判据、设计稿、回报、代码注释，出现「所有」「每格至多」「永不」「一律」。
- **怎么做**：附坐标清单、用例名或实测读数；没有依据就显式写「未穷尽，待验证」，并且不许把它当前提往下推。
- **违反暴露**：通用 lint 不会红；只有具体枚举用例（如岸带 J9）在违规时红，其余靠 review 发现。
- **对应物**：[P1_SHORE_BAND_DESIGN.md](file:///D:/project/pixel-world-engine/docs/P1_SHORE_BAND_DESIGN.md#L10-L14) 的写作规矩；[shore-band.test.ts](file:///D:/project/pixel-world-engine/world-client/test/shore-band.test.ts#L1294-L1317) 全图枚举；`grid.border: 1` 处的反例见 [shore-band.test.ts](file:///D:/project/pixel-world-engine/world-client/test/shore-band.test.ts#L1348)。

### C2 阈值必须三件套：来源、单位、帧态/采样条件

**状态**：`[人工步骤]`（`audit-claims` 只覆盖已登记 claim，通用检查 `[尚未实现]`）
- **触发**：任何要写进判据、验收文档、代码常量的数字。
- **怎么做**：同时写清来源（哪次测量/哪条提交/哪份决议）、单位（截图 px / 世界 px / art px / device px）、帧态或采样条件（dim 前/后、时相、潮位、天气、pin、窗口、跑数）。缺一只能叫「占位值」，不得作为目标值引用。
- **违反暴露**：`audit-claims --strict` 只复算已标记的固定探针；未登记的数字不会自动红，只能靠 review。`0.18` 就是缺三件套却被下游当合同的实例。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L395-L440) H1；[DESIGN_ACCEPTANCE.md](file:///D:/project/pixel-world-engine/docs/DESIGN_ACCEPTANCE.md) 要点 4 与第 225 行；账本字段见 [eval-ledger-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/eval-ledger-lib.ts#L1-L45)。

### C3 判据与其比较对象必须同源

**状态**：`[人工步骤]`（无同源 lint）
- **触发**：拿一个读数去套一个阈值，或把两组读数直接比。
- **怎么做**：确认同一次采样、同一记录器、同一窗口、同一分组、同一单位、同一帧态。跨记录器、跨分组、跨单位不可套用。判据旁边至少写出 `recorder / group / window / units` 四项。
- **违反暴露**：会得到看起来正常的假绿或假红；没有脚本检查同源性，review 才能发现。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L369-L390) G5：`33,445` 与 `34,666` 不是同一配置；H1 的截图 px vs 世界 px、dim 前/后；[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L96-L104) 8 组合连续帧；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L58-L66) 自己的机位与相位集合。

### C4 阈值形式必须对无关参数不敏感

**状态**：`[尚未实现]`（形式已拍板；`check-glow-contrast.mjs` 已改为只读——`audit-orphan-gates` 记为 `report`：它只输出读数、没有可自动判定的红绿；D 比值闸本身仍未实现）
- **触发**：阈值用绝对 luma 差、绝对亮度比，或换一档曝光/时相就会变意思。
- **怎么做**：用有界相对量：

  ```text
  D = (meanL(patch) − meanL(annulus)) / max(meanL(annulus), ANNULUS_FLOOR)
  ANNULUS_FLOOR = 32        // 8 位 luma；写死，不随相位/机位/参数变
  ```

  标定时同时记录 dim 参数与帧态；绝对差不得再作为新合同。
- **违反暴露**：曝一档，判据换一个意思，历史读数无法比较。`check-glow-contrast.mjs` 曾按 `0.18 / 0.10` 判定（`ea762a6` 起写入，`00d3121` 起撤除），现只输出原始读数、退出码恒 0；旧阈值不得引用为「未达标」。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L414-L435) H1 的形式与待办 1；[check-glow-contrast.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-glow-contrast.mjs)；[measure-design-readouts.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/measure-design-readouts.mjs)。

### C5 主判据与辅助判据分开

**状态**：`[人工步骤]`（实现自检已有，适用性判断靠 review）
- **触发**：选一个指标判「看不看得见 / 像不像」。
- **怎么做**：主判据单一且可反解（本仓视觉判读用 ΔL\*）；辅助判据只在同族内使用，ΔE2000 仅在**同色相族**内辅助，不可跨族套用。
- **违反暴露**：跨族 ΔE 会把及格线随色相/彩度漂移，同一 ΔL 得到相反结论；没有 lint 阻止跨族引用。
- **对应物**：[palette-threshold/README.md](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/README.md#L8-L13) 主判据定义；[de2000.mjs](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/de2000.mjs) 的 34 对自检（只证实现正确，不证跨族可用）；同文件的跨族反例。

### C6 引用指向的文件若全历史都不存在，登记为「引用幻影」

**状态**：`[已实现-当前树]` + `[人工步骤-全历史]`
- **触发**：文档或注释里写了一个文件/路径。
- **怎么做**：先 `git ls-files`；不在工作树再 `git rev-list --all --objects`。两处都空 = 引用幻影，比「未解析」更硬；登记为幻影，文件名不再重复，避免二次幻影。若目标只在另一分支，按 M4 记为前向引用。
- **违反暴露**：`audit-citations` / `audit-references` 能抓当前树里不存在的引用；全历史不存在的判定只能靠上面的 git 命令。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L362-L367) G4；[audit-citations.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-citations.ts)；[audit-references.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-references.ts)。

### C7 喂判据的读数不得用 `??` / `catch {}` 兜底；缺失必须抛

**状态**：`[人工步骤]`
- **触发**：写一个会被判据读的数（基线、实测值、已跟踪文件清单、色温、活动 span……）。
- **怎么做**：缺字段、命令失败、取样无效 → **抛**，或走调用方现成的红路径，并打印缺的字段 / 失败的命令；**只有「仅供人看」的展示字段**可以用默认值。判别标准一句话：这个值会不会进 `if`、比较、汇总？会 → 不许兜底。
- **违反暴露**：`?? 0` / `?? []` / `catch { return [] }` 会把「不知道」变成「没有」或「是 0」，判据恒绿或恒红，输出里看不出字段缺失。`Math.max(NaN, …)` 和 `floor - actual > NaN` 更隐蔽——整个地板比较直接失效。没有通用 lint：`??` 用在展示字段是合法的，只能靠 review。
- **对应物**：本轮静默普查同一族的六处（编号沿用那份回执）：
  - **#2** [check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs) `aoUnknownBase` 汇总的 `?? 0`：`contactAoUnknownBase` 缺失被当成「未知基底 0」，判绿。
  - **#4** [shot-output.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/lib/shot-output.mjs) `trackedFilesIn` 的 `catch { return [] }`：git 答不上来被当成「没有已跟踪文件」，未授权的基线写入直接放行。
  - **#1 / #3 / #11 / #12** [check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs) 的四处：
    夜间村民 / 摊位 span 汇总的 `?? []` / `?? 0`（缺失 = 没有活动，夜间判据静默通过）；
    阶梯判据的 `stallSpan ?? 0` / `villagerSpan ?? 0`（缺失被当成 0 格，`checkLadder` 比错期望值）；
    `stalls?.find(...) ?? stalls?.[0]`（缺 `stall_on` 时整个单元被跳过，读数不报）；
    `villagers[0] ?? <备用坐标>`（缺人时用备用坐标顶替实测读数）。
  - 其余七条不属于这一族（取样判据本身缺失、阈值缺字段等），按各自条目处理；`allowedDrop` 的 NaN 由 **#5** 在加载边界核 `threshold.minDrop` / `threshold.ratio`，同属「缺失必须红」。
- **落地状态**：`#4` / `#5` 已在新分支修；`#2` / `#1` / `#3` / `#11` / `#12` 在 `check-ground-shadow.mjs` 内，等帧相位改造落地后做第二轮（同一文件两边同时改必打架）。

## 2. 红先与 TDD

### T1 先红再绿

**状态**：`[已实现]`（CI 闸 + 本地入口）
- **触发**：新增或修改 `world-client/test/**` 下的测试，或修 bug 要先有断言。
- **怎么做**：先只写测试，跑 `npm run red:first -- --base <base sha>`，看到 `RESULT=RED` 且失败原因是断言；再写实现；最后 `npm test` 转绿。CI 用事件 sha 作为 base。
- **违反暴露**：base 上直接绿 → `exit 1`；红得不对 → `exit 2`；CI `world-client` job 红。
- **对应物**：[red-first.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first.ts#L1-L36)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L33-L38)；[P1_SHORE_BAND_DESIGN.md](file:///D:/project/pixel-world-engine/docs/P1_SHORE_BAND_DESIGN.md#L287-L300) 的实测红→绿顺序。

### T2 红必须是断言失败

**状态**：`[已实现]`
- **触发**：看到任何红灯，准备进入实现。
- **怎么做**：确认失败类型是 `assertion`。`module`（模块解析）、`compile`（语法/类型）、`crash`、`unknown` 一律不可采信。测试依赖尚未存在的模块时，用动态 import + `typeof` 断言，让红落在断言而不是 module-not-found。
- **违反暴露**：`red-first` 打 `exit 2 / ERROR`，并打印归类；日志里能看到 `kind=module|compile|crash|unknown`。
- **对应物**：[red-first-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first-lib.ts#L138-L197) 分类顺序（基础设施错误优先）；[P1_SHORE_BAND_DESIGN.md](file:///D:/project/pixel-world-engine/docs/P1_SHORE_BAND_DESIGN.md#L289-L300) 的停止条件。

### T3 不加临时白名单、不排除新增测试、不用「重跑一次绿了」当通过

**状态**：`[已实现-CI 全量]` + `[人工步骤-白名单]`
- **触发**：想让某个测试别跑、想加跳过、或重跑后变绿。
- **怎么做**：`npm test` 必须全量跑，不许排除新增测试；`red-first` 只允许 `SNAPSHOT_LIKE_TESTS` 这个写死的清单（逐条写原因），不得为通过而新增白名单条目，新增测试也不得进清单；review 任何 run 必须看首跑 `gh run view <run-id> --attempt 1`；批量排查用 `npm run ci:attempt1 -- --since <date>`。重跑前必须说清上一次为什么红。
- **违反暴露**：`red-first` 会打印 skip 原因；`ci:attempt1` 会列出「首跑红、最终绿」的 run；但「有人偷偷往清单加新测试」没有自动拦截，只能 review。
- **对应物**：[red-first-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first-lib.ts#L29-L63)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L32-L38)；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L264-L288) E5；[ci-attempt1-audit.mjs](file:///D:/project/pixel-world-engine/scripts/ci-attempt1-audit.mjs)。

### T4 修 bug 前先能复现

**状态**：`[人工步骤]`（自动检查 `[尚未实现]`）
- **触发**：准备改代码修一个 bug。
- **怎么做**：先拿到最小复现、复现命令与频率；至少有一次可重复失败，或有足够机制证据解释为什么只在特定条件下出现。0/N 且无机制证据时，不改代码，先补观测。修完后在缺陷台账写修复前/后读数。
- **违反暴露**：缺陷台账条目缺「最小复现 / 频率」时，只能 review 发现；没有 CI 字段强制。
- **对应物**：[BUGS_FOUND.md](file:///D:/project/pixel-world-engine/docs/BUGS_FOUND.md#L411-L436) 的 1/32 复现与 0/32 反例；同文件的「最小复现」条目；[P1_SHORE_BAND_DESIGN.md](file:///D:/project/pixel-world-engine/docs/P1_SHORE_BAND_DESIGN.md#L287-L300) 的先红后实现。

## 3. 验证分层

### V1 静态与单测

**状态**：`[已实现]`
- **触发**：任何代码改动。
- **怎么做**：`npm run check`；`npm test`。CI 的 `world-client` job 会跑这两步，失败即红。
- **违反暴露**：脚本非零退出；CI 红。
- **对应物**：[world-client/package.json](file:///D:/project/pixel-world-engine/world-client/package.json#L7-L16)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L29-L32)。

### V2 闸门脚本

**状态**：`[已实现]`
- **触发**：提交前、合并前。
- **怎么做**：跑 `npm run audit:ports`、`node scripts/audit-palette.mjs --strict`、`audit-references`、`audit-citations`、`audit-sections`、`audit-claims`；本地再跑 `node scripts/worktrees-audit.mjs --strict` 与 `npm run check:hooks`。
- **违反暴露**：任一条 exit 1；CI 对应步骤红。`worktrees:audit` 在 CI 里是非 strict，只提示不红，见 W1。
- **对应物**：[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L29-L53)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L99-L110)；[package.json](file:///D:/project/pixel-world-engine/package.json#L5-L9)。

### V3 复现性：多钉 + 同参数两跑比 sha + 树 id 防端口串树

**状态**：`[已实现]`
- **触发**：渲染/世界/判据相关的读数。
- **怎么做**：钉住时刻、潮位、相位、角色、轨迹、天气；同参数两跑逐帧 sha256 必须相同；脚本连接本机 vite 前先校验 `/__tree-id`，路径不一致即红。模拟层可用 `trace:record` / `trace:replay` / `trace:to-test` 固定轨迹。
- **违反暴露**：sha 不一致；树 id mismatch 打印「你连的是 52xx 那棵树…」并退出 1。回放夹具的判据＝`npm run fixture:check` 全绿（CI `world-client` job 已接，见 [ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L33-L34)）。**本节唯一的读数坐标**：2026-11-08 / `fbb2b85` 实测 6 条夹具 / 195 项断言 / 6 PASS 0 FAIL / exit 0；其它位置引用这句，不复制数字。
- **不断言**：`street_greet / street_together / street_quarrel / street_yield` 彼此没有确定先后。同一 tick 由 [`livelyBetween`](file:///D:/project/pixel-world-engine/world-client/src/world/liveliness.ts#L263-L341) 的分支优先级择一（争执 → 让路 → 搭手 → 问候），但跨 tick 的次序由站位、行走、信任、冷却和哈希槽共同决定；夹具只断言各类是否出现、参与者与状态约束，不把当前次序固化成规则。
- **对应物**：[pin-shot-state.ts](file:///D:/project/pixel-world-engine/world-client/src/render/pin-shot-state.ts#L57-L95)；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L1-L19)；[tree-identity.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/lib/tree-identity.mjs#L1-L18)；[fixture-check.ts](file:///D:/project/pixel-world-engine/world-client/scripts/fixture-check.ts)。

### V4 判据层

**状态**：`[已实现-部分]`（判据层闸在；D 比值闸未实现，`check-glow-contrast` 已降为只读读数工具）
- **触发**：改画面、几何、性能或相位行为。
- **怎么做**：结构差用 `screens-diff.py` 三层判据并跑自检；落地影用 G0–G3；逐帧预算用 `check-render-budget`；相位用 `check-phases`。判据层只回答「这次是否越线」，不替代证据层。
- **违反暴露**：自检或闸门 exit 1。`check-glow-contrast.mjs` 已不判定、退出码恒 0，它输出的比值只是读数，不是判据；D 比值闸仍未实现（见 C4）。
- **对应物**：[screens-diff.py](file:///D:/project/pixel-world-engine/world-client/scripts/screens-diff.py)；[verify-screens-diff-selfcheck.py](file:///D:/project/pixel-world-engine/world-client/scripts/verify-screens-diff-selfcheck.py)；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L14-L27)；[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L9-L18)。

### V5 证据与账本层

**状态**：`[已实现-账本]` + `[人工步骤-汇总入口]`
- **触发**：任何要写进 docs/evidence 或账本的读数。
- **怎么做**：账本 12 个必填字段齐全（含 `seed / weather / rainSeed / denominator / source / script_sha / judge`）；脚本改了必须重测并同步 `script_sha`；外部证据树脚本未提交时写 `not_measured`。汇总入口 `verify-all.mjs` 只做人工手动入口。
- **违反暴露**：`verify-ledger-selfcheck` 或账本校验红；`verify-all.mjs` 非零。它是**人工聚合入口**，不在 CI，所以 CI 绿不代表它跑过；这句话的坐标不在正文里——权威登记在 `audit-orphan-gates` 的盲区候选（见 [ORPHAN_GATES.md](file:///D:/project/pixel-world-engine/docs/ORPHAN_GATES.md)「已知边界」）：一旦有人把它接进 workflow 或 npm script，读数会自己从「盲区候选」移到「有消费方」。
- **对应物**：[eval-ledger-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/eval-ledger-lib.ts#L1-L45)；[verify-ledger-selfcheck.ts](file:///D:/project/pixel-world-engine/world-client/scripts/verify-ledger-selfcheck.ts)；[VERIFIABLE_FLOWS.md](file:///D:/project/pixel-world-engine/docs/evidence/VERIFIABLE_FLOWS.md#L279-L299)。

## 4. 证据纪律

### E1 每条结论附命令回显原文

**状态**：`[人工步骤]`（`audit-claims` 只覆盖已登记数字）
- **触发**：在文档、issue、回报里写「已通过 / 读到 X / 不达标」。
- **怎么做**：附命令、本次读数、exit code；易变读数写「本次运行」并给出取当前值的命令，不把历史读数当当前值。
- **违反暴露**：没有命令回显的结论只能 review；已登记 claim 由 `audit-claims` 复算。
- **对应物**：[p1-shore/README.md](file:///D:/project/pixel-world-engine/docs/evidence/p1-shore/README.md#L325-L340) 的命令与退出码表；[palette-threshold/README.md](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/README.md#L210-L229) 的复跑段。

### E2 截图 4× 最近邻并附 sha256 清单

**状态**：`[人工步骤]`
- **触发**：用截图证明几何/像素级结论。
- **怎么做**：`device = (world − worldView) × 4 + 1`，原生 4×、最近邻、不重采样；每张图同时给 bytes 与 sha256；清单落进证据目录，不只留在临时目录。
- **违反暴露**：放大/重采样过的图不能复算；没有 hash 的图只能看一次。没有图片 lint，靠 review。
- **对应物**：[p1-shore/README.md](file:///D:/project/pixel-world-engine/docs/evidence/p1-shore/README.md#L308-L323) 的 bytes + sha256 表与 4× 口径；[palette-threshold/README.md](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/README.md#L25-L35) 的 4× 最近邻与 sha256。

### E3 关键产物做 blob 三方比对

**状态**：`[人工步骤]`
- **触发**：生成器产物、账本、关键截图要证明可复跑。
- **怎么做**：同一命令跑两次，分别算 `git hash-object --no-filters <file>`，再与已入库 blob 比对；三方相同才算可复跑。文本文件注意 `core.autocrlf`，不要拿工作区 sha256 直接比。
- **违反暴露**：blob 不一致；`git diff` 为空但 sha256 不同，说明行尾口径混了。
- **对应物**：[palette-threshold/README.md](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/README.md#L217-L229)。

### E4 未实测标 `[推断]`，实测后删标记并填实数

**状态**：`[人工步骤]`
- **触发**：写还没有跑过的结论。
- **怎么做**：标 `[推断]`，并写清缺哪一步；实测后删掉标记，填命令、读数、exit code。不得把 `[推断]` 留在交付文档里当事实。
- **违反暴露**：review 发现标记未删或数字无来源；没有通用 lint。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L1-L10) 的证据标签定义；[p1-shore/README.md](file:///D:/project/pixel-world-engine/docs/evidence/p1-shore/README.md#L370-L373) 的 `[推断]` 作废记录。

### E5 不许引用不可复核的材料

**状态**：`[已实现-账本]` + `[人工步骤-文档]`
- **触发**：引用未提交草稿、别人工作树里的文件、临时脚本或仓外路径。
- **怎么做**：只用已提交、当前树可读、或仓外产物有明确还原路径的材料；账本外部来源写 `not_measured`，不填假哈希；跨树读数必须标明树与提交，不能当本树读数。
- **违反暴露**：账本校验红；文档引用在 review 时才可见，`audit-citations` 只能抓当前树缺失。
- **对应物**：[eval-ledger-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/eval-ledger-lib.ts#L10-L18)；[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L756-L770)。

### E6 文档里不许写不存在的闸门、脚本或 CI 步骤

**状态**：`[已实现-部分]` + `[人工步骤-CI 清单]`
- **触发**：写「CI 会跑 X」「脚本会拦 Y」。
- **怎么做**：逐条对照 `.github/workflows/ci.yml` 实物和 `package.json` 的 scripts；不存在就标 `[尚未实现]`，不写成既有事实。引用/行号/节号/已登记数字用四个 audit 脚本兜底。
- **违反暴露**：`audit-references` / `audit-citations` / `audit-sections` / `audit-claims` 会红；但 `npm run <script>` 是否存在、CI 步骤是否真的在跑，不在这些闸的覆盖内，必须人工对照 `ci.yml`。
- **对应物**：[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L29-L53)；CI 实际在跑的六个审计：[audit-ports.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-ports.ts)、[audit-palette.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/audit-palette.mjs)、[audit-references.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-references.ts)、[audit-citations.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-citations.ts)、[audit-sections.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-sections.ts)、[audit-claims.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-claims.ts)。

### E7 描述闸门状态的现在时必须有坐标（2026-11-08）

**状态**：`[人工步骤]`（`audit-claims` 的受查面不包含这类句子，见「违反暴露」）
- **触发**：在文档里写某个闸门 / 脚本 / 检查「当前 N/M FAIL」「尚未接线」「未认领」「不是绿闸」这类状态。
- **怎么做**：二选一——写「判据＝命令 X，在哪里跑（CI job / 手工入口）」；或写「某 commit + 某日期 实测 N/M」。两样都没有的说法会被时间腐蚀，不许写。同一个读数在仓库里只留一份带坐标的原文，其余位置引用它，不复制成多份会各自漂移的副本。
- **落点**：状态句应指向**被机器强制的对象**（账本条目 / 判据命令），而不是断言一个会被时间腐蚀的现在时。「现在不在 CI」是没人负责改的全称否定；「`audit-orphan-gates` 记为 `pending-ci`」由四类等值预算强制——接线必须在同一提交删条并降预算，改账本的人与读这句话的人被同一次提交绑在一起。
- **违反暴露**：没有自动闸查这类句子——`audit-claims` 只管 markers 与 adr-schema，不覆盖「5/5 FAIL」这种读数，`audit-references` 也管不到语义；只能 review。反面教材是 `audit-references` 的 342 基线：一个过期读数被当成事实，后来没人敢更新，守卫守着一个失效数字（2026-11-08 实测 529，基线已另立）。
- **第二个发作（受查面数量）**：受查面数量必须有「可刷新的基线 + 过期判据」（`audit-scan-baseline.json` 的 `note` 记日期 / commit / 前后值 / 为什么刷，`STALE_RATIO` 判过期），不能靠测试里写死一个数字。本轮实测：`aa49a36` 重写 README 时顺手删掉唯一一条 `adr-count` claim 标记（值 12），claims markers 5→4，全场只有 `audit-claims.test.ts` 里写死的 `5` 在喊——写死的数字会把「内容变了」和「闸门坏了」搅成同一团红，下次文档一改又是一条假警报。测试应断言性质（每条 marker 与实测一致、扫描根齐全、地板在阈值内），数量交给基线。这与 342 基线是同一个病的两次发作。
- **对应物**：[ENGINEERING_DISCIPLINE.md](file:///D:/project/pixel-world-engine/docs/ENGINEERING_DISCIPLINE.md#L217-L224) E4（未实测标 `[推断]`）；[ENGINEERING_DISCIPLINE.md](file:///D:/project/pixel-world-engine/docs/ENGINEERING_DISCIPLINE.md#L225-L231) E6（不许写不存在的闸门）；[audit-claims.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-claims.ts)。

### E8 文档举例不得原样复制可被扫描器识别的构造（2026-11-08）

**状态**：`[人工步骤]`（不是 bug：写进文档的字面量就是被受查的对象）
- **触发**：在文档里举例说明某个机制或写法，顺手把一个可被扫描器识别的构造原样抄进去：claim 标记壳、真实存在的文件路径、可执行命令。
- **怎么做**：二选一——**变形**（描述而不照抄：写「`adr-count` 标记、值 12」而不是连标记壳一起抄；写「一个形如 xxx.test.ts 的假文件名」而不是一个会被当成引用的路径）；或**标明示意**（用带占位符的形状，如 `check-<名字>.mjs`——扫描器按 glob 跳过，人也不会当成真文件）。
- **违反暴露**：两次实测同形。① 一条注释里写了假测试文件名，被 `audit-citations` 当成真引用判「未解析」（它只认反引号里的 token，不区分注释与正文）；② 在 E7 正文里原样抄了 claim 标记壳，被 `audit-claims` 当成真登记扫进去，markers 从 4 变回 5。两次都不是闸门错，是**引用即被受查**。
- **判据**：改完跑 `node world-client/scripts/audit-claims.ts --strict` 与 `node world-client/scripts/audit-citations.ts --strict`：只为说明而写的字面量不应改变这两项的读数。
- **对应物**：[ENGINEERING_DISCIPLINE.md](file:///D:/project/pixel-world-engine/docs/ENGINEERING_DISCIPLINE.md#L225-L231) E6（不许写不存在的闸门）；[audit-claims.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-claims.ts)；[audit-citations.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-citations.ts)。

## 5. 预算与棘轮

### B1 两级阈值：设计目标不动，天花板只降不升

**状态**：`[已实现]`（`check-ground-shadow` 的接线状态只在 L2 记一处，这里不复述）
- **触发**：改渲染路径、加常驻绘制、或预算读数上升。
- **怎么做**：设计目标是意图，不许动；天花板是实测棘轮，只有「删掉等价或更多命令」才自动下降；峰值 ≤ 目标算不欠债，目标与天花板之间记账，超过天花板才硬红。
- **违反暴露**：`check-render-budget` 超 `33,488` 红；`check-ground-shadow` 超 `34,666` 红；中间区间只记账不红。**「只降不升」已由 `test/policy-ceilings.test.ts` + `scripts/policy-ceilings.json` 锁定**：脚本常量大于已批准值即红，失败信息写明「这是政策常数，不是实测值」，抬升必须在同一次提交里改记录并填 `approved_at` / `approved_by` / `reason`。拦不住的部分如实列：运行时 env 覆盖（`GROUND_SHADOW_PEAK_CEILING` / `RENDER_BUDGET_FORCE_COMMANDS`）、先降到批准值以下再涨回原值（仍 ≤ 已批准值）、以及 `reason` 是否属实；降低无需改记录，测试只提示可收紧。
- **对应物**：[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L71-L119)；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L58-L66)；[policy-ceilings.json](file:///D:/project/pixel-world-engine/world-client/scripts/policy-ceilings.json)；[policy-ceilings.test.ts](file:///D:/project/pixel-world-engine/world-client/test/policy-ceilings.test.ts)。

### B2 新功能导致的抬升必须单独记账

**状态**：`[人工步骤]`（闸门只能抓越线，不能抓「谁抬/为什么」）
- **触发**：新功能让峰值上升。
- **怎么做**：单独记「谁抬 / 抬多少 / 为什么 / 夹带削减 / 状态」；抬升与削减分两行记，不混成净数。实例：本轮合并后净差 **+88 条**，**全部归 lighting**（接触 AO / 灯压暗环 / 落地影分段）；逐栋板缝 13→13 未变；shore 的 **+321 条 fillRect** 只进一次性烘焙、逐帧增量 **0 条**，必须单独记，不能拿来抵 +88。不许用抬升后的值当新基线继续往下卖；同步账本的 `script_sha`。
- **违反暴露**：不记账但超过天花板会红；刚好在天花板内则不红，只能 review 发现。
- **对应物**：[p1-shore/README.md](file:///D:/project/pixel-world-engine/docs/evidence/p1-shore/README.md#L375-L386) 的记账格式；[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L115-L117)；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L379-L390)。

### B3 不许把抬升后的值当作新基线

**状态**：`[人工步骤]`
- **触发**：下一轮要「优化」预算。
- **怎么做**：抬升值只作为当轮账目存在；后续下降只能来自删除等价或更多命令。不能把 `33,488` / `34,666` 当成「当前基线」再宣布小幅优化。
- **违反暴露**：读数仍在天花板内不会红；review 对照 B2 的账目才能发现。
- **对应物**：[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L102-L104)；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L379-L383)。

### B4 每个记录器有自己的天花板

**状态**：`[人工步骤]`（常量已分别写死）
- **触发**：拿一个记录器的天花板去套另一个记录器。
- **怎么做**：按记录器分别取天花板；`check-render-budget` 用 `33,488`，`check-ground-shadow` 用 `34,666`；机位、分辨率、相位集合不同，不互换。
- **违反暴露**：套错会得到假红/假绿；脚本不会阻止跨记录器引用，靠 review。
- **对应物**：[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L89-L106)；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L60-L66)。

### B5 天花板必须来自同窗口采样

**状态**：`[人工步骤]`（脚本内已按连续帧采样）
- **触发**：定天花板、复测峰值、解释「变重」。
- **怎么做**：取同一记录器、同一组配置、连续帧的稳态峰值；不取过渡帧、泄漏帧、只读开局单帧；至少两跑比极差。
- **违反暴露**：取错窗口会把 33,741（泄漏帧）当成本，或把 52,125（旧雾）当基线；review 与 B1 的账目会发现。
- **对应物**：[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L13-L21) 与同文件 `33,741` 泄漏帧注释；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L18-L19)；[GATE_CALIBRATION.md](file:///D:/project/pixel-world-engine/docs/GATE_CALIBRATION.md#L9-L15)。

## 6. 工作树与并发

### W1 一工作树一线；不在别人在用的树里切分支

**状态**：`[已实现-登记巡检]` + `[人工步骤-归属判断]`
- **触发**：新建 worktree、切分支、接手别人的树。
- **怎么做**：一树一线；新建时先在 `docs/WORKTREES.md` 加一行再开工；不替别人切分支。跑 `npm run worktrees:audit`，本地用 `--strict`。
- **违反暴露**：`--strict` 对未登记/过期/表项悬空 exit 1；CI 是非 strict，只提示，所以「未登记」在 CI 不会红。
- **对应物**：[WORKTREES.md](file:///D:/project/pixel-world-engine/docs/WORKTREES.md#L5-L12)；[WORKTREES.md](file:///D:/project/pixel-world-engine/docs/WORKTREES.md#L22-L29)；[worktrees-audit.mjs](file:///D:/project/pixel-world-engine/scripts/worktrees-audit.mjs)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L108-L110)。

### W2 不 stash、不丢弃、不 checkout 别人的文件

**状态**：`[尚未实现]`（无自动闸；只有书面边界）
- **触发**：合并、切换、清理、测试失败想「先 stash 一下」。
- **怎么做**：不 `git stash`、不 `git checkout --` 别人的改动、不删除未跟踪文件。看到别人工作树在写，停手。`docs/RESUME.md` 里建议 stash 的旧口径与本条冲突时，以本条为准。
  - **要取「改造前」的对照产物**：**能不 worktree 就不 worktree**。先提交，再 `git switch --detach <base>` 跑一遍，然后 `git switch` 回原分支——共用同一份 `node_modules`，锁文件没变就不用重装；产物用 `git show HEAD:<path> > tmp/...` 或 `git archive` 导出。条例如 `git stash` 一律不用。
  - **万不得已要开 worktree**：**先摘链接点，再删树**。`[System.IO.Directory]::Delete($junctionPath)`（或 `cmd /c rmdir <junction>`，**不带 `/s`**），确认它已变成普通空目录，才 `git worktree remove`。
  - **一句话判据**：`Remove-Item -Recurse`、`rmdir /s`、`git worktree remove --force` **三个都会穿 junction**，都不许对含 junction 的路径用。其中不带 `--force` 的 `git worktree remove`：**本次实测是 `--force` 穿过去的；未带 `--force` 时预期它会因未跟踪文件而拒绝，但未实测**。
- **违反暴露**：没有脚本检测；只能靠 `git status`、reflog 与 review。丢工作通常事后才能发现，这是本周最容易踩的一条。**失效边界（同一形状已发生四次，前两次与第四次有读数）**：删**未跟踪目录**也会透过 `node_modules` junction 伤到共享依赖。
  - 第一次（2026-11-07）：`Remove-Item -Recurse` 清临时树时删掉了主树 `world-client/node_modules/.bin` 与 rolldown 原生绑定，`npm install` 后恢复，无 tracked 改动。
  - 第二次（2026-11-08）：同形状再现——`@rolldown/binding-win32-x64-msvc` 只剩 `.node`、缺 `package.json`，`npm ls` 报 `invalid: "1.2.15"`，`vite build` 报 `Cannot find native binding`，全量 `npm test` 因此红 1 条（`issue-13-acceptance.test.ts` 的 vite build 条件）。`npm i` 修好（`npm ls` 报 1.2.15、`package.json` 与 `.node` 都在、构建 793ms 通过、`npm test` 回到 2600/2591/0/9），但**「`npm i` 能修好」不等于「没有代价」**：修的时候另有两处 dev server 在跑（`pwe-site-hours` 5230 用自己那份依赖，主树 5211 用这份），它们用的就是被换掉的那份依赖；主树 5211 的 vite 还把旧 `.node` 锁着，留下 `@rolldown/.binding-win32-x64-msvc-7ws3PCOL` 删不掉，只能等它退出。
  - 第四次（2026-11-09）：为取改造前读数，临时 worktree 用 junction 把 `node_modules` 指回主树；收尾 `git worktree remove --force` 顺着 junction 删掉主树依赖（`@playwright/test` 等被删、`node_modules` 只剩 20 项、`.bin` 为空），命令报 `failed to delete … Invalid argument` 才停。`npm ci` 复原，随后冷启重跑 check / test / fixture / 两闸 / 逐字节，全绿。**教训**：本次实测是 `--force` 穿过去的（未带 `--force` 的情形未实测）；顺序只能是先摘链接点再删树。
  - 判据：删临时树前先确认里面没有指向共享 `node_modules` 的 junction / 符号链接（`Get-Item <path> | Select-Object LinkType,Target`）。**回收工作树后的收尾检查**必须跑这两条，它们是损坏时最先红的读数：`npm ls --all 2>&1 | Select-String invalid`（须为空）、`npx vite build`（须成功）。
- **对应物**：[VERIFIABLE_FLOWS.md](file:///D:/project/pixel-world-engine/docs/evidence/VERIFIABLE_FLOWS.md#L9-L13)；[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L756-L762)；[RESUME.md](file:///D:/project/pixel-world-engine/docs/RESUME.md#L86-L87) 的旧 stash 建议（与本条冲突，以本条为准）。

### W3 端口只用 5210–5299，带 `--strictPort`，跑之前断言树 id

**状态**：`[已实现-部分]`（范围 lint `[尚未实现]`）
- **触发**：起 dev/preview，或写一个连接本机 vite 的 check 脚本。
- **怎么做**：每棵树在 5210–5299 内固定一个端口（避开 5212 给 accept-live），导出 `PIXEL_WORLD_CLIENT_PORT=52xx` 与 `PIXEL_WORLD_URL=http://127.0.0.1:52xx/`；`npm run dev` 已带 `--strictPort`，CI preview 也显式带；脚本连接前调用树身份闸校验 `/__tree-id`。
- **违反暴露**：`audit:ports` 只禁 5188/5191/5202/5203，**不检查 5210–5299 范围**；端口被占 `--strictPort` 直接失败；身份不一致/端点不可达/返回体非法 exit 1。
- **对应物**：[audit-ports.ts](file:///D:/project/pixel-world-engine/world-client/scripts/audit-ports.ts#L15-L37)；[tree-identity.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/lib/tree-identity.mjs#L1-L18)；[world-client/package.json](file:///D:/project/pixel-world-engine/world-client/package.json#L8-L11)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L73-L82)。

### W4 同一棵树上两条线并行写 → 停下、留痕、等提交点

**状态**：`[人工步骤]`
- **触发**：合并窗口里发现同一棵树还有别的线在写。
- **怎么做**：停止 add/commit/checkout/跑测试（跑测试也可能改写工作区文件）；在 issue/台账留痕；等对方自己收尾，并以它的提交为准再核对。
- **违反暴露**：会截到半成品，事后分不清哪部分已定稿；没有自动闸，只能靠两次 `git status`/mtime 对比发现。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L355-L360) G3；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L700-L703) K3/K5。

## 7. 合并窗口

### M1 合前勘察

**状态**：`[人工步骤]`
- **触发**：准备合入任何分支。
- **怎么做**：跑 `git worktree list --porcelain`；对每棵树跑 `git status --short --branch` 看分支与脏状态；逐条读 `.github/workflows/ci.yml` 实物列出现有闸门；与候选分支的 CI 清单对照。
- **违反暴露**：漏看脏树会带入别人的半成品；漏看 CI 清单会以为某个闸存在。没有自动合前检查。
- **对应物**：[WORKTREES.md](file:///D:/project/pixel-world-engine/docs/WORKTREES.md#L14-L29)；[p1-shore/README.md](file:///D:/project/pixel-world-engine/docs/evidence/p1-shore/README.md#L342-L406) 的合并前清单。

### M2 基准必须最新

**状态**：`[人工步骤]`
- **触发**：判断某分支是否已混入 main，或报「差异混入」。
- **怎么做**：先 `git fetch origin`，再 `git rev-list --left-right --count main...origin/main`；本地 `main` 与本地 `origin/main` 都可能是旧引用。报「混入」前先确认比较基准。
- **违反暴露**：拿旧基准比较会把「本地没 fetch」误报成「对方混入」；没有自动闸。
- **对应物**：[red-first.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first.ts#L17-L26) 明确写了 `origin/main` 可能没 fetch；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L704) K7。

### M3 冲突逐条读；编号冲突先入者保号

**状态**：`[人工步骤]`
- **触发**：rebase/merge 出冲突。
- **怎么做**：逐 hunk 读，不整段 `--ours` / `--theirs`；编号冲突时先入者保号、后入者顺延，并同步互引。已知改号记录：K3 的 E7 → E8。
- **违反暴露**：整段取一边会丢另一边的改动；编号重复会让跨文档互引指错。没有自动检测。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L694-L704) K 清单与 K3 改号记录。

### M4 区分「前向引用」与「真缺陷」

**状态**：`[人工步骤]`
- **触发**：合入后文档引用红，或发现行为不对。
- **怎么做**：前向引用 = 目标只在另一分支，当前红可放行，但必须登记目标分支与合入点，合完回访；真缺陷 = 当前树行为错误或引用全历史不存在，当场修，按 T1 先红后绿并写缺陷台账。引用幻影按 C6 处理，不当作前向。
- **违反暴露**：前向引用不回访会变成永久红/幻影；真缺陷只改文档会留下行为错误。`audit-citations` 能抓当前缺失，不能替你判断前向还是缺陷。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L347-L353) G2；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L645-L662) MAT-G7 真缺陷处置；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L362-L367) G4。

### M5 合完回访

**状态**：`[已实现-audit]` + `[人工步骤-关闭登记]`
- **触发**：任何合并完成。
- **怎么做**：跑 `node scripts/audit-citations.ts --strict` 与 `node scripts/audit-references.ts --strict`；确认前向引用归零；逐条看 K/J 清单，该关闭的关闭、该改 owner 的改 owner。合完不回访等于没合。
- **违反暴露**：未解析引用仍红；登记条目挂空；review 能发现，但没有自动关闭。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L347-L353) G2 的消解点（具体读数以当次 `audit-citations --strict` / `audit-references --strict` 输出为准，本条只规定判据）；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L694-L704) K 清单。

### M6 分支编号只是临时占位；引用用锚点；合并时终局核对

**状态**：`[人工步骤]`
- **触发**：任何新增 `E` / `K` / `J` 编号条目，以及任何合并完成。
- **怎么做**：
  1. **分支上的编号是临时的，合并在主树上定稿**。分支回报必须写「本分支占用的号 + 合入时可能与谁撞」（同一号、不同事，都要点名）。
  2. **引用一律用标题/锚点，不用编号**。编号只是显示顺序，不是引用坐标——与「引用优先锚点、不用行号」同一理由。
  3. 合并时必须终局核对：全仓 `E` 编号唯一、无同号不同事，并在 `OPEN_ISSUES.md` 生成一张最终登记表（号 → 标题 → 归属分支 → 合入提交）。
- **违反暴露**：三个分支各自手工分配编号，撞号是迟早的事；编号被当引用坐标会让互引指错，改号后引用全断。没有自动检测。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md) §K（合并窗口未闭合清单）；[ENGINEERING_DISCIPLINE.md](file:///D:/project/pixel-world-engine/docs/ENGINEERING_DISCIPLINE.md) M3（先入者保号、后入者顺延）。

## 8. 遗留与孤儿闸门

### L1 长期红必须有人认领

**状态**：`[人工步骤]`（自动 owner 检查 `[尚未实现]`）
- **触发**：某个检查长期红或长期跳过。
- **怎么做**：写清归属线与下一步（修复 / 重录基线 / 保持记录项）；没人认领前不许从 CI 或手工清单里静默移除。一个长期红且无人认领的检查等于没有检查。
- **违反暴露**：没有 owner 字段校验；只能 review K/J 清单。J1（回放夹具漂移）已闭合：判据＝`npm run fixture:check` 全绿、CI `world-client` job 已接；读数坐标见 V3「违反暴露」，本节不复制数字。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L691-L692) 的纪律；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L698) J1；[fixture-check.ts](file:///D:/project/pixel-world-engine/world-client/scripts/fixture-check.ts)。

### L2 孤儿闸门逐条接进 CI，不许一次性全接

**状态**：`[人工步骤]`（自动完整性检查 `[尚未实现]`）
- **触发**：发现一个能跑但不在 CI 里的脚本。
- **怎么做**：按 K4 清单逐条接；接一条、删一条允许清单；等 `chore/orphan-gates` 合并后单独开分支改 `ci.yml`；不要两条分支同时改 `ci.yml`。
- **违反暴露**：一次性全接会让第一次运行就是一片既有红，之后所有人都会忽略它。`check-ground-shadow` 不在 CI——权威状态在 `audit-orphan-gates` 的账本条目：`scripts/orphan-gates-allowlist.json` 里 `world-client/scripts/check-ground-shadow.mjs` 那条，`kind: pending-ci`；理由是 30 轮实测 4 红（13.3%），红因首张同刻图早于调色收敛，撤回等 `shotStable`。接线时必须在同一提交删条并降预算，否则账本会红。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L701) K4；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L29-L33) 的接线顺序；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml)。

### L3 编号先入者保号

**状态**：`[人工步骤]`
- **触发**：两份文档/两条线合并时出现同号条目。
- **怎么做**：先入者保号；后入者顺延；两边同步互引。改号必须留痕，不静默重排。
- **违反暴露**：同号条目会让引用指错；没有自动编号检查，只能 review。
- **对应物**：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L700) K3 的「原误记 E7，已改号」；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L694-L696) K 清单说明。

## 9. 环境化纠正

### X1 出了问题先改环境，让错不可能发生

**状态**：`[人工步骤]`（结构修复样例已有，教训登记表 `[尚未实现]`）
- **触发**：出现一次本可避免的错误。
- **怎么做**：先问「为什么环境允许它发生」，把它变成测试、lint、CI job 或结构闸；不要只写「下次注意」。不能结构化的，明确标为纪律，并配抽样/留痕/外部核对。
- **违反暴露**：只写 markdown 的规则不会红；没有抽样就是「不知道」。本仓已有 audit、色板测试、渲染输入登记、worktrees 巡检、pre-push 等结构修复样例。
- **对应物**：[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L741-L808)；[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L231-L276)；建议但尚未创建的教训登记表见同文 §4.4（`[尚未实现]`）。

### X2 信任阶梯：先外框与验收形态，再测试，最后实现

**状态**：`[人工步骤-第一段]` + `[已实现-后两段]`
- **触发**：新功能、新模块、大改渲染。
- **怎么做**：① 先倒推外框与验收形态（模块职责、唯一入口、判据形态、证据落点）；② 再写可独立验收的测试，先红；③ 最后写实现，红转绿。
- **违反暴露**：第一段没有闸，只能 review；后两段由 `red-first` 强制——先实现后补一个在 base 上也绿的测试会 `exit 1`。
- **对应物**：[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L231-L276) architect 先定外框；[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L345-L396) TDD；[red-first.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first.ts#L1-L15)。

### X3 skill 自迭代改造按「四块判据 + 四类验证边界」执行

**状态**：`[人工步骤]`（判据与模板见规范文档；完整性 lint `[尚未实现]`）
- **触发**：改造、迭代或接任本仓任一 skill / 工作流文档（`docs/agents/` 下的文件、`CLAUDE.md` 的 Agent skills 节、后续入仓的 skill 定义）。
- **怎么做**：先按规范文档的四问诊断模板给出结论与证据（文件 + 小节），补报一次；再与用户确认验收标准，只问缺失或矛盾项、最多 3 个；然后按四块结构改造，「三件套」（工作流程图、任务清单、脚本清单）缺一不可；交付按收尾五问逐条作答，并按四类验证边界给每一项标 5.1 / 5.2 / 5.3 / 5.4。验收标准未确认前不做大范围重构；这里的边界与 X1 的分工按规范文档的条件表判定，不按「更严」自动选边。
- **违反暴露**：没有脚本核对三件套是否齐、四类边界是否被混称，只能 review。声明「已验证」但只有 5.2 / 5.4 口径的，按 E4 与 E6 当未验证处理。
- **对应物**：[SKILL_ITERATION_STANDARD.md](SKILL_ITERATION_STANDARD.md#L1-L20) 的四块判据、三件套、`[需人工]` 标注、四类边界、收尾五问与诊断模板；[AGENT_TRUST_AND_VERIFIABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/AGENT_TRUST_AND_VERIFIABILITY.md) 的证据标签与信任阶梯。

## 10. 尚未实现清单（不得当作闸门引用）

以下项目在 2026-11-07 的当前树上没有完整对应物，或只有人工步骤。写文档、回报、PR 说明时不得把它们写成「已有闸门」：

1. 通用的全称断言 lint（只有岸带 J9 这个真实枚举样例 + 设计稿写作规矩）。
2. 通用的阈值三件套 lint（`audit-claims` 只覆盖已登记 claim）。
3. 阈值形式 D 的闸：`check-glow-contrast.mjs` 已改为只读（无判定、退出码恒 0、不在 CI），它输出的比值不是闸；D 比值闸本身仍未实现，H1 待办 1 未完成。
4. 判据与比较对象同源的 lint（无）。
5. 自动编号冲突检测（无）。
6. 自动「不 stash / 不丢弃 / 不 checkout 别人文件」检测（无）。
7. 端口 5210–5299 范围的 lint（`audit:ports` 只禁 5188/5191/5202/5203）。
8. 孤儿闸门完整性检查（main 没有 `audit:orphan-gates`；只有 K4 人工清单；`chore/orphan-gates` 分支上的脚本尚未合入）。
9. 长期红的 owner 自动检查（无）。
10. 前向引用自动回访（`audit-citations` 只能抓当前缺失）。
11. 教训登记表（ENVIRONMENT §4.4 建议，尚未创建）。
12. ~~`fixture:check` 不是绿闸~~ — 已闭合（J1 重录后接进 CI）：判据＝`npm run fixture:check` 全绿、CI `world-client` job 已接；读数坐标见 V3「违反暴露」。本条保留在原位是为了让清单编号不挪动，事务性内容已被 V3 取代。
13. `verify-all.mjs` 是人工手动入口，不接 CI；没有脚本阻止别人把它接进去。
14. `audit:reports --strict` 未接 CI，且当前 main 没有该脚本（p1-shore §6.7 的已知缺口）。
15. skill 改造的自检：`scripts/audit-skill-docs.ts` 已能查三件套、互指、必含列与退出码 / 在 CI 真值、声称与证据痕迹；但只有 npm 入口、warn 期退出码 0、未接 CI，也不判证据内容是否成立。

## 11. 来源

本仓已存在的对应物：

- 判据与设计：[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L395-L440) H1；[GATE_CALIBRATION.md](file:///D:/project/pixel-world-engine/docs/GATE_CALIBRATION.md#L9-L42)；[DESIGN_ACCEPTANCE.md](file:///D:/project/pixel-world-engine/docs/DESIGN_ACCEPTANCE.md)；[P1_SHORE_BAND_DESIGN.md](file:///D:/project/pixel-world-engine/docs/P1_SHORE_BAND_DESIGN.md#L10-L14)；[palette-threshold/README.md](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/README.md#L8-L13)。
- TDD：[red-first.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first.ts#L1-L36)；[red-first-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/red-first-lib.ts#L29-L63)；[ci.yml](file:///D:/project/pixel-world-engine/.github/workflows/ci.yml#L33-L38)。
- 验证分层：[VERIFIABLE_FLOWS.md](file:///D:/project/pixel-world-engine/docs/evidence/VERIFIABLE_FLOWS.md#L9-L13)；[AGENT_TRUST_AND_VERIFIABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/AGENT_TRUST_AND_VERIFIABILITY.md)。
- 预算与棘轮：[check-render-budget.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-render-budget.mjs#L71-L119)；[check-ground-shadow.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-ground-shadow.mjs#L58-L66)；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L369-L390) G5。
- 工作树与合并：[WORKTREES.md](file:///D:/project/pixel-world-engine/docs/WORKTREES.md#L5-L29)；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L347-L392) G2–G5；[OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md#L694-L704) K 清单。
- 证据与账本：[p1-shore/README.md](file:///D:/project/pixel-world-engine/docs/evidence/p1-shore/README.md#L308-L340)；[palette-threshold/README.md](file:///D:/project/pixel-world-engine/docs/evidence/palette-threshold/README.md#L210-L229)；[eval-ledger-lib.ts](file:///D:/project/pixel-world-engine/world-client/scripts/eval-ledger-lib.ts#L1-L45)。

关于 poteto mode 与 Matt skills：

- poteto mode 在本仓的落地记录见 [VERIFIABLE_FLOWS.md](file:///D:/project/pixel-world-engine/docs/evidence/VERIFIABLE_FLOWS.md#L9-L13) 与 [AGENT_TRUST_AND_VERIFIABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/AGENT_TRUST_AND_VERIFIABILITY.md) 的来源附录。原始 SKILL.md 装在仓外，不入仓；本文不按印象补写其流程。
- Matt skills 在本仓只有消费约定：[docs/agents/domain.md](file:///D:/project/pixel-world-engine/docs/agents/domain.md#L11) 提到 `/grill-with-docs` 的入口，[docs/agents/triage-labels.md](file:///D:/project/pixel-world-engine/docs/agents/triage-labels.md#L5-L13) 映射 `mattpocock/skills` 的标签。仓内没有 grill-with-docs 的 skill 定义，因此本文不描述它的流程。

## 12. 变更记录

| 日期 | 依据 | 变更 |
| --- | --- | --- |
| 2026-11-07 | 本周合并窗口暴露的问题：H1 的 `0.18` 判据造假；G5 的跨记录器 `33,445 / 34,666`；G3 的同树并发写；G2 的前向引用；G4 的引用幻影；E5 的重跑掩盖；K4 的孤儿闸门 | 首次固化本文件：40 条纪律，按任务类型组合使用；`[尚未实现]` 条目单独列出，禁止当既有闸门引用。 |
| 2026-11-07 | 外部《Skill 自迭代能力 改造指南》落成开发规范；skill 改造缺少「三件套」「四类验证边界」的可执行口径 | 新增 X3（纪律共 41 条）并配套 [SKILL_ITERATION_STANDARD.md](SKILL_ITERATION_STANDARD.md)：四块判据、三件套、`[需人工]` 标注、四类验证边界、收尾五问、可复制诊断模板，以及与既有条款的逐条关系与冲突条件；§0 取值表与 §10 同步增加对应行。 |
| 2026-11-08 | 静默普查：13 条 `[裸]` 里有 6 条是同一动作——`?? 默认值` / `catch {}` 顶替实测读数（#1 #2 #3 #4 #11 #12） | 新增 C7（纪律共 42 条）：喂判据的读数缺失必须抛，只有仅供人看的展示字段可用默认值；逐条指到这一族的六处，并记 `#4` / `#5` 已修、`check-ground-shadow.mjs` 的四条留待第二轮。 |
| 2026-11-08 | 三个分支各自手工分配 `E` 编号，撞号（main E9 vs chore E9）与「在途正文写出会当场变假的断言」（E12 写「E10/E11 未被占用」） | 新增 M6（纪律共 43 条）：分支编号只是临时占位、合并时主树定稿；引用一律用标题/锚点；合并时终局核对并生成 `E` 登记表。§K 第 10 条登记 E12 正文改写与终局核对动作。 |
| 2026-11-08 | 两次同形的「引用即被受查」：注释里的假测试文件名被 `audit-citations` 当真引用；E7 正文里照抄的 claim 标记壳被 `audit-claims` 当真登记（markers 4→5） | 新增 E8（纪律共 44 条）：文档举例不得原样复制可被扫描器识别的构造——要么变形、要么标明示意；§0 的「写证据 / 读数」「只改文档 / 编号」两行同步加上 E8。 |
