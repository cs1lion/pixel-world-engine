# 断点续跑

## 当前断点

- 最后 HEAD: 592cb98 (feat/actions-interaction)；本文件是记录之后多出来的一笔，用 `git log --oneline 592cb98..HEAD` 看
- 未提交改动: 无
- 已跑闸门: check ✅ 0/0 / test ✅ (2721 tests, 2712 pass, 0 fail, 9 skip) / build ✅ / palette ✅ / references ✅ (559 处 0 存疑) / citations ✅ / sections ✅ / claims ✅ (markers 3, adr-schema 24 valid) / pytest ✅ / audit:ports ✅ (191 文件 / 0 禁用端口) / audit:baseline ✅ (166/166)；浏览器：check-art-assets ✅ (72 件全装、art=0 零请求) / smoke ✅ 132 项 / phases ✅ 40 项 / persistence ✅ 8 项 / render-budget ✅ 硬闸 3 项 / building-bake ✅ 72 张；EDD 主集 ✅ 10/10、备用集 ✅ 6/6
- 未跑/失败: `check-interact` 32/33（只剩既有 L3-6；未改的 L3-4 保持绿）、`check-ground-shadow` 红 4 条既有 G2/G3，两者都在未改一行的 `origin/main` 对照树复现过。一处纪律妥协如实登记：备用集 H1..H4 的判据是功能完成后才补齐的，严格 EDD 应先写（见 `docs/evidence/interaction-eval/BASELINE.md`）。
- 下一步命令: `git push -u origin feat/actions-interaction && gh pr create --base main --head feat/actions-interaction --fill`

五轮做完的：以 2026-11-11 十张参考图为锚点补齐七张村民立绘、29 件切片；
第二轮统一 17 件旧建筑/布景；第三轮构图贴片 + 祭坛/表情接线 + 店面换色；
第四轮主界面玻璃拟态视觉层 + 改前改后录屏（PR #40 / #41 / #42 均已合并）；
第五轮按 EDD 先写评测集（实验 0 为 4/16）再一笔一个行为爬坡：
C 方案 7 张分人动作表、村民面板 3 个动作（派活 / 给东西 / 问一句）、
素材收口与主集接 CI。实验序列 baseline-0 → exp-1 7/10 → exp-2 8/10
→ exp-3 10/10 → exp-4 10/10 → 备用集 6/6，逐条读数在
`docs/evidence/interaction-eval/`。ADR 见 `docs/adr/ADR_ACTIONS_INTERACTION_20261112.md`。

**剩下的边界，别当成已做完**：
1. 神谕自然语言入口没做：3 个动作只走面板 `WorldCommand`，规则层白名单、
   提示词与 SPEC 都没动。要扩就按 ADR 第 6 节第二阶段的清单同步改。
2. 桌面 UI 设计稿只落地视觉层；VERIFIED 抽屉、报纸弹窗常驻化等信息架构没重做。
   tileset / 世界地图没接成地面或小地图（会动一批像素基线）。
3. 灯笼、地砖、花径、树影仍是 24 色板程序化绘制——这是引擎设计，不是
   没换完的生图素材。
4. 徽记五张轮转给七人、表情按语义与行序选图，都不是身份 / 情绪读数。
5. 当前 `feat/actions-interaction` 还差 push / 开 PR / 等 CI / 合并四步；
   main 有远端分支保护，必须走 PR 且四项必需检查全绿。

---

一次任务被中断（关窗口、换人、agent 上下文被清空）后，下一个人要能回答四个问题：

1. 上次做到哪一步？
2. 哪些已经提交、哪些还只在工作区？
3. 哪些闸门跑过、哪些没跑或没过？
4. 下一条命令是什么？

这份文档是**约定**，不是自动状态。它要求中断前的人/agent 把事实写下来；
恢复时先照着核对，再决定继续、重跑还是丢弃。

## 中断前：覆盖写「当前断点」

在本文件顶部维护一节 `## 当前断点`（覆盖写，不追加历史；历史看 `git log`）。
最少五项，缺一项就等于没记录：

```markdown
## 当前断点

- 最后 HEAD: <sha> (<branch>)
- 未提交改动: <`git status --short` 的原文；没有就写「无」>
- 已跑闸门: check ✅ / test ✅ / build ✅ / palette ✅ / references ✅ / citations ✅ / sections ✅ / claims ✅ / pytest ✅
  （只勾真的跑过的；没跑写「未跑」，跑失败写「失败 + 首行读数」）
- 未跑/失败: <列出闸门名与原因；没有就写「无」>
- 下一步命令: <一条可直接粘贴的命令>
```

写法约束：

- **只写事实**。「应该没问题」「大概过了」不算读数，等于没跑。
- 读数贴**输出首行**（例如 `claims: markers=2 passed=2 failed=0`），不贴想象值。
- 未提交改动直接抄 `git status --short`，不要概括成「改了一些文件」。
- 下一步必须是**一条命令**，不是一句目标。目标是 `docs/` 里的事，命令是恢复入口。

## 恢复时：按顺序核对

```bash
git status --short --branch
git log -1 --format='%H %d %s'
git diff --stat
git stash list
```

- `git status` 告诉你断点记录之后有没有新改动；和「未提交改动」不一致时，
  **以工作区为准**，先看 `git diff` 再决定。
- `git log -1` 核对「最后 HEAD」。对不上说明中断后还有提交；用
  `git log --oneline <记录的 sha>..HEAD` 看多出来的部分。
- 已跑闸门不自动可信：环境、依赖、文件都可能变。**只重跑记录之后改动过的闸门**；
  记录里没写「已跑」的一律补跑。

九道闸门与 CI 对应关系见 `CLAUDE.md` 的「九道闸门」一节。最短恢复路径：

```bash
cd world-client && npm run check && npm test && npm run build
cd world-client && node scripts/audit-palette.mjs --strict
cd world-client && node scripts/audit-references.ts --strict && node scripts/audit-citations.ts --strict && node scripts/audit-sections.ts --strict && node scripts/audit-claims.ts --strict
cd server && python -m pytest
```

并行 worktree 造成的「改了但不是我这棵树」问题，用 `npm run worktrees:audit`
和 `docs/WORKTREES.md` 核对归属；不要靠猜分支。

### 浏览器闸门必须显式指定本 worktree 的端口

四道默认读 `PIXEL_WORLD_URL` 的闸门（`test:browser` smoke / `test:phases` /
`test:render-budget` / `test:persistence`）与只读 `PWE_URL` 的 `test:interact`，
不指定端口时都打 `5188`——而 `5188` 常常是另一个 worktree 的实例在跑。
2026-11-04 已因此产生两次假红：一次 8 项假红（读数来自别人的世界），
一次 `preCoverHabit is not a function`（对面构建比本树旧）。合并验收时：

```powershell
cd world-client; npm run build   # preview 服务的是 dist，先构建
$env:PIXEL_WORLD_URL="http://127.0.0.1:5190/"
$env:PWE_URL="http://127.0.0.1:5190/"
# preview 必须与闸门在同一次 shell 调用里起，调用结束就杀；换一棵树就换一个端口
```

回执里写清用的是哪个 URL——否则「红」到底是代码还是串台说不清。
`EVAL_OUT` 指向 `world-client/tmp/eval-*`，跑完 `git restore world-client/eval/screens`。

## 与提交的关系

- 断点记录本身可以提交（它就是仓库手续的一部分），但**不要求在每次中断都提交**；
  工作区里的记录同样有效，恢复时先读它。
- 如果中断时正在一个未提交的实验上，先 `git stash push -m '<一句话>'`，
  再把 stash 名写进「未提交改动」；直接丢工作区会让下一个人无法判断哪些是半成品。
