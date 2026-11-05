/**
 * 核对 `eval/fixtures/eval-soak-day-facts.json` 里声明的 save/summary 哈希。
 *
 * 只说三件事：`verified`（实算等于声明）、`mismatch`（实算不等于声明）、
 * `unverified`（文件不在本机，**不可判**——不是绿）。
 * 哈希口径与账本一致：内容先做 CRLF → LF 归一化，再算 sha256。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sha256OfFile } from './eval-ledger-lib.ts';

export type HashStatus = 'verified' | 'mismatch' | 'unverified';

export interface FixtureHashCheck {
  readonly name: 'save' | 'summary';
  readonly file: string;
  readonly declared: string;
  readonly actual: string | null;
  readonly status: HashStatus;
}

export interface FixtureHashReport {
  readonly ok: boolean;
  readonly status: HashStatus;
  readonly root: string | null;
  readonly note?: string;
  readonly checks: readonly FixtureHashCheck[];
}

interface FixtureProvenance {
  readonly saveFile: string;
  readonly saveSha256: string;
  readonly summaryFile: string;
  readonly summarySha256: string;
}

const FIXTURE = 'eval/fixtures/eval-soak-day-facts.json';

export function verifyFixtureHashes(
  worldClientRoot: string,
  repoRoot: string,
  externalRoot?: string,
): FixtureHashReport {
  const provenance = (JSON.parse(readFileSync(resolve(worldClientRoot, FIXTURE), 'utf8')) as {
    provenance: FixtureProvenance;
  }).provenance;

  const candidates = [repoRoot, externalRoot ?? resolve(repoRoot, '..', 'pwe-soak')];
  const root = candidates.find(
    (candidate) =>
      existsSync(resolve(candidate, provenance.saveFile)) &&
      existsSync(resolve(candidate, provenance.summaryFile)),
  ) ?? null;

  const pairs = [
    { name: 'save' as const, file: provenance.saveFile, declared: provenance.saveSha256 },
    { name: 'summary' as const, file: provenance.summaryFile, declared: provenance.summarySha256 },
  ];

  if (root === null) {
    return {
      ok: false,
      status: 'unverified',
      root: null,
      note: '外部证据树与仓内副本都不在本机：哈希不可判，不许当绿',
      checks: pairs.map((pair) => ({ ...pair, actual: null, status: 'unverified' as const })),
    };
  }

  const checks: FixtureHashCheck[] = pairs.map((pair) => {
    const actual = sha256OfFile(resolve(root, pair.file));
    return {
      ...pair,
      actual,
      status: actual === pair.declared ? 'verified' : 'mismatch',
    };
  });
  const status: HashStatus = checks.every((check) => check.status === 'verified') ? 'verified' : 'mismatch';
  return { ok: status === 'verified', status, root, checks };
}
