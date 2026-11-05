#!/usr/bin/env node
/**
 * 每次复跑 / 重录前的幂等前置：清掉隔离世界状态，避免上一跑的事件库与镇志漂进画面。
 *
 * 只动 `<repo>/tmp/` 下两处（可用 `VERIFY_TMP` 覆盖根目录）：
 *   - tmp/verify-events/events.db（含 -wal / -shm）
 *   - tmp/verify-memory/
 *
 * 幂等：不存在就跳过，存在就删；跑完保证两个目录在、且为空。
 * 不碰存档 v5、不碰 `eval/screens`、不碰 `world-client/src`。
 *
 * 跑法（在 world-client 下）：`npm run verify:reset`，或直接 `node scripts/reset-verify-state.mjs`。
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TMP = process.env.VERIFY_TMP
  ? resolve(process.env.VERIFY_TMP)
  : resolve(import.meta.dirname, '..', '..', 'tmp');

const TARGETS = [
  'verify-events/events.db',
  'verify-events/events.db-wal',
  'verify-events/events.db-shm',
  'verify-events/events.db-journal',
  'verify-memory',
];

const removed = [];
for (const name of TARGETS) {
  const target = join(TMP, name);
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  removed.push(name);
}

for (const dir of ['verify-events', 'verify-memory']) {
  mkdirSync(join(TMP, dir), { recursive: true });
}

console.log(`[verify-reset] tmp=${TMP}`);
console.log(`[verify-reset] 删除 ${removed.length} 项：${removed.join(', ') || '（本来就干净）'}`);
