import type { HistoryDoc } from './patch.ts';
import type { CounterfactualTrajectoryDiff } from './trajectory-recorder.ts';
import {
  WorldlineTree,
  type ForkResult,
  type InterventionStamp,
  type TurnpointBadge,
  type WorldlineDayMetrics,
  type WorldlineDayRecord,
  type WorldlineTreeOptions,
  type WorldlineTreeSummary,
} from './worldline-tree.ts';

export interface WorldlineSwitchSnapshotResult {
  readonly ok: boolean;
  readonly branchId: string;
  readonly previousBranchId: string;
  readonly latestDay: number | null;
  readonly doc: HistoryDoc | null;
}

function cloneDoc(doc: HistoryDoc): HistoryDoc {
  return JSON.parse(JSON.stringify(doc)) as HistoryDoc;
}

export class WorldlineSession {
  private readonly tree: WorldlineTree;
  private readonly snapshotsByBranch = new Map<string, Map<number, HistoryDoc>>();

  constructor(options: WorldlineTreeOptions = {}) {
    this.tree = new WorldlineTree(options);
    this.snapshotsByBranch.set(this.tree.getActiveBranchId(), new Map<number, HistoryDoc>());
  }

  public getActiveBranchId(): string {
    return this.tree.getActiveBranchId();
  }

  public getTreeSummary(): WorldlineTreeSummary {
    return this.tree.getTreeSummary();
  }

  public getDayTurnpoints(day: number, branchId: string = this.tree.getActiveBranchId()): readonly TurnpointBadge[] {
    const rec = this.tree.getDayRecord(branchId, day);
    return rec ? rec.turnpoints : [];
  }

  public getParityDay(branchId: string): number | null {
    return this.tree.getParityDay(branchId);
  }

  public recordDay(
    day: number,
    metrics: WorldlineDayMetrics,
    stateFingerprint: string,
    doc: HistoryDoc,
  ): WorldlineDayRecord {
    const record = this.tree.recordDay(day, metrics, stateFingerprint);
    const branchId = this.tree.getActiveBranchId();
    let bucket = this.snapshotsByBranch.get(branchId);
    if (!bucket) {
      bucket = new Map<number, HistoryDoc>();
      this.snapshotsByBranch.set(branchId, bucket);
    }
    bucket.set(day, cloneDoc(doc));
    return record;
  }

  public forkAt(targetDay: number, fromDay: number): ForkResult {
    const result = this.tree.forkAt(targetDay, fromDay);
    const parentBucket = this.snapshotsByBranch.get(result.parentBranchId);
    const childBucket = new Map<number, HistoryDoc>();
    if (parentBucket) {
      for (const [day, doc] of parentBucket.entries()) {
        if (day <= targetDay) {
          childBucket.set(day, cloneDoc(doc));
        }
      }
    }
    this.snapshotsByBranch.set(result.branchId, childBucket);
    if (result.evictedBranchId !== null) {
      this.snapshotsByBranch.delete(result.evictedBranchId);
    }
    return result;
  }

  public recordIntervention(stamp: InterventionStamp): boolean {
    return this.tree.recordIntervention(stamp);
  }

  public switchBranch(branchId: string): WorldlineSwitchSnapshotResult {
    const res = this.tree.switchBranch(branchId);
    if (!res.ok) {
      return {
        ok: false,
        branchId: res.branchId,
        previousBranchId: res.previousBranchId,
        latestDay: res.latestDay,
        doc: null,
      };
    }
    const bucket = this.snapshotsByBranch.get(res.branchId);
    const rawDoc = res.latestDay !== null ? bucket?.get(res.latestDay) ?? null : null;
    return {
      ok: true,
      branchId: res.branchId,
      previousBranchId: res.previousBranchId,
      latestDay: res.latestDay,
      doc: rawDoc ? cloneDoc(rawDoc) : null,
    };
  }

  public compareWithParent(branchId: string, day?: number): CounterfactualTrajectoryDiff | null {
    const summary = this.tree.getTreeSummary();
    const branch = summary.branches.find((b) => b.branchId === branchId);
    if (!branch || branch.parentBranchId === null) return null;
    const targetDay = day ?? this.tree.getParityDay(branchId);
    if (targetDay === null) return null;
    const parentRec = this.tree.getDayRecord(branch.parentBranchId, targetDay);
    const branchRec = this.tree.getDayRecord(branchId, targetDay);
    if (!parentRec || !branchRec) return null;
    return {
      day: targetDay,
      branchA: branch.parentBranchId,
      branchB: branchId,
      fingerprintA: parentRec.stateFingerprint,
      fingerprintB: branchRec.stateFingerprint,
      fingerprintChanged: parentRec.stateFingerprint !== branchRec.stateFingerprint,
      deltaBuildings: branchRec.metrics.buildingsCount - parentRec.metrics.buildingsCount,
      deltaRoads: branchRec.metrics.roadsCount - parentRec.metrics.roadsCount,
      deltaBeliefs: branchRec.metrics.beliefsCount - parentRec.metrics.beliefsCount,
      deltaFacts: branchRec.metrics.factsCount - parentRec.metrics.factsCount,
    };
  }
}
