import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 基线指纹库（E13）的新增模块。red-first 会把这份测试套到 base 上，而 base 里
 * 没有 `scripts/lib/baseline-manifest.mjs`——直接 `import` 会以
 * ERR_MODULE_NOT_FOUND 结束并被判成 ERROR（基础设施问题），不是「红在断言上」。
 *
 * 沿用 `shot-output.test.ts` / `tree-identity.test.ts` 的形状：动态 import
 * + 吞掉模块不存在，每条用例第一句先断言导出存在。
 */
interface BaselineModule {
  MANIFEST_NAME?: string;
  MANIFEST_VERSION?: number;
  hashBuffer?: (buffer: Buffer) => string;
  fingerprintBytes?: (buffer: Buffer) => string;
  diffLines?: (diff: unknown, options?: Record<string, unknown>) => string[];
  hashFile?: (absPath: string) => string;
  collectHashes?: (dir: string, names: string[]) => Record<string, string>;
  diffBaseline?: (
    recorded: Record<string, string>,
    actual: Record<string, string>,
  ) => {
    changed: { name: string; recorded: string; actual: string }[];
    missing: string[];
    unlisted: string[];
  };
  isClean?: (diff: {
    changed: unknown[];
    missing: unknown[];
    unlisted: unknown[];
  }) => boolean;
  buildManifest?: (files: Record<string, string>) => {
    version: number;
    note: string;
    files: Record<string, string>;
  };
  serializeManifest?: (files: Record<string, string>) => string;
  parseManifest?: (text: string, options?: { source?: string }) => { files: Record<string, string> };
  namesFromTracked?: (
    trackedFiles: string[],
    dir: string,
    options?: { clientRoot?: string; manifestName?: string },
  ) => string[];
}

const MODULE_PATH: string = '../scripts/lib/baseline-manifest.mjs';
const MODULE_MISSING = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND']);
const loadFrom = async (url: string): Promise<BaselineModule> => {
  try {
    return (await import(url)) as unknown as BaselineModule;
  } catch (error) {
    // 只吞「文件不在」（red-first 时模块还没写）。裸 `catch {}` 会把模块里的语法错、
    // 导入错也变成后面的「缺 diffBaseline」——测试套自己说谎，正是这条闸门要防的那类事。
    if (MODULE_MISSING.has((error as { code?: string }).code ?? '')) return {};
    throw error;
  }
};
const load = (): Promise<BaselineModule> => loadFrom(MODULE_PATH);

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

/** 每条用例自己的临时目录，出目录即删。 */
const withTempDir = (run: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-baseline-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('同字节：三类漂移全空，且 isClean 认这个结果', async () => {
  const lib = await load();
  assert.equal(typeof lib.diffBaseline, 'function', '基线库缺 diffBaseline');
  assert.equal(typeof lib.isClean, 'function', '基线库缺 isClean');

  const files = { 'a.png': HASH_A, 'b.json': HASH_B };
  const diff = lib.diffBaseline!(files, { ...files });
  assert.deepEqual(diff, { changed: [], missing: [], unlisted: [] });
  assert.equal(lib.isClean!(diff), true);
});

test('改一个字节：只报 changed，且带记录值与实际值', async () => {
  const lib = await load();
  assert.equal(typeof lib.diffBaseline, 'function', '基线库缺 diffBaseline');

  const diff = lib.diffBaseline!({ 'a.png': HASH_A, 'b.png': HASH_B }, { 'a.png': HASH_C, 'b.png': HASH_B });
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].name, 'a.png');
  assert.equal(diff.changed[0].recorded, HASH_A);
  assert.equal(diff.changed[0].actual, HASH_C);
  assert.equal(diff.missing.length, 0);
  assert.equal(diff.unlisted.length, 0);
  assert.equal(lib.isClean!(diff), false);
});

test('记录有、磁盘没有＝missing；磁盘有、记录没有＝unlisted，两类不合并', async () => {
  const lib = await load();
  assert.equal(typeof lib.diffBaseline, 'function', '基线库缺 diffBaseline');

  const diff = lib.diffBaseline!({ 'gone.png': HASH_A, 'keep.png': HASH_B }, { 'keep.png': HASH_B, 'new.png': HASH_C });
  assert.deepEqual(diff.missing, ['gone.png']);
  assert.deepEqual(diff.unlisted, ['new.png']);
  assert.equal(diff.changed.length, 0);
  // 「记过但没了」与「在但没记过」是两种不同的错，合成一句「不一致」等于没说。
  assert.equal(lib.isClean!(diff), false);
});

test('排序与确定性：输入顺序不同，序列化逐字节相同', async () => {
  const lib = await load();
  assert.equal(typeof lib.serializeManifest, 'function', '基线库缺 serializeManifest');

  const one = lib.serializeManifest!({ 'b.png': HASH_B, 'a.png': HASH_A });
  const two = lib.serializeManifest!({ 'a.png': HASH_A, 'b.png': HASH_B });
  assert.equal(one, two);
  assert.ok(one.endsWith('\n'), '序列化必须以换行收尾');
  // serializeManifest 一定写出 `files`，所以不再留 `files === undefined ? [] :` 那种死分支——
  // 它只会让后来人以为「没有 files」也是一种合法形状。
  assert.deepEqual(Object.keys((JSON.parse(one) as { files: Record<string, string> }).files), [
    'a.png',
    'b.png',
  ]);
});

test('解析：往返一致；版本不符 / 指纹不是 64 位 / 非 JSON 都抛', async () => {
  const lib = await load();
  assert.equal(typeof lib.parseManifest, 'function', '基线库缺 parseManifest');
  assert.equal(typeof lib.serializeManifest, 'function', '基线库缺 serializeManifest');

  const text = lib.serializeManifest!({ 'a.png': HASH_A });
  const parsed = lib.parseManifest!(text);
  assert.deepEqual(parsed.files, { 'a.png': HASH_A });

  const version = lib.MANIFEST_VERSION;
  assert.equal(typeof version, 'number', '基线库缺 MANIFEST_VERSION');
  assert.throws(() => lib.parseManifest!(JSON.stringify({ version: version! + 1, files: {} })), /版本/);
  assert.throws(() => lib.parseManifest!(JSON.stringify({ version, files: { 'a.png': 'abc' } })), /64/);
  assert.throws(() => lib.parseManifest!('not json'), /JSON/);
});

test('记录不记自己：namesFromTracked 排掉 manifest 与目录外的路径', async () => {
  const lib = await load();
  assert.equal(typeof lib.namesFromTracked, 'function', '基线库缺 namesFromTracked');
  assert.equal(typeof lib.MANIFEST_NAME, 'string', '基线库缺 MANIFEST_NAME');

  const clientRoot = resolve(process.cwd(), 'fake-client');
  const dir = resolve(clientRoot, 'eval', 'screens');
  const names = lib.namesFromTracked!(
    [
      'eval/screens/a.png',
      'eval/screens/.baseline-manifest.json',
      'eval/live/b.png',
      'src/c.ts',
    ],
    dir,
    { clientRoot, manifestName: lib.MANIFEST_NAME! },
  );
  assert.deepEqual(names, ['a.png']);
});

test('指纹：collectHashes 只收存在的文件，hashBuffer 对同一字节稳定', async () => {
  const lib = await load();
  assert.equal(typeof lib.collectHashes, 'function', '基线库缺 collectHashes');
  assert.equal(typeof lib.hashBuffer, 'function', '基线库缺 hashBuffer');

  withTempDir((dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.png'), Buffer.from([1, 2, 3]));
    const hashes = lib.collectHashes!(dir, ['a.png', 'missing.png']);
    assert.deepEqual(Object.keys(hashes), ['a.png']);
    assert.equal(hashes['a.png'], lib.hashBuffer!(Buffer.from([1, 2, 3])));
    assert.notEqual(hashes['a.png'], lib.hashBuffer!(Buffer.from([1, 2, 4])));
  });
});

test('端到端：目录里改一个字节，diff 能定位到那一个文件', async () => {
  const lib = await load();
  assert.equal(typeof lib.collectHashes, 'function', '基线库缺 collectHashes');
  assert.equal(typeof lib.diffBaseline, 'function', '基线库缺 diffBaseline');

  withTempDir((dir) => {
    writeFileSync(join(dir, 'shot.png'), Buffer.from([9, 9, 9]));
    const recorded = lib.collectHashes!(dir, ['shot.png']);
    writeFileSync(join(dir, 'shot.png'), Buffer.from([9, 9, 8]));
    const diff = lib.diffBaseline!(recorded, lib.collectHashes!(dir, ['shot.png']));
    assert.deepEqual(diff.changed.map((item) => item.name), ['shot.png']);
  });
});

test('指纹跨平台：文本 CRLF 与 LF 同值，二进制不归一', async () => {
  const lib = await load();
  assert.equal(typeof lib.fingerprintBytes, 'function', '基线库缺 fingerprintBytes');

  const lf = Buffer.from('{\n  "a": 1\n}\n', 'latin1');
  const crlf = Buffer.from('{\r\n  "a": 1\r\n}\r\n', 'latin1');
  // Windows 工作区给 CRLF、Linux runner 给 LF；同一份入库字节必须同指纹。
  assert.equal(lib.fingerprintBytes!(crlf), lib.fingerprintBytes!(lf));

  // 二进制按原字节：PNG 里出现 `\r\n` 是巧合，不是行尾，归一会把指纹算错。
  const bin = Buffer.from([0x89, 0x50, 0x0d, 0x0a, 0x1a, 0x00, 0x0d, 0x0a]);
  assert.equal(lib.fingerprintBytes!(bin), lib.hashBuffer!(bin));
  assert.notEqual(lib.fingerprintBytes!(bin), lib.fingerprintBytes!(Buffer.from([0x89, 0x50, 0x0a, 0x1a, 0x00, 0x0a])));

  // 文本真的变了，归一之后仍然不同。
  assert.notEqual(
    lib.fingerprintBytes!(Buffer.from('{"a":1}\n', 'latin1')),
    lib.fingerprintBytes!(Buffer.from('{"a":2}\n', 'latin1')),
  );
});

test('渲染：超过 limit 的条数必须报「另有 N 个」，且 N 按实际少打的算', async () => {
  const lib = await load();
  assert.equal(typeof lib.diffLines, 'function', '基线库缺 diffLines');

  // 25 个 changed、另两类为 0：旧写法「总数 − 3×limit」会算出 −35，一句「另有」都没有。
  const changed = Array.from({ length: 25 }, (_, i) => ({
    name: `f${String(i).padStart(2, '0')}.png`,
    recorded: 'a'.repeat(64),
    actual: 'b'.repeat(64),
  }));
  const lines = lib.diffLines!({ changed, missing: [], unlisted: [] });
  assert.equal(lines.length, 21, `期望 20 条明细 + 1 条汇总，实际 ${lines.length}`);
  assert.match(lines[20], /另有 5 个/);

  // 三类都刚好到 limit：不应出现「另有」。
  const full = Array.from({ length: 20 }, (_, i) => ({
    name: `g${i}.png`,
    recorded: 'a'.repeat(64),
    actual: 'b'.repeat(64),
  }));
  const exact = lib.diffLines!({ changed: full, missing: [], unlisted: [] });
  assert.equal(exact.length, 20);
  assert.ok(!exact.some((line) => line.includes('另有')));

  // 干净：一行都没有（调用方据 isClean 判通过，不靠「没输出」）。
  assert.deepEqual(lib.diffLines!({ changed: [], missing: [], unlisted: [] }), []);

  // 标签与备注可换：update 用 removed/added，verify 用 missing/unlisted 加括号说明。
  const one = { changed: [], missing: ['m.png'], unlisted: ['u.png'] };
  const removed = lib.diffLines!(one, { labels: { missing: 'removed', unlisted: 'added' } });
  assert.match(removed[0], /removed\s+m\.png/);
  assert.match(removed[1], /added\s+u\.png/);
  const noted = lib.diffLines!(one, { notes: { missing: '（记录里有、磁盘上没有）' } });
  assert.match(noted[0], /m\.png（记录里有、磁盘上没有）/);
});

test('加载器只吞「文件不在」：模块里的语法错必须原样抛出去', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-baseline-load-'));
  try {
    // 「文件不在」→ 空模块，交给每条用例自己的第一句断言去红在断言上（red-first 需要）。
    assert.deepEqual(await loadFrom(pathToFileURL(join(dir, 'nope.mjs')).href), {});

    // 语法错 → 必须冒出来。吞掉它就等于把「模块写坏了」报成「缺 diffBaseline」，
    // 读的人会去补函数，而真正的问题在别处。
    const broken = join(dir, 'broken.mjs');
    writeFileSync(broken, 'export const = ;\n', 'utf8');
    await assert.rejects(loadFrom(pathToFileURL(broken).href));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
