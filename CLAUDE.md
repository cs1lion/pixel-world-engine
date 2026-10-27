# pixel-world-engine

一个可换设定集的像素世界引擎：世界自己跑，LLM 只能输出白名单内的结构化命令去改变它。

- 规范：`docs/SPEC.md`（v1 定稿）。取舍理由见 `docs/SPEC_DRAFT_20261025.md`。
- 迁移盘点：`docs/MIGRATION_FROM_XIAOXI.md`。
- 迭代目标暂存：`docs/iterations/`（目前：1027 迭代任务 1 · 内环、1027 迭代任务 2 · 外环）。
- 美术设定（初版视觉基准）：《千与千寻视觉设定集》，见 `docs/art/`。

## 命令

前端在 `world-client/`，CI 的前端 job 跑的是这几条（`npm run check` 就是
`node scripts/check-types.ts`，`npm run build` 在它之后才 `vite build`）：

```bash
cd world-client && npm ci
```

```bash
cd world-client && npm run check && npm test && npm run build
```

```bash
cd world-client && node scripts/audit-palette.mjs --strict
```

```bash
cd world-client && node scripts/audit-references.ts --strict && node scripts/audit-citations.ts --strict && node scripts/audit-sections.ts --strict
```

服务端在 `server/`，CI 有第二个 job：`pip install -r requirements.txt` 然后
`python -m pytest`。

**这几条要一起跑，别只跑前两条。** 这里原来只列了 `check / test / build`，还写着
「CI 跑的就是这几条」——那句话是假的：前端 job 实际跑八条，后四条是三个审引用的
脚本加一个查色板的。它们的输出有个共同性质：**引用对不上、节号不存在、色板超预算
，全都只让输出变长，不会让 `check`/`test` 变红。** 所以只跑前两条的人会以为自己是
绿的，而四个闸门一个都没过。完整清单以 `.github/workflows/ci.yml` 为准——那一份
加了新步骤时，这里要跟着改。

## Agent skills

### Issue tracker

GitHub Issues in `cs1lion/pixel-world-engine`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
