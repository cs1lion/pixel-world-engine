# 日常活动功能测试发现的缺陷

分支：`feat/func-daily`（基于 `54139dd`）。工作日 2026-11-03。
范围：日常活动 L1/L2/L3 分层功能测试。所有读数为 `node --import ./test/phaser-hooks.mjs`
在本 worktree 的 `world-client/` 下实测；复现命令都不改世界代码，只打印取证读数。

约定：

- 「期望」写的是测试里**没有放宽**的断言值；没有为了让测试变绿而改期望。
- 每条对应一个 Node test `todo` 用例，用例名写在「测试标注」里。
- 复现脚本 `world-client/test/func-daily-repro.ts` 不是测试文件（不带 `.test`），
  不参与 `node --test`。

---

## BUG-001 夜间没有起卧：22:00 闭市后仍按环线巡镇到 05:00

- **现象**：22:00「市面闭了」之后，居民没有回住处歇下，而是继续在
  `农田边 (40,40) → 街口 (56,33) → 祭坛 (48,36)` 之间整夜走动；05:00 也没有
  对应的起床/出屋动作（因为她本来就在走）。
- **最小复现命令**（在 `world-client/` 下）：
  ```
  node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts night
  ```
- **期望 vs 实际**：
  - 期望 22:00–05:00 走动步数 = **0**；实际 **1771** 步。
  - 期望 22:00–05:00 离场次数 = **0**；实际 **11** 次。
  - 期望夜间行为是「回住处、停下、天亮再出来」；实际是全套环线照跑。
- **证据**（复现输出）：
  ```
  [night] 22:00–05:00 走动步数=1771
  [night] 22:00–05:00 离场次数=11
  [night]   0m 从 (48,36) 去「去农田边」
  [night]   40m 从 (40,40) 去「去街口」
  [night]   83m 从 (56,33) 去「回祭坛」
  [night]   114m 从 (48,36) 去「去农田边」
  [night]   154m 从 (40,40) 去「去街口」
  [night]   197m 从 (56,33) 去「回祭坛」
  [night]   228m 从 (48,36) 去「去农田边」
  [night]   268m 从 (40,40) 去「去街口」
  [night]   1352m 从 (40,40) 去「去街口」
  [night]   1395m 从 (56,33) 去「回祭坛」
  [night]   1426m 从 (48,36) 去「去农田边」
  ```
  （0m–268m 落在当天的 00:00–05:00；1352m–1426m 落在 22:32–23:46。
  一天里两段「夜间」都被环线填满。）
- **测试标注**：
  - `todo`：`L1 起卧：22:00–05:00 居民应当歇下来，不应继续巡镇`
  - `todo`：`L1 22:00 闭市：应落成闭市改变并让镇子歇下来，不只是「市面闭了」`
    （该用例同时受 BUG-003 影响）
- **影响面**：日常活动最基础的「起卧」不存在；夜间夜景里居民仍在小镇上跑，
  玩家看到的作息与钟表相反；后续若按记忆/关系做夜间事件，时间前提是错的。

---

## BUG-002 06:00 打水落点退化成祭坛，当事人根本没去水边

- **现象**：默认大世界没有任何 `shallow` / `mud` 地形（`邻水可走格数=0`），
  `waterSpot()` 扫不到水边就静默 `return this.altar`。于是 06:00 的
  `world.event(daily_water)` 落点写成祭坛 `(48,36)`，地形 `plaza`；当事人
  莞尔当时在 `(40,40)`，到落点切比雪夫距离 **8** 格，整句话却写「去桥边打水」。
- **最小复现命令**：
  ```
  node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts water
  ```
- **期望 vs 实际**：
  - 期望默认世界至少有 **1** 个邻水可走格；实际 **0** 个。
  - 期望打水落点不是祭坛；实际落点 = 祭坛 `(48,36)`。
  - 期望当事人到落点距离 ≤ **2**（每日小事应让当事人走到落点）；实际 **8**。
- **证据**（复现输出）：
  ```
  [water] wash_bridge 命中=是（360 分）
  [water] 邻水可走格数=0
  [water] 落点=(48,36) 地形=plaza 祭坛=(48,36)
  [water] 当事人=(40,40) 到落点切比雪夫距离=8
  [water] 同一窗口旁白=["莞尔去看了一眼农田","天亮了，有人去桥边打水，顺手冲了冲桥面。"]
  ```
  源码位置：[simulation.ts](file:///D:/project/pwe-funcdaily/world-client/src/world/simulation.ts#L3611-L3645)
  的 `stepTimetable` / `waterSpot`：打水只 `announce`，不派路、不改居民状态；
  找不到水边时也没有任何提示，直接回退祭坛。
- **测试标注**：`todo`：`L1 06:00 打水：人应真的到水边，落点也不该退化成祭坛`
- **影响面**：每日小事变成「只写一条日志」；记忆层会按错误坐标记一条打水记忆；
  玩家看到的落点与说法互相矛盾（说桥边、指祭坛）。若将来加「打水」玩法，
  默认世界没有水边这一前提也不成立。

---

## BUG-003 08:00 开市 / 17:00 收工 / 19:00 夜市 / 22:00 闭市：只有旁白，没有可见行为

- **现象**：这四拍在 `timetable.ts` 里没有 `chore`，`stepTimetable` 只 `log('info', ...)`，
  不产生 `world.event`，也没有任何状态变化或实体动作。08:00 那一拍里唯一的
  `world.event` 是同一窗口的 `tide_turn`（潮水退潮），与开市无关。
- **最小复现命令**：
  ```
  node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts narration
  ```
- **期望 vs 实际**：
  - 期望每一拍至少落成一条 `world.event`（`kind` = `market_open` / `work_end` /
    `night_market` / `market_close`），并能进记忆、被后续系统读到；
  - 实际四拍 `world.event` 条数均为 **0**（开市窗口只有无关的 `tide_turn`）。
- **证据**（复现输出）：
  ```
  [narration] market_open（480 分）world.event=[tide_turn] 旁白=["潮水退过一半，滩涂露出来了","早市开了，摊子一处处支起来。"]
  [narration] work_end（1020 分）world.event=[] 旁白=["收工的钟敲了，街上的活停下来。"]
  [narration] night_market（1140 分）world.event=[] 旁白=["夜市支起来了，灯下有人走动。"]
  [narration] market_close（1320 分）world.event=[] 旁白=["市面闭了，镇子回到安静。"]
  ```
- **测试标注**：
  - `todo`：`L1 08:00 开市：应有可见的开门动作，不只是「早市开了」这句话`
  - `todo`：`L1 17:00 收工：街上的活应停下来，不只是钟响了一句`
  - `todo`：`L1 19:00 夜市：应有人/摊子真的动起来，不只是「灯下有人走动」`
  - `todo`：`L1 22:00 闭市：应落成闭市改变并让镇子歇下来，不只是「市面闭了」`
    （该用例同时受 BUG-001 影响）
- **影响面**：「开市/收工/夜市/闭市」四拍的玩法全部缺失；世界状态（铺子营业、
  摊位、人流）没有对应开关；记忆层读不到这四件事，跨日摘要里只有旁白文本。
  这不是「日志少一句话」，而是行为没有发生。

---

## BUG-004 `?speed=` 极小正数被接受，一世界日算成 `Infinity` 秒

- **现象**：`resolveClockSelection` 只校验 `Number.isFinite(speed) && speed > 0 &&
  speed <= 60`。IEEE754 最小次正规数 `5e-324` 满足这三条，于是
  `timeScale = 5e-324`；`dayRealSeconds` 的 `DAY_MS / (1000 × scale)` 直接溢出成
  `Infinity`。`1e-9` 这类值虽有限，但一世界日也要 `8.64e13` 秒（约 274 万年），
  同样不可玩。没有任何下限或「太小就拒绝」的策略。
- **最小复现命令**：
  ```
  node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts speed
  ```
- **期望 vs 实际**：
  - 期望极小倍率要么被拒绝、回退默认 **60**，要么至少给出**有限且 ≤
    `Number.MAX_SAFE_INTEGER` 秒**的日长；
  - 实际 `?speed=5e-324` 被接受，`timeScale=5e-324`，一世界日 = **`Infinity` 秒**。
- **证据**（复现输出，节选）：
  ```
  [speed] ?speed=5e-324 -> timeScale=5e-324 一世界日=Infinity 秒
  [speed] ?speed=1e-9 -> timeScale=1e-9 一世界日=86399999999999.98 秒
  [speed] ?speed=0 -> timeScale=60 一世界日=1440 秒（回退默认 60）
  [speed] ?speed=60.0001 -> timeScale=60 一世界日=1440 秒（回退默认 60）
  [speed] ?speed=61 -> timeScale=60 一世界日=1440 秒（回退默认 60）
  [speed] 合法上限 MAX_TIME_SCALE=60
  ```
  源码位置：[real-clock.ts](file:///D:/project/pwe-funcdaily/world-client/src/world/real-clock.ts#L73-L85)
  的 `hasSpeed` 与 [func-daily-support.ts](file:///D:/project/pwe-funcdaily/world-client/test/func-daily-support.ts#L411-L413)
  的 `dayRealSeconds`。
- **测试标注**：`todo`：`L3 ?speed= 极小正数：倍率要么被拒，要么日长有限可读`
- **影响面**：URL 里一个合法写的数字就能让「一世界日多长」变成 `Infinity`；
  依赖日长做进度条、状态行、时间提示的界面会显示无意义的值，且世界几乎不再推进。
  非法值（0/负/超上限/NaN/Infinity/空串/非数字）的回退是对的，缺的只是正向下限。

---

## 汇总

| 编号 | 一句话 | 最小复现命令 | 测试标注 |
| --- | --- | --- | --- |
| BUG-001 | 夜间不起卧，22:00–05:00 仍巡镇 | `node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts night` | L1 起卧、L1 22:00 闭市 |
| BUG-002 | 06:00 打水落点退化成祭坛，人没去 | `node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts water` | L1 06:00 打水 |
| BUG-003 | 开市/收工/夜市/闭市只有旁白 | `node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts narration` | L1 08:00/17:00/19:00/22:00 |
| BUG-004 | `?speed=5e-324` 让一世界日 = `Infinity` 秒 | `node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts speed` | L3 ?speed= 极小正数 |

以上命令均在 `D:\project\pwe-funcdaily\world-client` 下执行。四条缺陷都用 Node test 的
`todo` 标注在用例里，没有跳过用例、没有放宽断言、没有改 README 的 claim 计数。
