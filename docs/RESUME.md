# 断点续跑

## 当前断点

- 最后 HEAD: 3f8193c (feat/art-ref-1111)；本文件是记录之后多出来的一笔，用 `git log --oneline 3f8193c..HEAD` 看
- 未提交改动: 无
- 已跑闸门: check ✅ / audit:ports ✅ / audit:baseline ✅ / test ✅ (2687 tests, 2678 pass, 0 fail, 9 skip) / red:first ✅ (base 上断言红) / build ✅ / palette ✅ / references ✅ / citations ✅ / sections ✅ / claims ✅ / pytest ✅ / fixture:check ✅；浏览器：check-art-assets ✅ / persistence ✅ / render-budget ✅ / phases ✅ / building-bake ✅ / check-interact 32/33（见下）
- 未跑/失败: `check-interact` L3-6 稳定失败，但未改一行的 `origin/main` 对照树同样失败，与本轮无关；`check:hooks` 首跑因新工作树没继承 `core.hooksPath` 报 FAIL，执行 `git config core.hooksPath .githooks` 后 OK。其余无。
- 下一步命令: `cd D:/project/pwe-art-1111/world-client && npm run check && npm test && npm run build`

本轮做的：以 2026-11-11 根目录十张参考图为风格锚点，调 Agnes 补齐七张村民
立绘、确定性切出 29 件状态/图标/表情素材、把其中三类接到 DOM 面板（`?art=0`
仍零素材请求）；ADR 见 `docs/adr/ADR_ART_REF_20261111.md`，读数与前后对比见
`docs/evidence/art-ref-1111/README.md`。**未做**：十张图里的世界地图 / 桌面 UI
设计稿 / 村庄 2×2 / 学者区建筑 / tileset 只作构图基准；建筑与布景的 17 件旧
素材没重画（推倒会让风格从两层并排变三层混用）；祭坛三态与多数表情是素材库，
未接线。这三条都要单独裁决，别当成「已做完」。

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
