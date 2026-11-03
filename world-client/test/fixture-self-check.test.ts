/**
 * 夹具自检（静态，不回放）：格式合法、断言非空、没有引用不存在的存档。
 *
 * 真正的回放由 `npm run fixture:check` 负责；这条用例只保证「夹具文件本身
 * 说人话」——解析不了、少了元数据、断言为空、引用了不存在的基线，都先在这里红。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestOfInput, traceProblems } from '../src/trace/format.ts';
import { fixtureProblems } from '../src/trace/fixture.ts';
import type { FixtureFile } from '../src/trace/fixture.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = resolve(CLIENT_ROOT, 'fixtures');

function fixtureFiles(): string[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

test('夹具自检：5–8 条，文件名与 name 对得上，没有重名', () => {
  const files = fixtureFiles();
  assert.ok(files.length >= 5 && files.length <= 8, `夹具应为 5–8 条，实际 ${files.length}`);
  const names = files.map((file) => {
    const fixture = JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8')) as FixtureFile;
    assert.equal(fixture.name, file.replace(/\.json$/, ''), `${file} 的 name 与文件名不一致`);
    return fixture.name;
  });
  assert.equal(new Set(names).size, names.length, '夹具 name 不能重复');
});

test('夹具自检：每条格式合法、断言非空、有用途与覆盖说明', () => {
  for (const file of fixtureFiles()) {
    const fixture = JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8')) as unknown;
    assert.deepEqual(fixtureProblems(fixture), [], `${file} 的格式问题`);
    const typed = fixture as FixtureFile;
    assert.ok(typed.assertions.length > 0, `${file} 的断言不能为空`);
    assert.ok(typed.covers.length > 0, `${file} 必须写明覆盖了什么`);
    assert.ok(typed.doesNotCover.length > 0, `${file} 必须写明覆盖不到什么`);
    assert.ok(typed.expectedMs <= 3_000, `${file} 的 expectedMs 应在 3 秒预算内`);
    assert.equal(typed.trace.eventRange.from, 0, `${file} 必须从事件 0 起录`);
    assert.equal(
      typed.trace.eventRange.to,
      typed.trace.recorded.eventCount,
      `${file} 的 eventRange 应恰好覆盖 recorded.eventCount`,
    );
    assert.deepEqual(traceProblems(typed.trace), [], `${file} 的轨迹格式问题`);
    assert.equal(
      digestOfInput(typed.trace),
      typed.trace.recorded.inputDigest,
      `${file} 的 recorded.inputDigest 与输入不一致（夹具被改过）`,
    );
  }
});

test('夹具自检：baselinePath 不引用不存在的存档', () => {
  for (const file of fixtureFiles()) {
    const fixture = JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8')) as FixtureFile;
    if (fixture.baselinePath === undefined) continue;
    const full = resolve(CLIENT_ROOT, fixture.baselinePath);
    assert.ok(statSync(full).isFile(), `${file} 引用的基线不存在：${fixture.baselinePath}`);
    const save = JSON.parse(readFileSync(full, 'utf8')) as { schemaVersion?: number; world?: { now?: number } };
    assert.equal(save.schemaVersion, 5, `${file} 的基线必须是 v5 存档`);
    assert.equal(save.world?.now, fixture.trace.initialNow, `${file} 的 initialNow 必须等于基线 world.now`);
  }
});
