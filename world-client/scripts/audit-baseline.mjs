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

import { existsSync, readdirSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import {
  MANIFEST_NAME,
  collectHashes,
  diffBaseline,
  diffLines,
  isClean,
  namesFromTracked,
  readManifest,
  writeManifest,
} from './lib/baseline-manifest.mjs';
import { BASELINE_DIR, CLIENT_ROOT, trackedFilesIn } from './lib/shot-output.mjs';

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const dirFlag = argv.indexOf('--dir');
// `--dir` 后面没值就报错，**不许悄悄回退到默认目录**：那样人会以为自己在查
// 另一个目录，读到的却是仓库基线，绿得毫无意义。
if (dirFlag >= 0 && (argv[dirFlag + 1] === undefined || argv[dirFlag + 1].startsWith('--'))) {
  console.error('[基线] 判红：--dir 后面缺目录。要查默认基线就别带这个开关。');
  process.exit(1);
}
const dir = dirFlag >= 0 ? argv[dirFlag + 1] : BASELINE_DIR;
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

// 记录读不懂（版本不符 / 形状不对）时：**校验**必须红，但 `--update` 必须能走
// ——重建记录正是为这种情况准备的路。两者分开，不把「读不懂」当成「不能动」。
let manifest = null;
let manifestError = null;
try {
  manifest = readManifest(dir);
} catch (error) {
  manifestError = error;
}

if (manifestError !== null && !update) {
  console.error(`[基线] 判红：记录读不懂——${manifestError instanceof Error ? manifestError.message : String(manifestError)}`);
  console.error('[基线] 读不懂的记录不能当「空记录」，也不能当「一致」：先查这个文件，再决定是修还是重建。');
  console.error('[基线] 重建：node scripts/audit-baseline.mjs --update（会按当前磁盘内容重写记录）');
  process.exit(1);
}

// 目录里「有、但没跟踪」的文件：它们**不在**入账范围（记录不给脏工作树背书），
// 但也不能默默略过——新拍的一张基线如果还没 `git add`，`--update` 会报「新增 0」，
// 而 CI 上它又会出现成 unlisted。这个坑得当场说出来。
const untrackedInDir = readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => name !== MANIFEST_NAME && !tracked.includes(name))
  .sort((a, b) => a.localeCompare(b, 'en'));

const warnUntracked = () => {
  // 没有已跟踪文件时「未跟踪」是这整个目录的属性，不是异常（`--dir` 查拷贝时
  // 每个文件都未跟踪）。只在「这是一棵真树」的前提下才提醒。
  if (tracked.length === 0 || untrackedInDir.length === 0) return;
  console.error(`[基线] 注意：${label} 下有 ${untrackedInDir.length} 个文件**未跟踪**，不在入账范围。`);
  for (const name of untrackedInDir.slice(0, 10)) console.error(`  · 未跟踪  ${name}`);
  if (untrackedInDir.length > 10) console.error(`  · …另有 ${untrackedInDir.length - 10} 个`);
  console.error('[基线] 新基线要先 `git add` 再 `--update`，否则本地绿、CI 红（unlisted）。');
};

// update 的入账范围只认「已跟踪」：未跟踪的临时图落在同一目录时不该被写进记录，
// 否则记录会替一棵脏工作树背书。
if (update) {
  if (tracked.length === 0) {
    console.error(`[基线] 判红：${label} 下没有已跟踪文件，没有可入账的基线。`);
    process.exit(1);
  }
  if (manifestError !== null) {
    console.error(`[基线] 旧记录读不懂（${manifestError instanceof Error ? manifestError.message : String(manifestError)}）`);
    console.error('[基线] 按「重建」处理：下面没有逐条 old→new，记录会整份换掉。');
  }
  warnUntracked();
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
  for (const line of diffLines(after, { labels: { missing: 'removed', unlisted: 'added' } })) {
    console.log(line);
  }
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
  warnUntracked();
  process.exit(0);
}

console.error(`[基线] 判红：${label} 的字节与记录不符。`);
console.error(`[基线] changed ${diff.changed.length} / missing ${diff.missing.length} / unlisted ${diff.unlisted.length}`);
for (const line of diffLines(diff, {
  notes: { missing: '（记录里有、磁盘上没有）', unlisted: '（磁盘上有、记录里没有）' },
})) {
  console.error(line);
}
console.error('');
console.error('[基线] 基线的意思就是「字节没变过」。如果这次是有意换基，');
console.error('[基线] 必须显式：node scripts/audit-baseline.mjs --update，并与图放在同一个提交里。');
console.error('[基线] 如果这次不该换基，那么现在这份已经是**别人换过的**字节，去 git diff 找是谁。');
process.exit(1);
