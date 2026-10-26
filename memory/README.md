# memory/

世界的时间线记忆。Markdown + YAML frontmatter，人可读、可 diff、不用查数据库。

    memory/
    ├── entries/day-0007.md        每日快照：由事件日志派生，不要手改
    ├── characters/莞尔.md          单人档案：逐条追加，只增不改
    ├── events/E0001-渡口的第一夜.md 单次事件：起因、经过、结果、证据
    ├── rules/礼仪.yaml             L2 社会规则
    └── index.yaml                  索引

子目录不存在也没关系：服务端第一次写入前会建齐（`MemoryLayout.ensure()`）。

## 三条铁律

写在 `server/memory/` 里**执行**，不是靠人守：

1. **只有 `direct_observation` 能触发写入。** 模型可以转述观测到的事——
   那条路是调用方先观测、再把结果作为 `body` 传进来，`source` 仍然是
   `direct_observation`。声称 `llm_generation` 的一律拒。
2. **每条必须带 `source` 与证据链。** 证据是事件日志里的 id，写入前会真的去查；
   有一个查不到，整条记忆被拒。
3. **没有依据时，宁可不写。** 证据为空一律拒；writer 自己一个字都不编。

## 两条路不相交

| 目录 | 谁写 | 能不能重生成 |
| --- | --- | --- |
| `entries/` | `snapshot.py`（派生） | 能，且内容相同就不写 |
| `events/` `characters/` | `writer.py`（逐条） | 不能，只增不改 |

混在一起就会出问题：重生成快照会把追加写下的记忆冲掉。所以快照只覆盖
`entries/`，逐条记忆只往 `events/` 与 `characters/` 里加。

## 为什么是 `day-0007.md` 而不是 `2026-10-25.md`

事件的 `at` 是**世界时间**（固定步长推进的毫秒数），没有墙钟。用日历日期命名
就得引入墙钟，而墙钟会让「同一份日志在不同机器上生成同一份快照」当场破功。
所以文件名用世界日序号，frontmatter 里带 `[from_ms, to_ms)` 的世界时间窗口——
人照样能锚定是哪一天，回放照样确定。理由见 `docs/adr/ADR_MEMORY.md`。

## 接口

    POST /api/memory/write     写一条记忆（201；铁律不过 → 422）
    GET  /api/memory/list      列条目与摘要
    POST /api/memory/snapshot  重新生成每日快照（空对象 = 全部）
