# pixel-world-engine

一个可换设定集的像素世界引擎。世界自己跑起来，LLM 按世界法则输出结构化命令去改变它。

## 这个仓库要做什么

- **世界优先**：真实运行的像素世界是主体，Agent 干活只是世界的一种输入。
- **引擎而非一款游戏**：换一套设定集就能长出另一个世界。视觉与数值数据走配置文件，潮汐与灯油的逻辑留在代码里。
- **规则约束下的生成**：LLM 只能输出白名单内的结构化命令，Schema 过不了就拒收并说明原因。
- **记忆是时间线**：按日期 + 人物经历 + 世界事件存成 Markdown，量大之后再谈检索。

## 目录

```text
world-client/   Phaser 前端（模拟内核 + 渲染 + HUD）
server/         FastAPI：规则校验、事件日志、LLM 造物主
docs/           设计与决策（规范见 docs/SPEC.md）
```

## 跑起来

```bash
cd world-client && npm ci
```

```bash
cd server && python -m pip install -r requirements.txt
```

一条命令起两半（服务端 `main:app` + 前端 Vite），事件库落在 `tmp/`，不碰 `data/events.db`：

```bash
cd world-client && npm run dev:live
```

- 默认服务端 8000、前端 5188；两个端口都能用 `PIXEL_WORLD_SERVER_PORT` / `PIXEL_WORLD_CLIENT_PORT` 改，被占就直接报错，不偷偷换端口。
- 停：`Ctrl+C`，或者 `node scripts/dev-live.mjs --stop`。
- 没有 `server/.env` 也能起：世界照常跑，意图端点回 503，顶栏会写「上游离线」。

要接模型，复制 `server/.env.example` 成 `server/.env` 并填 Key。服务端启动时会读它，**只打印读到了哪些变量名，不打印值**。

## 验证

```bash
cd world-client && npm run check && npm test && npm run build
```

```bash
cd server && python -m pytest -q
```

浏览器验收（自带隔离端口与事件库，不需要先起 `dev:live`）：

```bash
cd world-client && npm run test:live
```

它走真实 HTTP：一句话 → 服务端白名单 → 回到世界 → 世界里真的多了一栋楼；一句办不到的话 → 具体原因回到回执上；停掉服务端 → 世界照常过日子，顶栏改说「上游离线」。

## 与旧仓的关系

渲染与模拟内核来自 `cs1lion/xiaoxi` 的 `pixel-world/`。旧仓保留为参考，不再演进。
两边的差异与迁移记录见 `docs/MIGRATION_FROM_XIAOXI.md`。

## 状态

P0 真实命令闭环已通：生产世界上下文接进意图端点，拒绝原因一路回到用户手上，命令与实例 id 的协议有测试钉住。
设定集 B 与时间线记忆还没开始。
