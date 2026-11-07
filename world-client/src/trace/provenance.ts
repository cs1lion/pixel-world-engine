/** 夹具的 commit 锚：把「这份期望值是哪版代码录的」钉在文件里。
 *
 * 事故形状：账本封的 `timetable-daily-markers.json` 是 8934 字节的**未提交中间态**，
 * git 历史里从未存在过这个版本；后来 9010 字节才随 `fbd021b2` 落地。`recorded`
 * 说得清「录了什么内容」，说不清「对应哪版代码」。所以录制时多写一个 HEAD。
 *
 * **不一致不判红**：commit 不同只说明夹具比代码旧（或代码比夹具旧），本身不是
 * 缺陷。判红会逼得每次无关提交都重录夹具，人就会绕过闸门——那比没有锚更糟。
 * 回放只把它打成一行显著提示，退出码不动。
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** `world-client/src/trace` → 仓库根。`git` 在子目录也能跑，但固定根目录更稳。 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** 40 位小写十六进制，够区分「手填的假值」和真 SHA。 */
export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA.test(value);
}

/** 当前 HEAD；不在 git 仓库或 git 不可用时返回 null（回放侧只提示，不判红）。 */
export function headCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** 录制 commit 到 HEAD 之间有多少个提交；commit 不在当前历史里时返回 null。 */
export function commitsSince(commit: string): number | null {
  if (!isCommitSha(commit)) return null;
  try {
    const text = execFileSync('git', ['rev-list', '--count', `${commit}..HEAD`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const count = Number(text);
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/** 短 SHA：报错信息里够用，也照旧文档的示例。 */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * 纯格式化，便于单测。`head`/`distance` 由调用方注入；真实入口用
 * `currentCommitAnchorLine`。
 */
export function commitAnchorLine(
  recordedAtCommit: string | undefined,
  head: string | null,
  distance: number | null,
): string {
  if (recordedAtCommit === undefined || recordedAtCommit === '') {
    return head === null
      ? '注意：该夹具无 commit 锚（旧格式）；当前 HEAD 不可读（不判红）'
      : `注意：该夹具无 commit 锚（旧格式）；当前 HEAD ${short(head)}（不判红）`;
  }
  if (head === null) {
    return `注意：夹具录制于 ${short(recordedAtCommit)}，当前 HEAD 不可读（不判红）`;
  }
  if (recordedAtCommit === head) {
    return `commit 锚：录制于 ${short(head)}（与当前 HEAD 相同）`;
  }
  const tail = distance === null
    ? '（录制 commit 不在当前历史里，可能是未提交中间态或已改写）'
    : `，相差 ${distance} 个提交`;
  return `注意：夹具录制于 ${short(recordedAtCommit)}，当前 HEAD ${short(head)}${tail}（不判红）`;
}

/** 真实入口：读 HEAD 与提交距离，返回一行提示。 */
export function currentCommitAnchorLine(recordedAtCommit: string | undefined): string {
  const head = headCommit();
  const distance = recordedAtCommit === undefined ? null : commitsSince(recordedAtCommit);
  return commitAnchorLine(recordedAtCommit, head, distance);
}
