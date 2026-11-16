/**
 * Trajectory 因果分叉账本（世界时间回溯 + Trajectory 因果分叉可观测）。
 *
 * 把「单线历史」升级为**可观测的因果分叉树（Trajectory Lineage DAG）**：
 * 1. 日结轨迹锚点（`TrajectoryCheckpoint`）：每当 `SceneHistory.capture(day, doc)` 关账时，
 *    自动计算确定性状态指纹 `stateFingerprint`（覆盖坐标、建筑、道路与记忆快照）与业务向量
 *    `metrics`（建筑 / 道路 / 信念 / 事实 / 天气），记入当前活跃分支 `activeBranchId`。
 * 2. 回溯保真度自证（`RewindFidelityProof`）：执行 `restoreSave(day, fromDay)` 时，比对「通过
 *    base + patches 还原出的 `WorldSave` 指纹」与「当年第 `day` 日结时记录的原始 `stateFingerprint`」。
 *    若 `fidelityMatch !== true`，立即抛出可观测告警——杜绝静默状态漂移。
 * 3. 影子轨迹归档与反事实对比（`CounterfactualTrajectoryDiff`）：回溯不抹除原时间线的观测记录，
 *    而是将 `(targetDay, fromDay]` 归档为影子轨迹段（`archivedBranch`），并开启新分支 `branch-{k}`。
 *    新分支再次推进到第 `X` 天时，`compareBranches(oldBranchId, newBranchId, X)` 输出同一天在新旧两
 *    时间线上的**反事实差异**（Δ建筑 / Δ道路 / Δ信念 / Δ事实与指纹分叉点）。
 *
 * 纪律：全模块零 `Math.random()`、零 `Date.now()`，所有指纹与差分 100% 确定性。
 */

import type { HistoryDoc } from './patch.ts';
import { computeDeterministicFingerprint } from './fingerprint.ts';

type MetricsWorld = Record<string, unknown>;
type MetricsWorldWithCounts =
  MetricsWorld & { readonly buildingsCount?: number; readonly roadsCount?: number; readonly buildings?: readonly unknown[]; readonly roads?: readonly unknown[] };
type MetricsMemoryWorld =
  MetricsWorld & { readonly world?: { readonly beliefs?: readonly unknown[]; readonly facts?: readonly unknown[] } };

export interface TrajectoryMetrics {
  readonly buildingsCount: number;
  readonly roadsCount: number;
  readonly beliefsCount: number;
  readonly factsCount: number;
  readonly weather: string;
}

export interface TrajectoryNode {
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly day: number;
  readonly stateFingerprint: string;
  readonly metrics: TrajectoryMetrics;
}

export interface RewindFidelityProof {
  readonly targetDay: number;
  readonly expectedFingerprint: string | null;
  readonly restoredFingerprint: string;
  readonly fidelityMatch: boolean;
}

export interface TrajectoryRewindSpan {
  readonly spanId: string;
  readonly parentBranchId: string;
  readonly newBranchId: string;
  readonly fromDay: number;
  readonly forkAtDay: number;
  readonly fidelity: RewindFidelityProof;
  readonly archivedNodes: readonly TrajectoryNode[];
}

export interface CounterfactualTrajectoryDiff {
  readonly day: number;
  readonly branchA: string;
  readonly branchB: string;
  readonly fingerprintA: string;
  readonly fingerprintB: string;
  readonly fingerprintChanged: boolean;
  readonly deltaBuildings: number;
  readonly deltaRoads: number;
  readonly deltaBeliefs: number;
  readonly deltaFacts: number;
}

export class TrajectoryRecorder {
  public readonly worldId: string;
  private activeBranchId = 'branch-0';
  private parentByBranch = new Map<string, string | null>([['branch-0', null]]);
  private branchSeq = 0;
  private nodesByBranch = new Map<string, Map<number, TrajectoryNode>>([['branch-0', new Map()]]);
  private rewindSpans: TrajectoryRewindSpan[] = [];

  constructor(worldId: string) {
    this.worldId = worldId;
  }

  public getActiveBranchId(): string {
    return this.activeBranchId;
  }

  public getRewindSpans(): readonly TrajectoryRewindSpan[] {
    return this.rewindSpans;
  }

  /**
   * 评测重开：清空分叉血缘与节点（新世界没有历史轨迹），只保留主分支基线
   * （branch-0 → null）。与 `resetWorld` 配套，保证评测各用例之间状态隔离。
   */
  public resetForEval(): void {
    this.activeBranchId = 'branch-0';
    this.rewindSpans = [];
    this.parentByBranch = new Map<string, string | null>([['branch-0', null]]);
    this.branchSeq = 0;
    this.nodesByBranch = new Map<string, Map<number, TrajectoryNode>>([['branch-0', new Map()]]);
  }

  /**
   * 记下「这一天结束时的轨迹锚点」。只写确定性指纹与业务向量，不序列化整档。
   */
  public recordDayCapture(doc: HistoryDoc): TrajectoryNode {
    const metrics = this.metricsOf(doc);
    const node: TrajectoryNode = {
      branchId: this.activeBranchId,
      parentBranchId: this.parentByBranch.get(this.activeBranchId) ?? null,
      day: doc.day,
      stateFingerprint: this.fingerprintOf(doc),
      metrics,
    };
    let branchMap = this.nodesByBranch.get(this.activeBranchId);
    if (!branchMap) {
      branchMap = new Map();
      this.nodesByBranch.set(this.activeBranchId, branchMap);
    }
    branchMap.set(doc.day, node);
    return node;
  }

  public getNode(branchId: string, day: number): TrajectoryNode | undefined {
    const direct = this.nodesByBranch.get(branchId)?.get(day);
    if (direct) return direct;
    // 若当前分叉分支在 forkAtDay 之前未重跑该天，沿着父分支向上回溯查找共同祖先节点。
    const parentId = this.parentByBranch.get(branchId);
    if (parentId) return this.getNode(parentId, day);
    return undefined;
  }

  /**
   * 记录一次回溯分叉：校验保真度、归档被覆盖的 `(targetDay, fromDay]` 影子段、开启新分支。
   * 返回 `{ span, fidelity }`。
   */
  public recordRewindFork(
    fromDay: number,
    targetDay: number,
    restoredDoc: HistoryDoc,
  ): { span: TrajectoryRewindSpan; fidelity: RewindFidelityProof } {
    const prevBranchId = this.activeBranchId;
    const expectedNode = this.getNode(prevBranchId, targetDay);
    const restoredFingerprint = this.fingerprintOf(restoredDoc);

    const fidelity: RewindFidelityProof = {
      targetDay,
      expectedFingerprint: expectedNode?.stateFingerprint ?? null,
      restoredFingerprint,
      fidelityMatch: expectedNode ? expectedNode.stateFingerprint === restoredFingerprint : true,
    };

    // 收集被回溯覆盖的 `(targetDay, fromDay]` 未来节点作为影子轨迹归档。
    const currentMap = this.nodesByBranch.get(prevBranchId);
    const archivedNodes: TrajectoryNode[] = [];
    if (currentMap) {
      for (const [d, node] of [...currentMap.entries()].sort((a, b) => a[0] - b[0])) {
        if (d > targetDay && d <= fromDay) archivedNodes.push(node);
      }
    }

    this.branchSeq += 1;
    const newBranchId = `branch-${this.branchSeq}`;
    this.parentByBranch.set(newBranchId, prevBranchId);

    const nextMap = new Map<number, TrajectoryNode>();
    if (expectedNode) nextMap.set(targetDay, expectedNode);
    this.nodesByBranch.set(newBranchId, nextMap);
    this.activeBranchId = newBranchId;

    const span: TrajectoryRewindSpan = {
      spanId: `rewind-${this.branchSeq}-d${fromDay}-to-d${targetDay}`,
      parentBranchId: prevBranchId,
      newBranchId,
      fromDay,
      forkAtDay: targetDay,
      fidelity,
      archivedNodes,
    };
    this.rewindSpans.push(span);
    return { span, fidelity };
  }

  /**
   * 跨分支同日反事实对比。两支都查不到同一天的节点时返回 `null`（不是「相等」）。
   */
  public compareBranches(
    branchA: string,
    branchB: string,
    day: number,
  ): CounterfactualTrajectoryDiff | null {
    const nodeA = this.getNode(branchA, day);
    const nodeB = this.getNode(branchB, day);
    if (!nodeA || !nodeB) return null;

    return {
      day,
      branchA,
      branchB,
      fingerprintA: nodeA.stateFingerprint,
      fingerprintB: nodeB.stateFingerprint,
      fingerprintChanged: nodeA.stateFingerprint !== nodeB.stateFingerprint,
      deltaBuildings: nodeB.metrics.buildingsCount - nodeA.metrics.buildingsCount,
      deltaRoads: nodeB.metrics.roadsCount - nodeA.metrics.roadsCount,
      deltaBeliefs: nodeB.metrics.beliefsCount - nodeA.metrics.beliefsCount,
      deltaFacts: nodeB.metrics.factsCount - nodeA.metrics.factsCount,
    };
  }

  /** 时光轨迹状态栏文案（给 UI 展示当前分支与最近一次分叉的保真度）。 */
  public formatStatusBanner(currentDay: number): string {
    if (this.rewindSpans.length === 0) {
      return `时光轨迹: 主线 (${this.activeBranchId}) · D${String(currentDay).padStart(2, '0')}`;
    }
    const last = this.rewindSpans[this.rewindSpans.length - 1];
    const diff = this.compareBranches(last.parentBranchId, this.activeBranchId, currentDay);
    const fidelityTag = last.fidelity.fidelityMatch ? '指纹 100% 吻合' : '指纹偏移';
    if (!diff) {
      return `时光轨迹: ${this.activeBranchId} (自 D${String(last.forkAtDay).padStart(2, '0')} 回溯 · ${fidelityTag})`;
    }
    const sign = (n: number): string => (n >= 0 ? `+${n}` : String(n));
    return `时光轨迹: ${this.activeBranchId} (自 D${String(last.forkAtDay).padStart(2, '0')} 回溯 · ${fidelityTag} · 较原轨迹 Δ建筑 ${sign(diff.deltaBuildings)} / Δ信念 ${sign(diff.deltaBeliefs)})`;
  }

  // ---------------------------------------------------------------- 内部投影

  private metricsOf(doc: HistoryDoc): TrajectoryMetrics {
    const world = doc.save.world as unknown as MetricsWorldWithCounts;
    const memory = doc.memory as unknown as MetricsMemoryWorld;
    return {
      buildingsCount: Number(world.buildingsCount ?? world.buildings?.length ?? 0),
      roadsCount: Number(world.roadsCount ?? world.roads?.length ?? 0),
      beliefsCount: Number(memory?.world?.beliefs?.length ?? 0),
      factsCount: Number(memory?.world?.facts?.length ?? 0),
      weather: String(world.weather ?? 'clear'),
    };
  }

  private fingerprintOf(doc: HistoryDoc): string {
    return computeDeterministicFingerprint({
      day: doc.day,
      saveWorld: { ...doc.save.world },
      memory: doc.memory,
    });
  }
}
