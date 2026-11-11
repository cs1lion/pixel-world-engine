# pixel-world-engine

> 一个可换设定集的像素世界引擎：世界自己跑，LLM 只能输出白名单内的结构化命令去改变它。

![灯潮界：一句话建起一座候车亭，世界自己照常过日子](world-client/eval/live/05-dengchao-built.png)

## 这是什么

世界的时间、潮汐、居民作息与资源衰减都由固定步长模拟推进，**拔掉 LLM 服务端也照常运转**。
模型不是世界的驱动者，只是外环的一个提议者：它输出的结构化命令要过 Schema 白名单校验，
没过就带具体原因退回，外环触发熔断保护，非法动作碰不到世界状态。

三大工程设计支柱（详见 `docs/SPEC.md`）：

1. **无模型依赖的确定性模拟**：同一份输入、同一份存档，在任何机器上跑出同一个世界。
2. **白名单 Schema 约束下的 Agent 生成与外环熔断**：模型只能说规则表里有的一句话。
3. **基于 Markdown + YAML Frontmatter 的三道关记忆时间线**：记忆写在 `memory/entries/`
   下，按世界日序号命名（`day-0000.md`），人可读、可 diff，事件链与编年史同源。

## 目录

| 路径 | 职责 |
| --- | --- |
| `world-client/src/world/` | 确定性模拟内核，不依赖 Phaser API |
| `world-client/src/render/` | Phaser 4 渲染：瓦片、建筑、村民、光层、位图素材 |
| `world-client/src/settings/` | 设定集加载器（莞尔镇 / 灯潮界） |
| `world-client/src/ui/` | DOM 覆盖层：编年史、日历、神谕、单位面板 |
| `world-client/public/assets/` | 离线生成的位图素材与 `manifest.json` |
| `world-client/eval/` | 验收截图与基线 |
| `server/rules/` | 命令 Schema 与规则校验引擎 |
| `server/oracle/` | LLM 网关与结构化造物主接口 |
| `server/memory/` | 记忆落盘、证据核对与每日快照 |
| `server/art/` | 生图素材管线（抠底 / 裁边 / 缩放 / 清单） |
| `server/scripts/` | 按需生成素材、批量重画与审计脚本 |
| `docs/` | 规范、ADR、迭代任务、证据与断点记录 |

## 美术

世界画面由**三层**叠出来：几何与地面走 24 色板程序化绘制，建筑 / 村民 / 布景走离线生成
的位图素材，叙事细节靠 Trace 随时间沉积。素材是作品，进版本管理、可评审、可回放；
运行时绝不现场生图。

- 初版视觉基准：《千与千寻视觉设定集》，见 `docs/art/README.md`。
- 第二套视觉基准：2026-11-11 提供的十张参考图（16-bit 硬像素、暖木色与琥珀灯光），
  副本、联系表与可浏览画廊见 `docs/art/reference-20261111/`。
- 三轮落地的决策与取舍：`docs/adr/ADR_ART_REF_20261111.md`；闸门读数与前后实拍：
  `docs/evidence/art-ref-1111/README.md`。
- 素材清单（66 件，含每件的尺寸、sha256 与来源）：`world-client/public/assets/manifest.json`。
- 生成脚本：`server/scripts/gen_asset.py`（单件）、`server/scripts/art_ref_1111.py`
  （立绘与切片）、`server/scripts/art_unify_1111.py`（旧素材统一）、
  `server/scripts/art_plates_1111.py`（画册贴片）。
- 位图默认开，`?art=0` 一笔不装，回落到全程序化绘制——排障与像素基线比对都靠这条退路。

## 快速启动

前端（`world-client/`，Node 22）：

```bash
cd world-client
npm ci
npm run dev
```

服务端（`server/`，Python 3.11+）：

```bash
cd server
pip install -r requirements.txt
python main.py
```

服务端读 `server/.env`（已被 `.gitignore` 挡住，不入库）：`LLM_*` 接结构化造物主网关，
`IMAGE_*` 接 Agnes 生图接口。没配 Key 时世界照常跑，只是神谕与离线素材生成不可用。

## 验证

CI 的**十一道闸门**：前端 job 十道、服务端 job 一道，完整清单以
`.github/workflows/ci.yml` 为准。后五道（色板与三份审引用、标注断言）的输出有个共同
性质——断言对不上、节号不存在、色板超预算，都只让输出变长，不会让 `check` / `test`
变红。只跑前三条的人会以为自己是绿的。

最短完整路径：

```bash
cd world-client
npm run check && npm test && npm run build
node scripts/audit-palette.mjs --strict
node scripts/audit-references.ts --strict
node scripts/audit-citations.ts --strict
node scripts/audit-sections.ts --strict
node scripts/audit-claims.ts --strict
cd ../server && python -m pytest
```

另有浏览器验收 job（持久化、渲染预算、四刻可辨性、素材装载、建筑烘焙），只读、
截图写到 runner 临时目录。多 worktree 并行时**必须给每棵树固定端口并显式设
`PIXEL_WORLD_URL`**，否则会测到别人的世界；身份闸 `/__tree-id` 就是防这个的。

## 工程纪律

- `docs/SPEC.md` 是唯一权威；历史草案只归档不删除，**禁止新增 `SPEC_*` 文件**，
  新决策写进 `docs/SPEC.md` 或 `docs/adr/`。
- `main` 已开远端分支保护：必须走 PR、四项必需检查全绿才能合，禁强推、禁删除，
  管理员不豁免。本地 `.githooks/pre-push` 是第二道，装法见 `CLAUDE.md`。
- 并行 worktree 在 `docs/WORKTREES.md` 登记；`npm run worktrees:audit` 只列不删，
  回收由 owner 手动做。
- 任务中断前按 `docs/RESUME.md` 覆盖写「当前断点」五项；恢复时先核对
  `git status --short --branch` 与 `git log -1`，再补跑记录之后改动过的闸门。
- 24 色板与 UI 9 色是硬预算，位图层独立管，见 `docs/adr/ADR_ART_PALETTE_DECISION.md`。

## 相关文档

| 想找什么 | 去哪 |
| --- | --- |
| 规范与验收 | `docs/SPEC.md` |
| 决策记录 | `docs/adr/` |
| 未决问题与降级清单 | `docs/OPEN_ISSUES.md` |
| 迁移盘点 | `docs/MIGRATION_FROM_XIAOXI.md` |
| 工程纪律条目 | `docs/ENGINEERING_DISCIPLINE.md` |
| 美术设定与参考图 | `docs/art/` |
| 证据与实拍 | `docs/evidence/` |
| 迭代目标暂存 | `docs/iterations/` |
