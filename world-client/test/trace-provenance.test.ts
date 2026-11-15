/** commit 锚的组件口径：录制必须带 40 位 HEAD；回放只提示、不判红。
 *
 * 反向用例在 CLI 侧跑（假值 / 删字段 / 新录一条），这里锁纯函数与录制出口。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { recordTrace, runTrace } from '../src/trace/replay.ts';
import type { TraceInput } from '../src/trace/format.ts';

/**
 * `provenance.ts` 是本次新增的：red-first 把 test/ 的 diff 套到 base 时它不存在。
 * 先判文件在不在，**根本不发起 import**——动态 import 的解析失败即使 catch 住，
 * 也会被打进输出判成 ERROR。缺了就让断言红，而不是让模块加载崩。
 */
const PROVENANCE_URL = new URL('../src/trace/provenance.ts', import.meta.url);
const provenance: Record<string, unknown> = existsSync(PROVENANCE_URL)
  ? ((await import(PROVENANCE_URL.href)) as Record<string, unknown>)
  : {};
const commitAnchorLine = provenance['commitAnchorLine'] as
  | ((...args: unknown[]) => string)
  | undefined;
const headCommit = provenance['headCommit'] as (() => string) | undefined;
const isCommitSha = provenance['isCommitSha'] as ((v?: string) => boolean) | undefined;
const commitsSince = provenance['commitsSince'] as ((sha: string) => number) | undefined;

function requireProvenance(): void {
  assert.equal(typeof commitAnchorLine, 'function', 'provenance 还没落地——red-first 的红灯');
  assert.equal(typeof headCommit, 'function', 'provenance 还没落地——red-first 的红灯');
  assert.equal(typeof isCommitSha, 'function', 'provenance 还没落地——red-first 的红灯');
  assert.equal(typeof commitsSince, 'function', 'provenance 还没落地——red-first 的红灯');
}

const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);

test('isCommitSha 只认 40 位小写十六进制', () => {
  requireProvenance();
  assert.equal(isCommitSha!(HEAD), true);
  assert.equal(isCommitSha!('A'.repeat(40)), false);
  assert.equal(isCommitSha!('a'.repeat(39)), false);
  assert.equal(isCommitSha!('a'.repeat(41)), false);
  assert.equal(isCommitSha!(undefined), false);
});

test('无字段：旧格式提示「录制 commit 不可考」，不判红', () => {
  requireProvenance();
  const line = commitAnchorLine!(undefined, HEAD, null);
  assert.match(line, /注意：录制 commit 不可考/);
  assert.match(line, /旧格式，重录才会获得/);
  assert.match(line, /不判红/);
  assert.match(line, new RegExp(HEAD.slice(0, 7)));
});

test('一致：只说锚在哪，不出现「注意」', () => {
  requireProvenance();
  const line = commitAnchorLine!(HEAD, HEAD, 0);
  assert.match(line, /录制于 bbbbbbb（与当前 HEAD 相同）/);
  assert.doesNotMatch(line, /注意/);
});

test('不一致：打印两边 SHA 与提交距离，但仍写明不判红', () => {
  requireProvenance();
  const line = commitAnchorLine!(OLD, HEAD, 12);
  assert.match(line, /录制于 aaaaaaa/);
  assert.match(line, /当前 HEAD bbbbbbb/);
  assert.match(line, /相差 12 个提交/);
  assert.match(line, /不判红/);
});

test('录制 commit 不在当前历史里：说明可能是未提交中间态', () => {
  requireProvenance();
  const line = commitAnchorLine!('0'.repeat(40), HEAD, null);
  assert.match(line, /不在当前历史里/);
  assert.match(line, /未提交中间态/);
  assert.match(line, /不判红/);
});

test('浅克隆里间隔算不出来：降级为浅克隆提示，不判红', () => {
  requireProvenance();
  const line = commitAnchorLine!(OLD, HEAD, null, true);
  assert.match(line, /无法计算间隔：浅克隆/);
  assert.doesNotMatch(line, /未提交中间态/);
  assert.match(line, /不判红/);
});

test('当前仓库能读到 40 位 HEAD，且距离自己为 0', () => {
  requireProvenance();
  const head = headCommit!();
  assert.ok(head !== null, '测试必须在 git 仓库里跑');
  assert.equal(isCommitSha!(head), true);
  assert.equal(commitsSince!(head), 0);
});

test('新录制一定带 recordedAtCommit（40 位），且与 recorded 并排', async () => {
  requireProvenance();
  // 不落盘：临时夹具只在内存里录一条，避免污染 fixtures/。
  const input: TraceInput = {
    format: 'pwe-trace/1',
    traceVersion: 1,
    description: 'commit 锚临时录制（测试内，不写文件）',
    worldId: 'default',
    worldSeed: 'commit-anchor-probe',
    initialNow: 0,
    stepMs: 1_000,
    steps: 1,
    eventRange: { from: 0, to: 0 },
    injections: [],
  };
  // main 后来收紧了 eventRange.to：声明超出实际事件数会显式报错。
  // 要拿「全部事件数」得走 openEventRange，而不是塞一个不可能达到的上界。
  const probe = await runTrace(input, { openEventRange: true });
  const recorded = await recordTrace({ ...input, eventRange: { from: 0, to: probe.events.length } });

  assert.equal(isCommitSha!(recorded.recordedAtCommit), true, '录制必须写 40 位 HEAD');
  assert.equal(recorded.recordedAtCommit, headCommit!(), '锚必须是录制时的 HEAD');
  assert.ok(recorded.recorded !== undefined, 'recorded 与 recordedAtCommit 是同级字段');
  // 锚不参与输入摘要：改掉它不会改 inputDigest。
  const digest = recorded.recorded.inputDigest;
  assert.equal(typeof digest, 'string');
  assert.equal(digest.length, 64);
});
