# 村民交互 EDD 数据集

固定程序判别（code eval），不用 LLM-as-a-judge。评的是**一轮交互往返之后世界
留下的状态**，不是回答像不像话：快照字段、事件日志、记忆、回执、动作帧名、
存档字节、DOM 可点性。观感不进自动评分，由截图与录屏给人看。

## 规格（一次只爬一个行为）

- **When**：玩家右键或长按某个村民，记忆面板打开，点了其中一个动作按钮。
- **Do**：命令排进世界队列 → 下一逻辑拍统一结算 → 村民状态驱动动作帧切换 →
  小素材与回执把结果摆到屏上 → 事件进日志、记忆落账。
- **Don't**：不直接改世界状态、不暂停时间、不让村民围着玩家转、不接管作息、
  不静默失败（拒绝要说清原因）、不把动作按钮放进 `#unit-status`
  （那里有 `nodeCount - 3 * lines` 的固定开销断言）。
- **Keep intact**：世界自己跑（作息 / 潮汐 / 天气）、`?art=0` 零素材请求、
  存档契约与 `schemaVersion`、冻结画面不因动作表变差、既有 33 项只读交互断言。

## 两份数据集，分开防过拟合

| 文件 | 条数 | 用途 | 什么时候跑 |
|---|---|---|---|
| `main.json` | 10（6 条行为 + 4 条 keep-intact） | 迭代时看着调 | 每笔改动 |
| `held-out.json` | 6（4 条不看 + 2 条环境变体） | 迭代时**不看** | 合并前 / 夜跑 |

环境变体（`V1` / `V2`）换世界时刻、相位和潮位档再跑同一条往返，防的是
「只对某个固定开局成立」——这里的过拟合风险不只是用例条数，还有世界初始条件。

自检在 `test/interaction-eval.test.ts`：两集 id 不交叉、每条形状完整、
每个 check 都有评分器实现、备用集至少两条换了初始条件的变体。

## 评分器

`scripts/eval-interaction.mjs`。每条 example 一个干净 context（清
local/sessionStorage、固定 `?now` 与相位），所以一条不会污染下一条。

```bash
node scripts/eval-interaction.mjs --split main    --run exp-1
node scripts/eval-interaction.mjs --split heldout --run heldout-1
node scripts/eval-interaction.mjs --split all     --run baseline-0
EVAL_OUT=tmp/eval-interaction node scripts/eval-interaction.mjs --split main
```

- 有任意一条 fail 就 `exit 1`（真红），不是只把输出变长。
- 每次写一份逐条读数 `EVAL_OUT/<run>.json`：id / pass / 首行 / 初始条件，
  用来**逐条比较实验**，不只看通过数——新改动修好一条却弄坏另一条，
  平均分是看不出来的。
- `PIXEL_WORLD_URL` 必须指向本工作树的 preview；脚本先过树身份闸。

## 判据边界

只判可观测事实。`K3` 特别说明：整幅 canvas 本来就有约 0.15% 的零散像素变化，
绝对静止要交给 `check-ground-shadow.mjs` 的完整测量面前提；这里判的是本轮
真正要防的回归——**接入动作表后冻结画面的变化量不该比 `art=0` 时显著变大**
（A/B 实测同量级）。判据用浏览器 2D canvas 逐像素比，不依赖 Python / PIL，
CI 的 browser job 跑得起。

## 接 CI

实验 0 时主集还红着，没有接；`exp-3` 主集 10/10 全绿那一笔才把
`node scripts/eval-interaction.mjs --split main` 加进 `.github/workflows/ci.yml`
的 browser job，作为真阻断（有 fail 即 `exit 1`）。
备用集与环境变体维持合并前 / 夜跑，迭代过程中不看。
完整实验序列与读数见 `docs/evidence/interaction-eval/BASELINE.md`。

## 一条被纠正的判断（L3-4 不是 spec 变更）

早先以为 `scripts/check-interact.mjs` 的 L3-4「状态菜单没有输入框；干涉世界
不可写」会因为交互功能而顶红，需要先改期望值。**核对后是错的**：L3-4 查的是
`#unit-status` 里的输入控件与提示语，而本设计把动作按钮放在 `#villager-panel`
的独立容器，`#unit-status` 一行都不动，所以那条断言保持绿。

去改一条本来绿的断言，恰恰是 EDD 文章里警告的「覆盖掉已工作的行为」。
所以：**L3-4 原样保留**，「动作按钮不许漏进 unit-status」由本数据集的 M1
（`forbiddenIn`）自己守。这条更正记在 `docs/evidence/interaction-eval/BASELINE.md`。
