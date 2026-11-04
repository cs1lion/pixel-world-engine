# 指标账本证据（eval-ledger）

- 日期：2026-11-04
- 分支：`eval/ledger-facts-question`，基线 `39cff04`
- 账本：[eval/ledger.json](../../../eval/ledger.json)
- 闸门：[world-client/scripts/eval-ledger.ts](../../../world-client/scripts/eval-ledger.ts)、
  [world-client/test/eval-ledger.test.ts](../../../world-client/test/eval-ledger.test.ts)

## 读数

| 项 | 读数 |
| --- | --- |
| 登记指标 | 25 条（其中 2 条 `not_measured`，都有 `note`） |
| 校验耗时（CLI） | 2.5–7ms（首次 2.48ms；读 25 条账本 + 重算 5 个 `script_sha`） |
| 测试耗时 | 3.23ms / 1.51ms |
| 必填字段 | `seed / weather / rainSeed / denominator / source / script_sha / judge` + `value / unit / measured_at / gate` |
| 造错守卫 | 删掉 `id` 后 `errors` 命中 `id`，退出码 1 |

`ledger-check.json` 是 `node world-client/scripts/eval-ledger.ts --json` 的原样输出。

## 为什么放在现有 `test` job，而不是新开 CI job

- 账本校验只读一个 JSON 与若干脚本做 sha256，不碰浏览器、不碰 GPU、不占端口；
  新开 job 的固定成本是 runner 启动与 checkout，远大于 2.48ms 的校验本身。
- `npm test` 已经在该 job 内跑全部 `test/*.test.ts`，新增一个测试文件即为零基础设施接入；
  失败信息与既有测试同格式，定位成本不增加。
- 因此 `test/eval-ledger.test.ts` 就是 CI 入口；CLI 只用于生成证据 JSON。

## `script_sha` 的两类取值

- 填了 `script` 的条目，在每次校验时重算文件 sha256，**脚本改了而读数没重测就会红**。
- 来自 pwe-soak 外部证据树的读数，生成脚本未提交，`script_sha` 只能写 `not_measured`；
  不许编一个像哈希的值（0.08pp 就是这么来的）。
