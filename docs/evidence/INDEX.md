# 证据索引

按目录登记；每条证据的原始命令、读数与口径写在各自 `README.md`，大文件不进本分支。

| 日期 | 目录 | 内容 | 关键读数 | 来源 |
| --- | --- | --- | --- | --- |
| 2026-11-04 | [eval-ledger](./eval-ledger/) | 指标账本校验 | 25 条指标；校验 2.5–7ms；造错守卫命中 | 本分支 `eval/ledger.json` |
| 2026-11-04 | [eval-counterfactual](./eval-counterfactual/) | 删一条记忆 / 塞假记忆 | 契约 6/6；`danglingRefs=0`；关闸对照组 RED | 本分支 `test/eval-counterfactual-support.ts` |
| 2026-11-04 | [eval-import-guard](./eval-import-guard/) | EVAL-BUG-1 修法：读档出处闸 | 90 天 71→71（拒绝 0 / 降级 0 / 淘汰旁证 12）；v5 25→25；假记忆降级 1 | pwe-soak `3a41541` 只读引用 + 本分支 `traces/outer-baseline-v5.json` |
| 2026-11-04 | [eval-rewind-qa](./eval-rewind-qa/) | 第 20/45/60/89 天回溯问答 | 40/40；15–19ms | pwe-soak `3a41541` 的 90 天存档只读投影 |

已有目录（`cast-artbook/`、`liveliness/`、`scene-artbook/`、`20261102-live-check/`）沿用原线编号，不在本次改动内。
