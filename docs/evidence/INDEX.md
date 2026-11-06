# 证据索引

按目录登记；每条证据的原始命令、读数与口径写在各自 `README.md`，大文件不进本分支。

| 日期 | 目录 | 内容 | 关键读数 | 来源 |
| --- | --- | --- | --- | --- |
| 2026-11-04 | [eval-ledger](./eval-ledger/) | 指标账本校验（在 `10f61ac` 上重测） | 25 条指标；render p50 16162（两档 15514/16162）；palette 0/0；walk 18 / idle 10；校验 4.4ms；`script_sha` 走 LF 归一化 | 本分支 `eval/ledger.json` |
| 2026-11-04 | [eval-counterfactual](./eval-counterfactual/) | 删一条记忆 / 塞假记忆 | 契约 6/6；`danglingRefs=0`；关闸对照组 RED | 本分支 `test/eval-counterfactual-support.ts` |
| 2026-11-04 | [eval-import-guard](./eval-import-guard/) | EVAL-BUG-1 修法：读档出处闸 | 90 天 71→71（拒绝 0 / 降级 0 / 淘汰旁证 12）；v5 25→25；假记忆降级 1 | pwe-soak `3a41541` 只读引用 + 本分支 `traces/outer-baseline-v5.json` |
| 2026-11-04 | [eval-rewind-qa](./eval-rewind-qa/) | 第 20/45/60/89 天回溯问答 | 40/40；15–19ms | pwe-soak `3a41541` 的 90 天存档只读投影 |
| 2026-11-06 | [phaser4-upgrade](./phaser4-upgrade/) | Phaser 3.90.0 → 4.2.1 升级（合入 `430dd0d`） | 源码改动 0；五道全绿；四场景跨组逐字节相同；雨帧 0.115%（雨幕未钉）；旧口径两轮抖动 > 可能影响；新帧率口径跨轮离散度 0.0%（贴 60Hz 截顶） | 本分支 `e3a67e1` + CI `42165248544` |

已有目录（`cast-artbook/`、`liveliness/`、`scene-artbook/`、`20261102-live-check/`）沿用原线编号，不在本次改动内。
