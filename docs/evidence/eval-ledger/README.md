# 指标账本证据（eval-ledger）

- 日期：2026-11-04（第二次重测：基点切到 `origin/main` `10f61ac`）
- 分支：`eval/ledger-facts-question`，基线 `origin/main` `10f61ac`
- 账本：[eval/ledger.json](../../../eval/ledger.json)
- 闸门：[world-client/scripts/eval-ledger.ts](../../../world-client/scripts/eval-ledger.ts)、
  [world-client/test/eval-ledger.test.ts](../../../world-client/test/eval-ledger.test.ts)
- 哈希生成端：[world-client/scripts/eval-ledger-sha.ts](../../../world-client/scripts/eval-ledger-sha.ts)

## 读数

| 项 | 读数 |
| --- | --- |
| 登记指标 | 25 条（其中 2 条 `not_measured`，都有 `note`） |
| 校验耗时（CLI） | 4.4ms（读 25 条账本 + 重算 7 条 `script_sha`，5 个脚本文件） |
| 测试耗时 | 秒级（`node --test test/eval-ledger.test.ts`） |
| 必填字段 | `seed / weather / rainSeed / denominator / source / script_sha / judge` + `value / unit / measured_at / gate` |
| 造错守卫 | 删掉 `id` 后 `errors` 命中 `id`，退出码 1 |
| 行尾守卫 | 同一内容的 CRLF / LF 两个文件必须算出同一 `script_sha` |

`ledger-check.json` 是 `node world-client/scripts/eval-ledger.ts --json` 的原样输出。

## 本轮重测（`10f61ac` 上）

| 指标 | 旧值 | 新值 | 说明 |
| --- | --- | --- | --- |
| `render.drawCalls.static.p50` | 16130 | 16162 | 5 次计分轮 p50；两档 15514 / 16162，极差 648，均 < 30000。原始输出见 [render-budget-runs.txt](render-budget-runs.txt) |
| `palette.violations.world` | 0 | 0 | 世界层唯一色 24（引用 51）/ 预算 24，`--strict` 退出 0 |
| `palette.violations.ui` | 0 | 0 | UI 层唯一色 8（引用 166）/ 预算 8，`--strict` 退出 0 |
| `motion.structDiff.walk.min` | 17 | 18 | 迷路人 侧面 walk0→1；阈值 16 未动 |
| `motion.structDiff.idle.min` | 10 | 10 | 炉匠 背面 idle0→1；阈值 8 未动 |

未退化：render 与 palette 在同档/同一读数；walk 帧差比旧值更大（余量变大）。

## 行尾口径（为什么账本曾经必红）

仓库开着 `core.autocrlf=true`：索引是 LF，检出到 Windows 工作树是 CRLF。原实现直接对
工作树**字节**算 sha256，于是同一份账本里混进了两套哈希（`audit-palette.mjs`、`cast-motion.test.ts`
记的是 CRLF 哈希，`eval-counterfactual.ts` / `eval-rewind-qa.ts` / `eval-import-guard.ts`
记的是 LF 哈希），任何 checkout 都无法同时满足。

处理方式（不动全仓、不改 `.gitattributes`）：

- 生成端与校验端共用 `sha256OfContent` / `sha256OfFile`：先 `\r\n → \n` 归一化再算哈希；
- 生成端 `scripts/eval-ledger-sha.ts --write` 回写 `script_sha`，不再手抄；
- `test/eval-ledger.test.ts` 加一条守卫：同内容 CRLF 与 LF 文件必须给出同一哈希，
  且把 CRLF 文件当 `script` 时账本仍绿。

## 为什么放在现有 `test` job，而不是新开 CI job

- 账本校验只读一个 JSON 与若干脚本做 sha256，不碰浏览器、不碰 GPU、不占端口；
  新开 job 的固定成本是 runner 启动与 checkout，远大于 4.4ms 的校验本身。
- `npm test` 已经在该 job 内跑全部 `test/*.test.ts`，新增一个测试文件即为零基础设施接入；
  失败信息与既有测试同格式，定位成本不增加。
- 因此 `test/eval-ledger.test.ts` 就是 CI 入口；CLI 只用于生成证据 JSON。

## gate 标签的真实含义（2026-11-05 修正）

| 项 | 内容 |
| --- | --- |
| 改前 | 16 条来自 pwe-soak 证据树的读数标成 `gate: ci-nightly` |
| 当初为什么标 nightly | 这些读数由离线 soak 脚本产出，单轮要跑几十个世界日，当时把「我希望它在 nightly 复核」写成了 gate |
| 为什么改 | 仓里**没有** nightly workflow：`.github/workflows/` 只有 `ci.yml`，触发是 `pull_request` + `push`。`ci-nightly` 从未对应任何真实门。按「gate = 这条读数在哪个门被复算」的口径，唯一真实入口是 `npm test` 里的 `test/eval-ledger.test.ts`，即 `ci.yml` 的 `pull_request`/`push` job，也就是 `ci-pr` |
| 改法 | 16 条 `gate` 由 `ci-nightly` 改为 `ci-pr`；`value` / `source` / `denominator` / `script_sha` 一个没动 |
| 护栏 | 新增 `test/gate-workflow-reconcile.test.ts`：解析 `.github/workflows/*.yml` 的 `on:`，断言账本里出现的每个 gate 都有真实触发位置；新增 gate 不接真实门就红 |

`ci-nightly` 仍保留在 `GATES` 枚举里：将来真加了 nightly workflow，它才有资格被写进账本。

## `script_sha` 的两类取值

- 填了 `script` 的条目，在每次校验时重算文件 sha256（LF 归一化后），**脚本改了而读数
  没重测就会红**；断言口径没有放宽（不放成「只比长度」、也不忽略）。
- 来自 pwe-soak 外部证据树的读数，生成脚本未提交，`script_sha` 只能写 `not_measured`；
  不许编一个像哈希的值（0.08pp 就是这么来的）。

