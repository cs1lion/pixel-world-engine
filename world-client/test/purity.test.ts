import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 世界内核的两条纯度契约。
//
// 1. src/world 不许 import Phaser：这条让世界逻辑能离线跑单测，
//    也是换渲染后端（Pixi / Canvas2D）时不改逻辑的前提。
// 第二条（src/world 不认识督办台账）要等事件日志存在之后才能落，
// 归 issue #4：现在有 9 个文件还带着 commission / ledger 语义，
// 清掉它们的前提是事件日志已经能承载世界变化。在那之前写一条红测试
// 只会让门禁失去意义。
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = walk(SRC);

test('src/world 不 import Phaser', () => {
  const offenders: string[] = [];
  for (const file of files) {
    const rel = file.slice(SRC.length + 1).split(path.sep).join('/');
    if (!rel.startsWith('world/')) continue;
    const text = readFileSync(file, 'utf8');
    if (/from ['"]phaser['"]/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `世界内核必须与渲染后端无关：\n${offenders.join('\n')}`);
});

test('潮汐逻辑不读墙钟', () => {
  // 潮位必须是 now 的纯函数。一旦读了 Date.now / performance.now，
  // 「同一个存档回放出同一条曲线」就不成立了，而那正是确定性回放的基础。
  const tideFile = files.find((file) => file.split(path.sep).join('/').endsWith('world/tide.ts'));
  assert.ok(tideFile !== undefined, '找不到 world/tide.ts');
  const text = readFileSync(tideFile, 'utf8');
  const banned = ['Date.now', 'performance.now', 'new Date('];
  const hits = banned.filter((pattern) => text.includes(pattern));
  assert.deepEqual(hits, [], `潮汐不许读墙钟：${hits.join(', ')}`);
});
