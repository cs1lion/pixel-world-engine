# 天气与潮汐 · 第 3 条：事件进记忆 + 影响次日行为

本文是这一条的**证据索引**：每张图、每份读数由哪个脚本生成、在什么端口与基线下跑的。
证据本体都在本目录；生成脚本在 [`world-client/scripts/evidence-liveliness/`](../../../world-client/scripts/evidence-liveliness/)。

- 分支：`feat/liveliness`
- 实现提交：`411f756`（面板时间线修复 + 断言；此前的行为实现见 `a1c6689` / `eb2f466`，
  截图刷新见 `a806e65`）
- 证据提交：本文所在提交

## 结论（三组读数）

| 问题 | 读数 |
| --- | --- |
| 有/无记忆对照 | 有记忆次日提前盖布 **7 人 / 7 次**；关掉记忆 **0 人 / 0 次** |
| 衰减到行为停止 | 同一条记忆 1.0000 → 0.8500 → 0.7225 → 0.6141；第 3 天跌破 0.75，盖布 **6 人 → 0 人** |
| 两个种子的次日行为 | `dengchao` 7 人 / `seed-14054` 5 人（后者有 2 人只有传闻，不进习惯） |

## 读数

| 文件 | 内容 | 生成方式 |
| --- | --- | --- |
| [`evidence-weather-memory.txt`](evidence-weather-memory.txt) | 五段全部读数：近场目击、有/无记忆对照、逐日衰减、两种子对照、确定性复跑 | `evidence-weather-memory.ts`（输出重定向到本文件） |

## 截图

| 文件 | 说明 |
| --- | --- |
| [`weather-memory-why.png`](weather-memory-why.png) | 整页：灯街机位，`汐` 的单位面板展开 |
| [`weather-memory-why-panel.png`](weather-memory-why-panel.png) | 面板特写：`第 1 天 13:00 · 汐提前把摊布盖上（昨天淋了雨）。`，展开后是因果句 + `memoryId` + `eventId` |
| [`weather-memory-why-narrow.png`](weather-memory-why-narrow.png) | 360px 视口整页：长句换行不溢出 |
| [`weather-memory-why-narrow-panel.png`](weather-memory-why-narrow-panel.png) | 360px 视口面板特写 |
| [`weather-memory-why.json`](weather-memory-why.json) | 抓取回执：命中的人、条目 `clock`、`why`、`memoryId`、`eventId`、当天条数，以及窄屏 `scrollWidth`/`clientWidth` |

窄屏读数：视口 360×780，面板 `scrollWidth = clientWidth = 258`（无横向溢出），
面板底边 743px 仍在视口内。

面板上的时间线条目现在**天序与时刻都写**（`第 0 天 04:00 · 雾漫上来了`、
`第 1 天 13:00 · 汐提前把摊布盖上（昨天淋了雨）。`）。时刻来自事实的 `tick`；
查不到事实写「时刻不明」，不拿 `00:00` 顶替。听说来的条目天序跟事实走，
不与落账日（`createdDay`）混用。

## 生成脚本

都在 `world-client/` 下执行。

1. 读数（约一分钟，5 万种子扫过 `seed-6682` / `seed-14054` 的挑选已写进脚本）：

   ```bash
   node scripts/evidence-liveliness/evidence-weather-memory.ts > ../docs/evidence/liveliness/evidence-weather-memory.txt
   ```

2. 截图用的存档（第 0 天淋过雨、停在第 1 天 13:00；存档本身不入库）：

   ```bash
   node scripts/evidence-liveliness/make-next-day-save.ts
   ```

3. 起本 worktree 自己的 dev server，再截图（**端口写进命令，别借用别的 worktree 的 5188**）：

   ```bash
   npm run dev -- --port 5307 --strictPort
   CAPTURE_URL='http://127.0.0.1:5307/?world=dengchao&feed=off&time=noon&speed=60' \
     node scripts/evidence-liveliness/capture-weather-memory.mjs
   ```

   截图脚本把产物直接写进本目录；`weather-memory-why.json` 里的
   `clock` 由面板的 `content.today` 读回，不是另算的。

## 确定性

同一基线与种子两次跑，逐项相同（`evidence-weather-memory.txt` 第 5 段，719 字符）。
