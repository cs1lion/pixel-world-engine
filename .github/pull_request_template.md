## 改了什么

<!-- 一段话说清改动范围；涉及 render/、save.ts、server/ 时点名对应路径。 -->

## 为什么

<!-- 解决的问题、取舍、被否掉的替代方案。没有取舍就写「没有别的做法」。 -->

## 验证命令与读数

<!-- 必填：至少贴一条真的跑过的命令和它的输出首行。没跑的写「未跑」。 -->

- [ ] `cd world-client && npm run check` →
- [ ] `cd world-client && npm test` →
- [ ] `cd world-client && npm run build` →
- [ ] `node scripts/audit-palette.mjs --strict` →
- [ ] `node scripts/audit-references.ts --strict` →
- [ ] `node scripts/audit-citations.ts --strict` →
- [ ] `node scripts/audit-sections.ts --strict` →
- [ ] `node scripts/audit-claims.ts --strict` →
- [ ] `cd server && python -m pytest` →
- [ ] `npm run check:hooks` →（仓库根目录；没装钩子时写「未装」并说明）
- [ ] `npm run worktrees:audit` →（涉及 worktree 时）

## 断点（可选）

<!-- 任务被中断时，把 docs/RESUME.md 的「当前断点」五项抄在这里。 -->
