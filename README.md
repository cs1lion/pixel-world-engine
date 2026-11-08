# pixel-world-engine

> 一个可换设定集的像素世界引擎：世界自己跑，LLM 只能输出白名单内的结构化命令去改变它。

![灯潮界：一句话建起一座候车亭，世界自己照常过日子](world-client/eval/live/05-dengchao-built.png)

## 三大工程设计支柱 (Core Architectural Pillars)

详见 [`docs/SPEC.md`](docs/SPEC.md)：

1. **无模型依赖的确定性物理/时间步长模拟**：固定步长模拟物理、潮汐周期、居民作息与资源衰减。即使拔掉 LLM 服务端，世界仍能完全独立自洽运转。
2. **白名单 Schema 规则约束下的 Agent 生成与外环熔断**：LLM 仅允许输出严格符合 Schema 白名单的结构化命令。未通过校验时带具体原因退回，控制外环触发熔断保护，防止非法动作干涉世界状态。
3. **基于 Markdown + YAML Frontmatter 的三道关记忆时间线**：以人可读、可 diff 的 Markdown 文件替代复杂数据库架构（存储于 `memory/entries/`，按世界序号 `day-0000.md` 命名），结合编年史与事件链完成三道关记忆归档。

## 模块职责边界 (Module Responsibilities)

- `world-client/`: Phaser 3 前端渲染与模拟引擎
  - `src/world/`: 确定性模拟内核（不依赖 Phaser API）
  - `src/render/`: Phaser 3 Canvas 渲染与快照交互层
  - `src/settings/`: 设定集加载器（莞尔镇 / 灯潮界）
  - `src/ui/`: DOM 覆盖层（编年史面板、神谕面板、存档槽）
- `server/`: FastAPI 后端服务
  - `rules/`: 命令 Schema 定义与规则校验引擎
  - `llm/`: LLM 结构化造物主驱动接口与日志记录

## 快速启动 (Quick Start)

### 前端开发与运行

```bash
cd world-client
npm install
npm run dev
```

### 后端服务启动

```bash
cd server
pip install -r requirements.txt
python main.py
```
