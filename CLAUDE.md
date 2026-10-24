# pixel-world-engine

一个可换设定集的像素世界引擎：世界自己跑，LLM 只能输出白名单内的结构化命令去改变它。

- 规范：`docs/SPEC.md`（v1 定稿）。取舍理由见 `docs/SPEC_DRAFT_20261025.md`。
- 迁移盘点：`docs/MIGRATION_FROM_XIAOXI.md`。

## 命令

前端在 `world-client/`，CI 跑的就是这几条：

```bash
cd world-client && npm ci
```

```bash
cd world-client && npm run check && npm test && npm run build
```

## Agent skills

### Issue tracker

GitHub Issues in `cs1lion/pixel-world-engine`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
