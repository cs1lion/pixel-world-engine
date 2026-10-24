# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `GLOSSARY-MAP.md` at the root):

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

---

## 本仓库现状（single-context）

2026-10-25 复核：

- `GLOSSARY.md` — 不存在（按上面规则，先静默跳过，等 `/domain-modeling` 需要时再建）
- `GLOSSARY-MAP.md` — 不存在 → 单上下文
- `docs/adr/` — 不存在。本仓库目前还没有 ADR 目录，架构决策写在：
  - `docs/SPEC.md` — v1 定稿（三层规则、潮汐、灯油、事件日志、记忆、存档）
  - `docs/SPEC_DRAFT_20261025.md` — 定稿前的五轮 grill 结论
  - `docs/MIGRATION_FROM_XIAOXI.md` — 从旧仓 `cs1lion/xiaoxi` 迁入时的实测盘点与差异
- monorepo 信号（`pnpm-workspace.yaml` / 根 `package.json` 的 `workspaces` / `packages/*`）— 全无。
  `world-client/` 有自己的 `package.json`，但根目录没有 workspace 声明，仍是单上下文。

**给 skill 的一条本地补充**：读决策先看 `docs/SPEC.md`，它是当前唯一的权威来源；
与 `docs/SPEC_DRAFT_*.md` 冲突时以 `SPEC.md` 为准，草稿只作为取舍理由的溯源。
