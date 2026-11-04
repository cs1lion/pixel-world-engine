# 回溯问答证据（eval-rewind-qa）

- 日期：2026-11-04
- 分支：`eval/ledger-facts-question`，基线 `39cff04`
- 实现：[world-client/test/eval-rewind-support.ts](../../../world-client/test/eval-rewind-support.ts)、
  [world-client/test/eval-rewind-qa.test.ts](../../../world-client/test/eval-rewind-qa.test.ts)、
  [world-client/scripts/eval-rewind-qa.ts](../../../world-client/scripts/eval-rewind-qa.ts)

## 数据来源（只读引用，不复制大 JSON）

pwe-soak 证据树，提交 `3a41541`，目录 docs/evidence/soak/soak-a（只读引用，不复制完整存档）：

- 90 天存档 save-90d.json（sha256 ea68ad60c504032fca286316e5334db90a4fbc1215e86f83875e344a435c123a）
- 摘要 summary-90d.json（sha256 90b3dcb8604fac37f8dbdeac3b88a85bd2c529a390858dc9c11c4c1d8b94837f）

投影命令（只写我们分支里的 22KB fixture，不复制完整存档）：

```text
node world-client/scripts/eval/extract-soak-day-facts.mjs \
  --save <pwe-soak>/docs/evidence/soak/soak-a/save-90d.json \
  --summary <pwe-soak>/docs/evidence/soak/soak-a/summary-90d.json \
  --source-commit 3a41541 \
  --out world-client/eval/fixtures/eval-soak-day-facts.json
```

投影结果：第 20/45/60/89 天各 12 条事实，共 48 条；天气均为 `clear`。

CLI 的默认 fixture 按脚本位置解析（`import.meta.url`），从仓库根或 `world-client` 里跑都一样。

## 读数

| 项 | 读数 |
| --- | --- |
| 断言分母 | 40（4 天 × 10 问） |
| 通过 | 40/40 |
| 失败 | 0 |
| 脚本耗时 | 15–19ms（`rewind-qa.json` 内 `elapsedMs`；CLI 墙钟约 0.4s，Node 启动占大头） |
| 测试耗时 | 12.55ms + 0.37ms（空事实日守卫） |
| 空事实日守卫 | 事实为空时固定 10 条失败，不许把「未记录」当答案 |

十问：人数、第一件、最后一件、去过哪些地方、有没有争执、和谁见过、天气、谁不在、
某句话是谁说的、最热闹的地点。每条答案都带 `eventRefs`，且引用只允许落在当天。
天气题的事件引用只作当天边界旁证，`derivation` 明确写了天气取自 summary，不冒充事件来源。

## 口径提醒

这 12 条/天是**第 90 天仍可追溯的存留事实**，不是当天全部事件（当天约 30 条）。
所以「第一件/最后一件」的正确答案是「存留事实中的第一/最后一条」，`derivation`
已写明；不把它包装成「当天实际第一件」。
