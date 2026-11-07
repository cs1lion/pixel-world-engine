/** commit 锚的组件口径：录制必须带 40 位 HEAD；回放只提示、不判红。
 *
 * 反向用例在 CLI 侧跑（假值 / 删字段 / 新录一条），这里锁纯函数与录制出口。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordTrace, runTrace } from '../src/trace/replay.ts';
import type { TraceInput } from '../src/trace/format.ts';
import {
  commitAnchorLine,
  headCommit,
  isCommitSha,
  commitsSince,
} from '../src/trace/provenance.ts';

const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);

test('isCommitSha 只认 40 位小写十六进制', () => {
  assert.equal(isCommitSha(HEAD), true);
  assert.equal(isCommitSha('A'.repeat(40)), false);
  assert.equal(isCommitSha('a'.repeat(39)), false);
  assert.equal(isCommitSha('a'.repeat(41)), false);
  assert.equal(isCommitSha(undefined), false);
});

test('无字段：旧格式提示「录制 commit 不可考」，不判红', () => {
  const line = commitAnchorLine(undefined, HEAD, null);
  assert.match(line, /注意：录制 commit 不可考/);
  assert.match(line, /旧格式，重录才会获得/);
  assert.match(line, /不判红/);
  assert.match(line, new RegExp(HEAD.slice(0, 7)));
});

test('一致：只说锚在哪，不出现「注意」', () => {
  const line = commitAnchorLine(HEAD, HEAD, 0);
  assert.match(line, /录制于 bbbbbbb（与当前 HEAD 相同）/);
  assert.doesNotMatch(line, /注意/);
});

test('不一致：打印两边 SHA 与提交距离，但仍写明不判红', () => {
  const line = commitAnchorLine(OLD, HEAD, 12);
  assert.match(line, /录制于 aaaaaaa/);
  assert.match(line, /当前 HEAD bbbbbbb/);
  assert.match(line, /相差 12 个提交/);
  assert.match(line, /不判红/);
});

test('录制 commit 不在当前历史里：说明可能是未提交中间态', () => {
  const line = commitAnchorLine('0'.repeat(40), HEAD, null);
  assert.match(line, /不在当前历史里/);
  assert.match(line, /未提交中间态/);
  assert.match(line, /不判红/);
});

test('浅克隆里间隔算不出来：降级为浅克隆提示，不判红', () => {
  const line = commitAnchorLine(OLD, HEAD, null, true);
  assert.match(line, /无法计算间隔：浅克隆/);
  assert.doesNotMatch(line, /未提交中间态/);
  assert.match(line, /不判红/);
});

test('当前仓库能读到 40 位 HEAD，且距离自己为 0', () => {
  const head = headCommit();
  assert.ok(head !== null, '测试必须在 git 仓库里跑');
  assert.equal(isCommitSha(head), true);
  assert.equal(commitsSince(head), 0);
});

test('新录制一定带 recordedAtCommit（40 位），且与 recorded 并排', async () => {
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
  const probe = await runTrace({ ...input, eventRange: { from: 0, to: Number.MAX_SAFE_INTEGER } });
  const recorded = await recordTrace({ ...input, eventRange: { from: 0, to: probe.events.length } });

  assert.equal(isCommitSha(recorded.recordedAtCommit), true, '录制必须写 40 位 HEAD');
  assert.equal(recorded.recordedAtCommit, headCommit(), '锚必须是录制时的 HEAD');
  assert.ok(recorded.recorded !== undefined, 'recorded 与 recordedAtCommit 是同级字段');
  // 锚不参与输入摘要：改掉它不会改 inputDigest。
  const digest = recorded.recorded.inputDigest;
  assert.equal(typeof digest, 'string');
  assert.equal(digest.length, 64);
});
