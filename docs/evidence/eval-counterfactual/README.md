# 反事实证据（eval-counterfactual）

- 日期：2026-11-04
- 分支：`eval/ledger-facts-question`，基线 `39cff04`
- 实现：[world-client/test/eval-counterfactual-support.ts](../../../world-client/test/eval-counterfactual-support.ts)、
  [world-client/test/eval-counterfactual.test.ts](../../../world-client/test/eval-counterfactual.test.ts)、
  [world-client/scripts/eval-counterfactual.ts](../../../world-client/scripts/eval-counterfactual.ts)

## 命令与读数

| 命令 | 读数 | 退出码 |
| --- | --- | --- |
| `node world-client/scripts/eval-counterfactual.ts --out docs/evidence/eval-counterfactual/counterfactual.json` | 契约 **6/6** ok，耗时 18–28ms | 0 |
| `node world-client/scripts/eval-counterfactual.ts --guard-red` | 关掉读档闸后 witnessed 假记忆 `recalled=true`、`sourceMode=witnessed` → RED | **1（设计如此）** |
| `node --import ./test/phaser-hooks.mjs --test test/eval-counterfactual.test.ts` | 3/3 通过，约 1.0s（含 Node 启动） | 0 |

删一条记忆的 before/after（同一线索 `placeId=eval-p1`）：

- before：`memoryIds=["m_sum_a_0"]`，`eventRefs=["eval-e1"]`，`modes=["witnessed"]`
- after：空集
- 不带地点过滤的 `allAfter` 仍有 `eval-e2` 的两条记忆，证明不是整库塌掉
- 时间线 after 不再含 `eval-e1`；`danglingRefs=0`

## 造错守卫

`guard-red.txt` 是 `--guard-red` 的原始输出。它**关掉读档闸**（绕过 `MemoryRuntime`、
直连 `world.restoreSnapshot`）再把假记忆标成 `witnessed` 塞进存档，断言「不得被当成
亲眼所见」——此时假记忆确实以 `witnessed` 复活，于是这一支红（退出 1）。
闸开着时，同一条假记忆被 [import-guard](../eval-import-guard/) 降级为 `heard`，
契约绿（退出 0）。两边都跑过：写松就红、写对就绿。

**EVAL-BUG-1 已修**，修法与证据见 [../BUGS_FOUND.md](../../BUGS_FOUND.md) 与
[../eval-import-guard/](../eval-import-guard/)。

## 为什么不在 CI 里跑 `--guard-red`

`--guard-red` 是**故意造错**的对照组，红才是通过的信号，不能当门禁。
CI 跑的是 `eval-counterfactual.test.ts`（删一条必变 / 听说假记忆不得 `witnessed` /
`witnessed` 假记忆被降级 / 绕过闸的对照组必须复活），耗时在毫秒级。
