#!/usr/bin/env node
/**
 * 把动画状态机的状态/转移表写成 `docs/animation/villager-anim-fsm.md`。
 *
 * 文档是生成物，不是手稿：表格里的时长、条件、帧数都读自 `villager-anim-fsm.ts`，
 * `world-client/test/anim-fsm.test.ts` 逐字比对文档与生成函数。要改状态图，先改代码
 * 再跑本脚本。
 *
 * 用法（`world-client/` 下）：`node scripts/export-anim-graph.ts`
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { animGraphMarkdown } from '../src/animation/villager-anim-fsm.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT_DIR = resolve(ROOT, 'docs', 'animation');
const OUT_FILE = resolve(OUT_DIR, 'villager-anim-fsm.md');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, animGraphMarkdown(), 'utf8');
process.stdout.write(`wrote ${OUT_FILE}\n`);
