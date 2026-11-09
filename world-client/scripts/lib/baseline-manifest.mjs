/**
 * 基线指纹：`eval/screens/` 里每一张已跟踪的图，都记下它**入库时的字节**。
 *
 * 为什么需要：这个仓库的像素证据全部建立在「拿这一次的截图去和一份固定的底片比」
 * 之上。底片（`eval/screens/*.png`）与运行产物同名同址，一次带授权的重拍会把它
 * 原地替换——替换之后所有比较都拿新字节当基准，而**没有任何机关会发现**
 * （E13）。后果不是「这一次读数错了」，是「从今往后每一次读数都失去了参照，
 * 且旧字节只能翻 git 历史才拿得回来」。
 *
 * 所以要有一份「记录」。记录只做两件事：
 *   1. 记住字节（sha256）——不进判断，只给证据；
 *   2. 让替换变成**可见的**：字节对不上就红，换基线必须显式 `--update`。
 *
 * 三条边界：
 *   · **只记不改**。本模块从不写图，只写记录；`--update` 也只重写记录本身。
 *   · **记录不记自己**。manifest 自己也在同一个目录里，入账会自我指涉
 *     （写记录 → 记录变 → 记录里记的记录又不对），一律排除。
 *   · **确定性**。键排序、两空格、末尾换行：同样的输入必须写出同样的字节，
 *     否则「记录本身有没有被改过」又要靠人看 diff。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 记录文件名。与 `git ls-files` 的结果按名字排除，不按扩展名。 */
export const MANIFEST_NAME = '.baseline-manifest.json';
/** 记录格式版本。形状一改就抬版本，旧记录按「不可解析」判红，不猜。 */
export const MANIFEST_VERSION = 2;

/** 落进记录的说明。写在文件里是为了让**打开记录的人**知道规矩，不依赖文档。 */
export const MANIFEST_NOTE =
  '字节指纹：本目录下的已跟踪基线。文本文件按 LF 归一后取指纹（CRLF 工作区与 Linux runner 必须同值），二进制按原字节。换基线必须显式 `npm run audit:baseline -- --update`，并与图放在同一个提交里说明为什么换。';

const HEX64 = /^[0-9a-f]{64}$/;

/** sha256 的十六进制串。全 64 位，不截断——截断的指纹不算指纹。 */
export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 单文件指纹。文件不存在直接抛：调用方该先筛存在性，这里不替它兜。 */
export function hashFile(absPath) {
  return fingerprintBytes(readFileSync(absPath));
}

/**
 * git 自己的二进制判据：前 8000 字节里出现 NUL 就当二进制。
 *
 * 为什么不用扩展名：`.png` / `.json` 是习惯，不是事实；这条闸门要是靠扩展名
 * 猜错了，二进制会被「归一」成另一份字节（PNG 里本来就有 `\r\n` 字节对），
 * 指纹从此失去意义。
 */
export function isBinaryBuffer(buffer) {
  const limit = Math.min(buffer.length, 8000);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * 基线指纹：文本按 **LF 归一**后取 sha256，二进制按原字节。
 *
 * 为什么不直接对磁盘字节取指纹：这个仓库的 `core.autocrlf=true`，`.json` / `.html`
 * 这类文本在库里是 `i/lf w/crlf`——Windows 工作区读到的是 CRLF，Linux runner
 * checkout 出来的是 LF。同一份内容在两处得到两个指纹，闸门就会在 CI 上红一片
 * （2026-11-09 第一次跑 CI 就红在这里：17 个文本文件全被判「字节变了」，PNG 反而
 * 一个没动）。
 *
 * 「基线有没有变」不该由平台的行尾决定；而**入库字节**的口径就是 LF，所以归一
 * 之后才是真正的「那份字节」。二进制不归一：PNG 里出现 `\r\n` 是巧合，不是行尾。
 */
export function fingerprintBytes(buffer) {
  if (isBinaryBuffer(buffer)) return hashBuffer(buffer);
  const text = buffer.toString('latin1').replace(/\r\n/g, '\n');
  return hashBuffer(Buffer.from(text, 'latin1'));
}

/** 目录内若干文件的指纹表（键是目录相对的 posix 路径）。缺失的文件不进表。 */
export function collectHashes(dir, names) {
  const out = {};
  for (const name of names) {
    const abs = join(dir, name);
    if (existsSync(abs)) out[name] = hashFile(abs);
  }
  return out;
}

/**
 * 把「记录」和「磁盘上实际」对一遍，三类分开报——三类对应三种不同的错，
 * 合成一句「不一致」等于没说：
 *
 *   · `changed`  —— 记过、在、但字节变了：**有人换掉了基线**（E13 要抓的就是这个）；
 *   · `missing`  —— 记过、但文件没了：基线被删（或被改名）；
 *   · `unlisted` —— 在、但没记过：新基线没进记录，等于它**从来不可自证**。
 *
 * 空目录 / 空记录返回空三类，不算通过——**通过与否由调用方按总数判断**，
 * 不在这里把「什么都没比」写成「一致」。
 */
export function diffBaseline(recorded, actual) {
  const changed = [];
  const missing = [];
  const unlisted = [];

  for (const [name, want] of Object.entries(recorded)) {
    if (!(name in actual)) missing.push(name);
    else if (actual[name] !== want) changed.push({ name, recorded: want, actual: actual[name] });
  }
  for (const name of Object.keys(actual)) {
    if (!(name in recorded)) unlisted.push(name);
  }

  const byName = (a, b) => a.localeCompare(b, 'en');
  changed.sort((a, b) => byName(a.name, b.name));
  missing.sort(byName);
  unlisted.sort(byName);
  return { changed, missing, unlisted };
}

/** 三类是否全空。 */
export function isClean(diff) {
  return diff.changed.length === 0 && diff.missing.length === 0 && diff.unlisted.length === 0;
}

/** 记录内容（对象），键已排序。写盘前用它，别直接 JSON.stringify 手搓。 */
export function buildManifest(files) {
  const sorted = {};
  for (const name of Object.keys(files).sort((a, b) => a.localeCompare(b, 'en'))) {
    sorted[name] = files[name];
  }
  return { version: MANIFEST_VERSION, note: MANIFEST_NOTE, files: sorted };
}

/** 确定性序列化：同样的 `files` 必须得到逐字节相同的结果。 */
export function serializeManifest(files) {
  return `${JSON.stringify(buildManifest(files), null, 2)}\n`;
}

/**
 * 解析记录。形状不对就**抛**，不返回空表——「记录读不懂」与「什么都没记」
 * 必须分开：前者是判据前提不成立，后者是还没建记录。两者都不能算通过。
 */
export function parseManifest(text, { source = MANIFEST_NAME } = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} 不是合法 JSON（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source} 顶层不是对象`);
  }
  if (raw.version !== MANIFEST_VERSION) {
    throw new Error(`${source} 版本是 ${String(raw.version)}，期望 ${MANIFEST_VERSION}`);
  }
  if (raw.files === null || typeof raw.files !== 'object' || Array.isArray(raw.files)) {
    throw new Error(`${source} 缺 files 表`);
  }
  for (const [name, hash] of Object.entries(raw.files)) {
    if (typeof hash !== 'string' || !HEX64.test(hash)) {
      throw new Error(`${source} 里 ${name} 的指纹不是 64 位十六进制：${String(hash)}`);
    }
  }
  return { version: raw.version, note: raw.note, files: raw.files };
}

/** 读记录；文件不存在返回 null（「还没建记录」），存在但读不懂则抛。 */
export function readManifest(dir, { manifestName = MANIFEST_NAME } = {}) {
  const abs = join(dir, manifestName);
  if (!existsSync(abs)) return null;
  return parseManifest(readFileSync(abs, 'utf8'), { source: relative(process.cwd(), abs) || abs });
}

/** 写记录（确定性字节）。返回写出的文本，便于调用方打印摘要。 */
export function writeManifest(dir, files, { manifestName = MANIFEST_NAME } = {}) {
  const text = serializeManifest(files);
  writeFileSync(join(dir, manifestName), text);
  return text;
}

/**
 * 从 `git ls-files` 的仓库相对路径里挑出「本目录、且不是记录自己」的文件名。
 *
 * `trackedFilesIn` 返回的是仓库相对路径（`world-client/eval/screens/x.png`），
 * 记录里存的是目录相对名（`x.png`）——两边同名会让人以为可以直接比对，
 * 所以转换只在这一处做。
 */
export function namesFromTracked(trackedFiles, dir, { clientRoot, manifestName = MANIFEST_NAME } = {}) {
  const names = [];
  for (const tracked of trackedFiles) {
    const rel = relative(dir, join(clientRoot, tracked)).split(/[\\/]+/).join('/');
    if (rel === '' || rel.startsWith('..') || rel.includes(':')) continue;
    if (rel === manifestName) continue;
    names.push(rel);
  }
  return names.sort((a, b) => a.localeCompare(b, 'en'));
}
