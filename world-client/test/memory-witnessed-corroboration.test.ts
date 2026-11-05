import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 不变量：90 天快照里，每条 `witnessed` 记忆的**未解析 eventRef**，至少还有一条
 * `claims` / `beliefs` / `legends` 引用它。
 *
 * 这条守的是「旁证被裁」风险：事实层按预算淘汰后，亲历条目仍自称 witnessed；
 * 如果连最后的旁证也一起没了，它就变成一条没人能对账的孤证。这里只**断言**，
 * 不改 `trimRecords`、不改保留集合、不动任何字节读数。
 *
 * 另附**只记录、不进断言**的分桶统计：每个未解析 eventRef 被旁证引用了 0 / 1 / ≥2 次，
 * 落到 docs/evidence/soak/witnessed-corroboration.json，并在 CI 日志里直接打出来。
 * 分桶不是闸门——详见 docs/evidence/soak/REPORT.md 对应小节。
 */
const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');

interface SaveShape {
  readonly world?: { readonly memory?: string };
}

interface Snapshot {
  readonly world?: {
    readonly entries?: readonly { memoryId?: string; sourceMode?: string; eventRefs?: readonly string[] }[];
    readonly facts?: readonly { eventId?: string }[];
    readonly claims?: readonly { eventRefs?: readonly string[] }[];
    readonly beliefs?: readonly { eventRefs?: readonly string[] }[];
    readonly legends?: readonly { eventRefs?: readonly string[] }[];
  };
}

function resolveSave(): string | null {
  const candidates = [
    process.env.PWE_SOAK === undefined ? null : resolve(process.env.PWE_SOAK, 'docs/evidence/soak/soak-a/save-90d.json'),
    resolve(repoRoot, 'docs/evidence/soak/soak-a/save-90d.json'),
    resolve(repoRoot, '../pwe-soak/docs/evidence/soak/soak-a/save-90d.json'),
  ].filter((path): path is string => path !== null);
  return candidates.find((path) => existsSync(path)) ?? null;
}

test('90 天快照：witnessed 条目的未解析 eventRef 仍有 claims/beliefs/legends 旁证', () => {
  const savePath = resolveSave();
  assert.ok(savePath !== null, '找不到 90 天快照：docs/evidence/soak/soak-a/save-90d.json');

  const save = JSON.parse(readFileSync(savePath, 'utf8')) as SaveShape;
  assert.equal(typeof save.world?.memory, 'string', '存档里没有 world.memory 快照');
  const snapshot = (JSON.parse(save.world!.memory!) as { world?: Snapshot['world'] }).world;
  assert.ok(snapshot !== undefined, '快照里没有 world');

  const facts = new Set((snapshot.facts ?? []).map((fact) => fact.eventId));
  const corroborated = new Set<string>();
  const referenceCounts = new Map<string, number>();
  for (const bucket of [snapshot.claims, snapshot.beliefs, snapshot.legends]) {
    for (const record of bucket ?? []) {
      for (const ref of record.eventRefs ?? []) {
        corroborated.add(ref);
        referenceCounts.set(ref, (referenceCounts.get(ref) ?? 0) + 1);
      }
    }
  }

  const witnessed = (snapshot.entries ?? []).filter((entry) => entry.sourceMode === 'witnessed');
  assert.ok(witnessed.length > 0, '快照里没有任何 witnessed 条目，断言会变成空转');

  const violations: string[] = [];
  /** 只记录、不进断言：每个未解析 eventRef 被 claims/beliefs/legends 引用了几次。 */
  const unresolved: { memoryId: string; eventRef: string; references: number }[] = [];
  for (const entry of witnessed) {
    for (const ref of entry.eventRefs ?? []) {
      if (facts.has(ref)) continue;
      const references = referenceCounts.get(ref) ?? 0;
      unresolved.push({ memoryId: entry.memoryId ?? '(无 id)', eventRef: ref, references });
      if (!corroborated.has(ref)) violations.push(`${entry.memoryId ?? '(无 id)'} → ${ref}`);
    }
  }

  const noCorroboration = unresolved.filter((item) => item.references === 0).length;
  const singleCorroboration = unresolved.filter((item) => item.references === 1).length;
  const multiCorroboration = unresolved.filter((item) => item.references >= 2).length;

  console.log(
    `witnessed=${witnessed.length} 未解析eventRef=${unresolved.length} 无旁证=${violations.length}`
      + `（${savePath}）`,
  );
  console.log(
    `旁证分桶（只记录、不进断言）：0 条=${noCorroboration} / 1 条=${singleCorroboration}`
      + ` / ≥2 条=${multiCorroboration}`,
  );

  // 落盘：无时间戳、键名与条目顺序固定，便于逐字节比对。
  const outPath = resolve(repoRoot, 'docs/evidence/soak/witnessed-corroboration.json');
  const sorted = [...unresolved].sort(
    (a, b) => a.memoryId.localeCompare(b.memoryId) || a.eventRef.localeCompare(b.eventRef),
  );
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        source: 'docs/evidence/soak/soak-a/save-90d.json',
        witnessedEntries: witnessed.length,
        unresolvedEventRefs: unresolved.length,
        buckets: {
          refsWithoutCorroboration: noCorroboration,
          refsWithSingleCorroboration: singleCorroboration,
          refsWithMultipleCorroboration: multiCorroboration,
        },
        refs: sorted,
      },
      null,
      2,
    )}\n`,
  );

  assert.equal(
    violations.length,
    0,
    `以下 witnessed 条目的未解析 eventRef 没有任何 claims/beliefs/legends 旁证：\n${violations.slice(0, 30).join('\n')}`,
  );
});
