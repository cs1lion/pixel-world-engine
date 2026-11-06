#!/usr/bin/env node
/**
 * 只读：列出「attempt 1 失败、却被最新 attempt 的 success 掩盖」的 run。
 *
 * 为什么需要它：GitHub 的默认视图（网页的 run 页、`gh run list`、`gh run view`
 * 不带 `--attempt`）**只显示最新 attempt**。一次 `gh run rerun --failed`
 * 成功之后，attempt 1 的红就从默认视图里消失。review 时只看到 success，
 * 会漏掉「首跑其实红过」——本轮 CI 诊断里已经有 5 次是这么被掩盖的。
 *
 * 因此 review 时必须这样看首跑：
 *   gh run view <run-id> --attempt 1
 *
 * 这条命令是同一件事的批量入口，**只读、不进 CI**：
 *   node scripts/ci-attempt1-audit.mjs --since 2026-11-04
 *   node scripts/ci-attempt1-audit.mjs --since 2026-11-04 --workflow ci.yml --limit 60
 *
 * 只列 attempt > 1 的 run：只有「重跑过」的 run 才可能被掩盖；单 attempt
 * 的失败在默认视图里本来就看得见。
 *
 * 退出码：0（查到数据或没有数据都算成功）；gh 未安装/未登录/取数失败才非 0。
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const since = readArg('since', '2026-11-04');
const workflow = readArg('workflow', 'ci.yml');
const limit = readArg('limit', '60');

const gh = (argv) =>
  execFileSync('gh', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let repo;
try {
  repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
} catch (error) {
  console.error(`[错误] 读不到仓库名（gh 未安装 / 未登录？）：${error.message}`);
  process.exit(1);
}

let runs;
try {
  runs = JSON.parse(
    gh([
      'run',
      'list',
      '--workflow',
      workflow,
      '--created',
      `>=${since}`,
      '--limit',
      limit,
      '--json',
      'databaseId,headSha,headBranch,conclusion,createdAt,attempt,displayTitle,url',
    ]),
  );
} catch (error) {
  console.error(`[错误] 拉 run 列表失败：${error.message}`);
  process.exit(1);
}

const rerun = runs.filter((run) => (run.attempt ?? 1) > 1);
console.log(`repo=${repo} workflow=${workflow} since=${since} limit=${limit}`);
console.log(`run 总数 ${runs.length}，其中重跑过 ${rerun.length} 条`);

const masked = [];
for (const run of rerun) {
  let first;
  try {
    first = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${run.databaseId}/attempts/1`]));
  } catch (error) {
    console.error(`[日志不可用] run ${run.databaseId} 读 attempt 1 失败：${error.message}`);
    continue;
  }
  if (first.conclusion === 'success') continue;
  masked.push({
    id: run.databaseId,
    attempt1: first.conclusion ?? first.status ?? 'unknown',
    final: run.conclusion ?? 'unknown',
    branch: run.headBranch,
    sha: run.headSha,
    createdAt: run.createdAt,
    url: run.url,
  });
}

console.log(`\n被最新 attempt 掩盖的 attempt 1 失败：${masked.length} 条`);
if (masked.length === 0) {
  console.log('（时间窗内没有「首跑失败 + 重跑成功」的 run）');
} else {
  console.log('run           attempt1   最终       分支             headSha         创建时间');
  for (const item of masked) {
    console.log(
      `${item.id}  ${item.attempt1.padEnd(10)} ${item.final.padEnd(10)} `
        + `${(item.branch ?? '').padEnd(16)} ${(item.sha ?? '').slice(0, 8)}  ${item.createdAt}`,
    );
  }
  console.log('\n逐条看首跑日志：');
  for (const item of masked) console.log(`  gh run view ${item.id} --attempt 1`);
}
