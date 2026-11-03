# 交互功能测试发现的缺陷

分支 `feat/func-interact` 的功能测试（`world-client/test` 下的 `interact-l1`、`interact-l2`、`interact-l3` 三个用例文件，加 `world-client/scripts/check-interact.mjs`）覆盖到的真实问题。
断言没有放宽：单元层用 `{ todo: true }` 标注期望，浏览器层用 `checkTodo` 记录，均按「期望行为」断言。

---

## BUG-1 神谕写作没有长度 / 控制字符校验

- **现象**：面板只把输入 `trim()` 一下，空串挡住、其余原样交给 `api.say`。超长文本和不可见控制字符都能直接写进世界，输入框也没有 `maxlength` 兜底。
- **最小复现**：
  1. 打开页面，点开神谕写作面板（`#utterance`）。
  2. 粘贴 10000 个字符后提交；或输入 `"a\u0000b\u0007c"` 后提交。
  3. 面板关闭、文本原样进入神谕，没有拒绝、没有截断、没有提示。
- **期望 vs 实际**：
  - 期望：超过上限（建议 2000 字）拒绝并保留输入；控制字符（C0/C1、零宽方向符）拒绝或剥除。
  - 实际：10000 字照单全收；控制字符原样投递；`#utterance` 的 `maxlength` 未设。
- **证据**：
  - 代码：[oracle-panel.ts](../world-client/src/ui/oracle-panel.ts#L302-L307) 只做 `text.trim()` 与空串判断，之后直接 `api.say(trimmed)`。
  - 单元：`interact-l3.test.ts` 的 `L3-1b`、`L3-1c`（`todo`）——控制字符与 10000 字均被原样投递。
  - 浏览器：`check-interact.mjs` 的 `L3-2`（空白不投递）通过；`L3-3` 记录 `10000 字 → 神谕原样收到；#utterance maxlength=未设`。

---

## BUG-2 长按期间单位自己走开，500ms 后仍会弹出面板

- **现象**：长按用 `pointerdown` 时的单位引用起 500ms 定时器。玩家手指不动时不会有 `pointermove`，定时器回调里只用 `still !== null` 判断（恒真），没有重新做一次「指针此刻是否还压在这个单位上」的命中测试。单位自己走开（或被人挤走）仍会开记忆 / 楼志面板。
- **最小复现**：
  1. 60 倍速打开页面（`?speed=60`）。
  2. 在一个正在走路的村民格子上按住 650ms，手指全程不动。
  3. 村民在按住期间换格（实测 `47,36 → 46,36`），没有触发任何 `pointermove`；650ms 时仍弹出了这个村民的记忆面板。
- **期望 vs 实际**：
  - 期望：定时器触发时重新命中，指针下已经换人/空地就取消长按（与「移出即取消」同一语义）。
  - 实际：面板照开，且是对着已经离开格子的那个人开的。
- **证据**：
  - 代码：[SandboxScene.ts](../world-client/src/scenes/SandboxScene.ts#L2463-L2474)，关键是 2466 行 `longPressShouldFire(LONG_PRESS_MS, still !== null)`；`still` 是按下时的引用，不是此刻指针下的单位。
  - 浏览器：`check-interact.mjs` 的 `L1-10`（`todo`）：`莞尔 从格 (47,36) 走到 (46,36)，手指没动、也没有 pointermove，500ms 定时器照样开了记忆面板「莞尔」`。
  - 已有反向守卫：`interact-l1.test.ts` 的 `L1-4` 覆盖了「指针移出 → 取消」，所以缺的只是「单位移动、指针不动」这一支。
