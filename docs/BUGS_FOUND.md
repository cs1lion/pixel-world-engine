# BUGS_FOUND

记录**取证过**的缺陷：现象 → 复现命令与频率 → 机制 → 修复 → 改前/改后频率与读数。
「看起来像抖动」不算结案。

---

## 2026-11-04 · 并行负载下三处偶发红（`fix/flaky-gates` 分支）

三处都只在机器被别的进程压满时红，隔离单跑全绿。取证结果：**都不是产品逻辑坏了**，
两处是测试自己的时序/墙钟判据，一处是跟真实定时器赛跑。
第三处（`接了模型之后……`）是四路并行验收时抓到的，不是最初点名的两条。

### 1. `test/intent-async.test.ts`「同一句话连着说三遍，只问模型一次」

**现象**：整套/并行跑时偶发 `2 !== 1`，断言原文「去重是持久的，不是时间窗」，
位置 `intent-async.test.ts:292`。隔离单跑连跑 5 次全绿。

**复现命令**（压测工具在 `tmp/stress/`，已被 `.gitignore` 覆盖，不入库）：

```bash
# 8 路并行，每个进程各跑一遍该文件
node tmp/stress/flake-repro.mjs --file world-client/test/intent-async.test.ts \
  --runs 24 --concurrency 8 --tag intent-par8
```

**改前频率**：8 路并行 **5 / 24 = 20.8%**。失败 TAP 落在
`tmp/stress/intent-par8/r1-j0.tap`（`expected: 1 / actual: 2`，
`intent-async.test.ts:292`）。隔离单跑 0 红。

**机制（不是猜的，是打出来的时序）**：

测试里模型是 `classify: async () => { calls += 1; await setTimeout(5); ... }`——
一个**真实 5ms 定时器**。而第三遍「今天好累啊」只 `enqueue`、没有紧跟一拍，
它要等下面 `settle()` 的第一轮 `setImmediate` 才结算。去重表 `pendingClassify`
在答复回来时（`finally`）就删掉；机器一忙，一轮 `setImmediate` 超过 5ms，
于是**答复先落地、第三遍后结算**，第三遍真的又问了一次。

探针 `tmp/stress/probe-intent-dedup.ts` 把同一条时序逐事件打出来：

```bash
DELAY_MS=0 node tmp/stress/probe-intent-dedup.ts     # 把 5ms 换 0ms：同一竞态 100% 触发
1..8 | ForEach-Object -Parallel { $env:DELAY_MS=5; node tmp/stress/probe-intent-dedup.ts } -ThrottleLimit 8
```

- `DELAY_MS=0` 读数：`16.748ms 模型答复落地（pending 即将清空）` →
  `17.212ms settle 拍 1：update 前 calls=1 pending=0` → `17.426ms 模型被问，calls=2`
  → `RESULT calls=2`。**同一竞态 8/8 = 100%**。
- `DELAY_MS=5` 在 8 路并行下：3/8 次 `RESULT calls=2`；隔离单跑全部 `calls=1`。

结论：竞态在**测试**里，不在 `Simulation` 里。`pendingClassify` 的语义本来是
「同一句**还在问的路上**只问一次」，答复回来之后再说是新的一次提问，这是对的。

**修复（只改测试，不动被测代码，不放宽断言、不加 sleep）**：

模型改成**手动放行的闸**（`await answered`，由测试 `release()`），三遍确实都落在
「还在问」的窗口里；于是 `calls === 1` 与「世界时间再走 96ms 仍只问一次」两条断言
都变成确定性事件。判据（`calls === 1`）一个字没动，只是不再和真实时钟赛跑。

**改后频率**：

- 8 路并行 `--runs 32`：**0 / 32**；
- 16 路并行 `--runs 32`：**0 / 32**。

**剩余风险**：其它用真实 `setTimeout` 假装网络延迟的用例有同类结构（例如本文件
之外若有「等 N 毫秒再断言」的写法），本轮只修了这一条；模式是「用真实时钟推进
异步结果」，应改用放行闸。

---

### 2. `test/daily-prop-cost.test.ts`「传播的代价随规模走：holder 少一半的那次不该更贵」

**现象**：约 1/30 偶发红，读数 `half 10.57ms vs all 1.38ms`（82 个 holder 反而比
146 个贵 7.6 倍）；同一文件里「一天的世界时间跑得完」也在四路并行下偶发红
（`54.62ms / 100.28ms > 50ms`）。

**复现命令**：

```bash
node tmp/stress/flake-repro.mjs --file world-client/test/daily-prop-cost.test.ts \
  --runs 64 --concurrency 8 --tag cost-par8
```

**改前频率与读数**：

| 场景 | 次数 | 红 | 读数 |
| --- | --- | --- | --- |
| 规模断言，8 路并行 | 32 | 1（3.1%） | half 10.63ms / all 4.09ms |
| 规模断言，历史现场 | — | 约 1/30 | half 10.57ms / all 1.38ms |
| 绝对预算闸（50ms），8 路并行 | 64 | 3（4.7%） | 51~99.98ms |
| 绝对预算闸，四路并行（2026-11-03） | 10 | 2（20%） | 54.62ms / 100.28ms |

**机制（两条证据，都否掉了「只是抖动」这个说法）**：

1. **一天的真实计算量只有 0.3~1.0ms，读数却能到 10ms 以上。** 探针
   `tmp/stress/probe-cost.ts` 把每次采样都打出来（隔离、原顺序）：

   ```
   #1 half wall=29.562ms   #1 all wall=2.458ms
   #2 half wall=9.947ms    #2 all wall=1.467ms
   #3 half wall=0.807ms    #3 all wall=0.895ms
   ```

   把顺序反过来（`ORDER=all-first`）：`#1 all wall=18.615ms / #1 half wall=1.983ms`。
   **哪一组先采样，哪一组就贵一个量级**——那是首次 `dayClosed` 的 JIT/首次分配，
   与规模无关。`min-of-3` 本该把它剔掉，可并行时一轮 `setImmediate`/一次调度停顿
   就有 5~20ms，三次都撞上就把「最小值」抬到 10ms 以上。
2. **CPU 时间在这个环境里不可用（所以没有改口径）。** 在 Windows / Node 22.23
   实测 `process.cpuUsage()` 粒度约一个系统时钟 tick：忙等 5ms 读数是 `0µs`，
   忙等 2ms 读到 `31000µs`。用它对 0.5ms 的一天做判据只会得到 0 与 1 的抖动。
   同样，「把一天重复 20 次取总时长」（`tmp/stress/probe-cost2.ts`）会把 GC
   压进计时区，信号直接消失：`half 20.40ms / all 20.28ms`（每天约 1.0ms 对 1.0ms）。

**修复（只改度量方式与采样数，判据一个字没动）**：

- 绝对预算闸：`day1` 由**单次采样**改为**采 3 次取最小**（`minOfMilliseconds`）。
  `CEILING_MS = 50` 不变。理由：这条闸自称抓的是「量级退化」（传播改成每步全库扫描），
  单次墙钟采样抓的是「这一拍有没有被别的进程挤开」，两者差两个量级，只有前者是
  要守的东西。
- 「稳态不比第 1 天贵」：两边改用同一个估计量（各 3 次取最小），否则比的是
  「谁的样本撞上停顿」。
- 规模对照：`interleavedMinMilliseconds` 加**一轮不计时预热**、轮数 3 → 5。
  判据 `halfMs < allMs * 2` 不变。噪声只会把读数往上加，最小值是最接近「没有噪声
  时该花多少」的估计；5 轮把「三轮都撞上停顿」的概率从 1/3 级降到 1/5 级。

**改后读数**（探针 `tmp/stress/probe-cost3.ts`，预热 + 交错采样）：

```
N=3 pass(0.71/0.69=1.02)  N=5 pass(0.36/0.69=0.53)  N=7 pass(0.32/0.52=0.62)
N=3 pass(0.66/0.75=0.89)  N=5 pass(0.46/0.75=0.61)  N=7 pass(0.43/0.54=0.79)
N=3 pass(0.49/0.59=0.83)  N=5 pass(0.36/0.59=0.61)  N=7 pass(0.35/0.59=0.59)
```

即 half/all 稳定在 0.5~0.8（`N=3` 偶有 0.89~1.02，正是「三轮不够」的现场写照）；
`all/half` 的历史扫描值 2.04 也还在同一量级。

**闸没有变成摆设（反向验证）**：把 `half` 换成 400 个 holder（真的让小的更大），
同一估计量立刻红：

```
N=3 FAIL(2.29/0.71=3.24)  N=5 FAIL(2.29/0.71=3.24)
N=7 FAIL(2.15/0.54=4.01)  N=9 FAIL(2.15/0.54=4.01)
```

**改后频率**：

- 8 路并行 `--runs 64`：**0 / 64**（改前 3/64 绝对闸 + 规模断言另有 1/32）；
- 16 路并行 `--runs 64`：**0 / 64**。

**剩余风险**：`npm test` 默认每个测试文件一个子进程，墙钟类判据在**极重**负载下
仍可能被单次停顿推到阈值以上；本轮把噪声从「单次」改成「最小值」，但没有在
CI 固定基准机上跑。真要守 §3.2 B 的 10ms 预算，仍需要固定机器 + 单独基准。

---

### 3. `test/intent-async.test.ts`「接了模型之后，投递仍然同步返回，不等网络」

**现象**：四路并行验收 5 轮里第 3 轮红 1 次：`not ok 725`、
`error: '一拍不得等网络'`、位置 `intent-async.test.ts:80`、`duration_ms: 177.6`。

**复现命令**：

```bash
node tmp/stress/flake-repro.mjs --file world-client/test/intent-async.test.ts \
  --runs 32 --concurrency 8 --burn 16 --tag intent-burn16
```

**改前频率**：16 个纯忙等进程压满 CPU 时 **1 / 32 = 3.1%**，失败那次
`duration_ms: 372.66`；四路并行 5 轮里 1/5 轮红。8 路/16 路轻载下 0/32（复现不了）。

**机制**：这条拿 `Date.now() - started < 100` 判「一拍不等网络」。这个同步 tick
的真实耗时是几十微秒，读数是 177~372ms——**量的全是这一拍被操作系统挤开了多久**，
不是代码有没有 await 模型。而「不等网络」是结构性质：`tick`/`update` 是同步函数，
里面根本没有机会 await。墙钟判据既抓不到真回归（真 await 了会直接拿到 Promise
而不是超时），又会被负载打成假红。

**修复（判据换得更严，不是放宽）**：模型 promise 落地时把 `settled` 翻真；
`tick(sim)` 返回后断言 `settled === false`——即「tick 已经返回，而网络答复还没到」。
真等过网络的话它不可能是 false；毫秒阈值反而可能放过「等了 90ms」。

**改后频率**：同样 16 个忙等进程 × 32 次：**0 / 32**（`tmp/stress/intent-burn16-after`）。

