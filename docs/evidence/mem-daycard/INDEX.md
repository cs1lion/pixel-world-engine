# mem-daycard 证据索引

这一目录只回答一件事：**日历屏把日摘要读成「每天一行」，且只读。**

| 文件 | 是什么 | 怎么读 |
|---|---|---|
| `REPORT.md` | 结论、五条硬判据、10 天抽查、损耗边界、能答/不能答 | 先读这个 |
| `results.json` | 脚本实测：第 89 天覆盖、字节、耗时、纯读 SHA、10 天样本、周守卫 | `node scripts/mem-daycard.ts` 可重跑 |
| `browser-real.json` | 真实 90 天存档的浏览器验收：开关前后存档原文、`world.memory` 快照、面板内容、页面错误 | 与 `daycard-real-90d-1x.png` 对照 |
| `browser-fixture.json` | 111 天 fixture 的浏览器验收：第 103 天整行、周标题、纯读证明 | 与 `daycard-103-1x.png` 对照 |
| `daycard-real-90d-1x.png` | 真实 90 天、近 30 天屏，1× 原生截图（1010×940，DPR 1） | 看顶栏「日历」、左侧抽屉、每天一行 |
| `daycard-real-90d-panel-1x.png` | 同一屏的面板近景，1× | 看字号与周块 |
| `daycard-103-1x.png` | 111 天 fixture，滚到第 103 天整行，1× | 看「第 103 天 · 有事 · 6 人 / 吵了一架 · 争执 / 53 B」 |
| `daycard-103-panel-1x.png` | 同一屏的面板近景，1× | 看琥珀色争执行 |
| `input/synthetic-120d.json` | 90–120 天合成摘要与真值（沿用上一轮离线实验） | 只验读取口径，不代表真实世界 |
| `input/save-day111-fixture.json` | 真实存档副本 + 合成 90–110 天摘要，供浏览器演示第 103 天 | **演示 fixture，不是产品存档** |

## 重跑

```powershell
cd world-client
node scripts/mem-daycard.ts
node scripts/daycard-browser.mjs --port=5322 --mode=real
node scripts/daycard-browser.mjs --port=5322 --mode=fixture
```

端口 5322 需先确认空闲；5188/5191/5202/5203/5321 是别的树或上一轮实验占过的口，不要用。
