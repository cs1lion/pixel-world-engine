#!/usr/bin/env node
/**
 * 基线字节自证（E13）：`eval/screens/` 里每一张已跟踪的图，都必须和
 * `.baseline-manifest.json` 里记下的 sha256 对得上。
 *
 * 这个仓库的像素证据全是「拿这一次的截图去和一份固定底片比」。底片与运行产物
 * 同名同址，`--write-baseline` / `EVAL_OUT=eval/screens` 一授权就直接覆盖，
 * 覆盖之后没有任何东西会发现——之后所有比较都拿新字节当基准，旧字节只能翻
 * git 历史。所以这里补一条**能红**的闸门：字节变了就红，换基线必须显式。
 *
 * 跑法：
 *   node scripts/audit-baseline.mjs            # 校验（CI 与本地都跑这条）
 *   node scripts/audit-baseline.mjs --update   # 显式换基：重写记录，并把变了什么打出来
 *
 * 三类漂移分开报（见 lib/baseline-manifest.mjs）：changed / missing / unlisted。
 * 记录不存在也算红——「没有记录」不等于「没变过」，只等于「从来不可自证」。
 */

import { existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import {
  MANIFEST_NAME,
  collectHashes,
  diffBaseline,
  isClean,
  namesFromTracked,
  readManifest,
  writeManifest,
} from './lib/baseline-manifest.mjs';
import { BASELINE_DIR, CLIENT_ROOT, trackedFilesIn } from './lib/shot-output.mjs';

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const dirFlag = argv.indexOf('--dir');
const dir = dirFlag >= 0 && argv[dirFlag + 1] ? argv[dirFlag + 1] : BASELINE_DIR;
const label = (() => {
  const rel = relative(CLIENT_ROOT, dir).split(/[\\/]+/).join('/');
  return rel && !rel.startsWith('..') && !rel.includes(':') ? `world-client/${rel}` : dir;
})();

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：node scripts/audit-baseline.mjs [--update] [--dir <目录>]');
  process.exit(0);
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`[基线] 判红：${label} 不是目录。基线目录不存在时「没有漂移」这句话不成立。`);
  process.exit(1);
}

/** 已跟踪的基线文件（仓库相对路径 → 目录相对名，排掉记录自己）。 */
let tracked;
try {
  tracked = namesFromTracked(trackedFilesIn(dir), dir, { clientRoot: CLIENT_ROOT });
} catch (error) {
  // 「不知道有没有已跟踪文件」不等于「没有」：不能据此认为基线干净。
  console.error(`[基线] 判红：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let manifest;
try {
  manifest = readManifest(dir);
} catch (error) {
  console.error(`[基线] 判红：记录读不懂——${error instanceof Error ? error.message : String(error)}`);
  console.error('[基线] 读不懂的记录不能当「空记录」，也不能当「一致」：先查这个文件，再决定是修还是重建。');
  process.exit(1);
}

// update 的入账范围只认「已跟踪」：未跟踪的临时图落在同一目录时不该被写进记录，
// 否则记录会替一棵脏工作树背书。
if (update) {
  if (tracked.length === 0) {
    console.error(`[基线] 判红：${label} 下没有已跟踪文件，没有可入账的基线。`);
    process.exit(1);
  }
  const hashes = collectHashes(dir, tracked);
  const before = manifest?.files ?? {};
  const after = diffBaseline(before, hashes);
  writeManifest(dir, hashes);
  const parts = [
    `进账 ${tracked.length} 个`,
    `新增 ${after.unlisted.length}`,
    `字节变化 ${after.changed.length}`,
    manifest === null ? '（首次建立记录）' : `消失 ${after.missing.length}`,
  ];
  console.log(`[基线] 已重写 ${label}/${MANIFEST_NAME}：${parts.join(' / ')}`);
  for (const item of after.changed.slice(0, 20)) {
    console.log(`  · changed  ${item.name}  ${item.recorded.slice(0, 12)}… → ${item.actual.slice(0, 12)}…`);
  }
  for (const name of after.missing.slice(0, 20)) console.log(`  · removed  ${name}`);
  for (const name of after.unlisted.slice(0, 20)) console.log(`  · added    ${name}`);
  const more =
    after.changed.length + after.missing.length + after.unlisted.length - 60;
  if (more > 0) console.log(`  · …另有 ${more} 个未逐条列出`);
  console.log('[基线] 记录与图必须进**同一个提交**，并在提交说明里写为什么换基。');
  process.exit(0);
}

if (manifest === null) {
  console.error(`[基线] 判红：${label} 没有 ${MANIFEST_NAME}。`);
  console.error('[基线] 「没有记录」不等于「没变过」，只等于「这张图从来不可自证」。');
  console.error('[基线] 建记录：node scripts/audit-baseline.mjs --update');
  process.exit(1);
}

// 比对范围 = 记录里的 ∪ 已跟踪的：只比记录会漏掉「新加了一张基线却没进记录」。
const names = [...new Set([...Object.keys(manifest.files), ...tracked])].sort((a, b) => a.localeCompare(b, 'en'));
const actual = collectHashes(dir, names);
const diff = diffBaseline(manifest.files, actual);

if (isClean(diff)) {
  console.log(`[基线] ${label}：记录 ${Object.keys(manifest.files).length} 个 / 已跟踪 ${tracked.length} 个 / 全部一致`);
  process.exit(0);
}

console.error(`[基线] 判红：${label} 的字节与记录不符。`);
console.error(`[基线] changed ${diff.changed.length} / missing ${diff.missing.length} / unlisted ${diff.unlisted.length}`);
for (const item of diff.changed.slice(0, 20)) {
  console.error(`  · changed   ${item.name}  记录 ${item.recorded.slice(0, 12)}… → 实际 ${item.actual.slice(0, 12)}…`);
}
for (const name of diff.missing.slice(0, 20)) console.error(`  · missing   ${name}（记录里有、磁盘上没有）`);
for (const name of diff.unlisted.slice(0, 20)) console.error(`  · unlisted  ${name}（磁盘上有、记录里没有）`);
const more = diff.changed.length + diff.missing.length + diff.unlisted.length - 60;
if (more > 0) console.error(`  · …另有 ${more} 个未逐条列出`);
console.error('');
console.error('[基线] 基线的意思就是「字节没变过」。如果这次是有意换基，');
console.error('[基线] 必须显式：node scripts/audit-baseline.mjs --update，并与图放在同一个提交里。');
console.error('[基线] 如果这次不该换基，那么现在这份已经是**别人换过的**字节，去 git diff 找是谁。');
process.exit(1);
