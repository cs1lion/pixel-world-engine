/** 逆向审校合成器（Diff-to-Rule Synthesizer）。
 *
 * 收敛条件 2：「每次人工介入都留下可复用的东西，使人工修改率逐轮下降」。
 * 人类在验收时习惯直接动手改结果，不爱手写规则；这一层把「改了什么」反推成规则。
 *
 * **它能做什么、不能做什么**（这条界线是本文件的设计核心）：
 *
 * - **能算出**的：人类把铁匠铺挪到了河边 —— 最终坐标 + 地标表 = `distance(foundry, river) <= N`，
 *   这是几何事实，置信度高，可以直接固化成硬约束。
 * - **只能看到**的：人类换了一个配色 token、改了一个名字。系统只知道「换了」，
 *   不知道**为什么**换。「这个颜色太跳」和「这个颜色不符合贵人身份」会导向完全不同的规则。
 *   所以这类只记为**负样本**，且必须由人来补一句理由，绝不自动加冕。
 *
 * 换句话说：**不猜意图**。从 diff 里算不出来的，就说算不出来。
 */

import type {
  CreateRegionCommand,
  GenesisCommand,
  PlaceBuildingCommand,
  SeedHistoryCommand,
  SpawnCharacterCommand,
} from './schema.js';
import type { GridPoint } from '../types.js';

// ========== Diff ==========

/** 人类修正的类型。 */
export type DiffType = 'rejected' | 'modified' | 'moved';

/** 结构化 Diff：Agent 提议 → 人类最终版。 */
export interface StructuredDiff {
  readonly agentProposal: GenesisCommand;
  readonly humanFinal: GenesisCommand;
  readonly diffType: DiffType;
  /** 被改动的字段路径，如 `at` / `palette.roof` / `name`。 */
  readonly modificationPoints: readonly string[];
}

// ========== 规则补丁 ==========

/** 空间约束：几何事实，可直接判真假。 */
export interface SpatialConstraintPatch {
  readonly type: 'spatial_constraint';
  readonly constraintKind: 'distance' | 'insideRegion' | 'outsideRegion';
  /** 被约束的主体（建筑模板 id 或单位名）。 */
  readonly subject: string;
  /** 参照物：地标 id 或区域名。 */
  readonly reference: string;
  /** distance 用：人类最终位置到参照物的距离上限。 */
  readonly maxDistance?: number;
  readonly justification: string;
}

/** 美术偏好：只是一个被拒的观察值，不是阈值。 */
export interface ArtQualityPatch {
  readonly type: 'art_quality';
  readonly assetKind: 'building_sprite' | 'tileset' | 'props';
  /** 被人类换掉的 token 名。 */
  readonly rejectedToken: string;
  readonly slot: string;
  /** 人类换上的 token 名。 */
  readonly acceptedToken: string;
  /** 这一条还缺人类的一句理由，不能自动固化。 */
  readonly needsIntent: true;
}

/** 叙事偏好：被删改的设定，记为负样本。 */
export interface NarrativeInvariantPatch {
  readonly type: 'narrative_invariant';
  readonly invariantKind: 'forbiddenTerm' | 'requiredReference';
  readonly target: string;
  readonly rejectedValue: string;
  readonly acceptedValue: string;
  readonly needsIntent: true;
}

/** 提示模板负样本：给「解读者」的下一轮提示加一条反例。 */
export interface TemplatePromptPatch {
  readonly type: 'template_prompt';
  readonly templateKind: 'world_bible' | 'map_placement' | 'character_spawn' | 'history_seed';
  readonly negativeExample: string;
  readonly needsIntent: true;
}

export type RulePatch =
  | SpatialConstraintPatch
  | ArtQualityPatch
  | NarrativeInvariantPatch
  | TemplatePromptPatch;

/** 一条规则能不能不经人手就固化。 */
export function isSelfJustifying(patch: RulePatch): boolean {
  // 只有几何事实能自证。其余都缺「人类为什么这么改」这一步。
  return patch.type === 'spatial_constraint';
}

// ========== 结果 ==========

/** 回归集试跑结论。三类必须分开：跑过并通过、跑过并破坏、根本没跑。 */
export type RegressionVerdict = 'passed' | 'failed' | 'not_run';

export interface SynthesisResult {
  readonly patches: readonly RulePatch[];
  /** 可直接固化的（几何事实）。 */
  readonly autoApplicable: readonly RulePatch[];
  /** 缺一句人类理由、需确认后才能固化的。 */
  readonly needsIntent: readonly RulePatch[];
  readonly regression: RegressionVerdict;
  readonly regressionDetail?: string;
}

// ========== 合成上下文 ==========

export interface SynthesisContext {
  /** 查某点附近的地标。给不出来，就不合成距离规则。 */
  readonly nearbyLandmarks?: (at: GridPoint) => readonly { readonly id: string; readonly at: GridPoint }[];
  /** 回归集：把候选规则跑一遍，返回破坏掉的用例 id；空数组表示全绿。 */
  readonly regressionSuite?: {
    run: (patches: readonly RulePatch[]) => readonly { readonly caseId: string; readonly broken: boolean }[];
  };
}

// ========== 主入口 ==========

export class RuleSynthesizer {
  /**
   * 从一次人类修正里提炼候选规则。
   *
   * 注意：它返回的是**候选**。`autoApplicable` 里的是几何事实可以直接写进检查器，
   * `needsIntent` 里的必须等人补理由——这两类混在一起自动固化，就是在拿猜测当规则。
   */
  synthesizeFromDiff(diff: StructuredDiff, context: SynthesisContext = {}): SynthesisResult {
    if (diff.agentProposal.kind !== diff.humanFinal.kind) {
      return {
        patches: [],
        autoApplicable: [],
        needsIntent: [],
        regression: 'not_run',
        regressionDetail: '提案与终稿不是同一种指令，无法按字段比对',
      };
    }

    const patches = this.derivePatches(diff, context);
    if (patches.length === 0) {
      return {
        patches: [],
        autoApplicable: [],
        needsIntent: [],
        regression: 'not_run',
        regressionDetail: '这次修改没有留下可提取的差异',
      };
    }

    const autoApplicable = patches.filter(isSelfJustifying);
    const needsIntent = patches.filter((p) => !isSelfJustifying(p));

    const { regression, detail } = this.runRegression(autoApplicable, context);

    return {
      patches,
      autoApplicable,
      needsIntent,
      regression,
      regressionDetail: detail,
    };
  }

  private derivePatches(diff: StructuredDiff, context: SynthesisContext): RulePatch[] {
    switch (diff.agentProposal.kind) {
      case 'PlaceBuilding':
        return this.fromPlaceBuilding(
          diff.agentProposal,
          diff.humanFinal as PlaceBuildingCommand,
          context,
        );
      case 'CreateRegion':
        return this.fromCreateRegion(diff.agentProposal, diff.humanFinal as CreateRegionCommand);
      case 'SpawnCharacter':
        return this.fromSpawnCharacter(
          diff.agentProposal,
          diff.humanFinal as SpawnCharacterCommand,
        );
      case 'SeedHistory':
        return this.fromSeedHistory(diff.agentProposal, diff.humanFinal as SeedHistoryCommand);
      default:
        // InjectEvent：导演的注入是运行时决策，不产生静态规则。
        return [];
    }
  }

  // ---------------------------------------------------------------- PlaceBuilding

  private fromPlaceBuilding(
    proposal: PlaceBuildingCommand,
    final: PlaceBuildingCommand,
    context: SynthesisContext,
  ): RulePatch[] {
    const patches: RulePatch[] = [];

    if (proposal.at.x !== final.at.x || proposal.at.y !== final.at.y) {
      // 只有查得到地标，才谈得上「离 X 多近」。查不到就不猜。
      const landmark = this.nearestLandmark(final.at, context);
      if (landmark !== null) {
        const distance = manhattan(final.at, landmark.at);
        patches.push({
          type: 'spatial_constraint',
          constraintKind: 'distance',
          subject: final.templateId,
          reference: landmark.id,
          maxDistance: distance,
          justification:
            `人类把 "${final.templateId}" 挪到了 ${landmark.id} 旁 ` +
            `(${final.at.x},${final.at.y})，距 ${landmark.id} ${distance} 格`,
        });
      }
    }

    for (const [slot, accepted] of Object.entries(final.palette ?? {})) {
      const rejected = proposal.palette?.[slot];
      if (rejected !== undefined && rejected !== accepted) {
        patches.push({
          type: 'art_quality',
          assetKind: 'building_sprite',
          rejectedToken: rejected,
          acceptedToken: accepted,
          slot,
          needsIntent: true,
        });
      }
    }

    return patches;
  }

  /** 最终位置最近的地标。查不到返回 null——**不拿提议位置凑数**。 */
  private nearestLandmark(
    at: GridPoint,
    context: SynthesisContext,
  ): { readonly id: string; readonly at: GridPoint } | null {
    const find = context.nearbyLandmarks;
    if (find === undefined) return null;

    let best: { id: string; at: GridPoint } | null = null;
    let bestDistance = Infinity;
    for (const landmark of find(at)) {
      const d = manhattan(at, landmark.at);
      if (d < bestDistance) {
        bestDistance = d;
        best = { id: landmark.id, at: landmark.at };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- CreateRegion

  private fromCreateRegion(proposal: CreateRegionCommand, final: CreateRegionCommand): RulePatch[] {
    if (proposal.name === final.name) return [];

    return [
      {
        type: 'template_prompt',
        templateKind: 'world_bible',
        negativeExample: `区域名 "${proposal.name}" 被改成了 "${final.name}"`,
        needsIntent: true,
      },
    ];
  }

  // ---------------------------------------------------------------- SpawnCharacter

  private fromSpawnCharacter(
    proposal: SpawnCharacterCommand,
    final: SpawnCharacterCommand,
  ): RulePatch[] {
    const patches: RulePatch[] = [];

    if (proposal.name !== final.name) {
      patches.push({
        type: 'narrative_invariant',
        invariantKind: 'forbiddenTerm',
        target: 'character_naming',
        rejectedValue: proposal.name,
        acceptedValue: final.name,
        needsIntent: true,
      });
    }

    if (proposal.role !== final.role) {
      patches.push({
        type: 'template_prompt',
        templateKind: 'character_spawn',
        negativeExample: `职业 "${proposal.role}" 被改成了 "${final.role}"`,
        needsIntent: true,
      });
    }

    return patches;
  }

  // ---------------------------------------------------------------- SeedHistory

  private fromSeedHistory(proposal: SeedHistoryCommand, final: SeedHistoryCommand): RulePatch[] {
    if (proposal.eventKind === final.eventKind) return [];

    return [
      {
        type: 'template_prompt',
        templateKind: 'history_seed',
        negativeExample: `历史事件类型 "${proposal.eventKind}" 被改成了 "${final.eventKind}"`,
        needsIntent: true,
      },
    ];
  }

  // ---------------------------------------------------------------- 回归

  /**
   * 在回归集上试跑自主可固化的规则。
   *
   * 没配回归集就是 `not_run`——**不是通过**。把「没验」记成「验过且通过」，
   * 正是这套爬梯最该防的事。
   */
  private runRegression(
    patches: readonly RulePatch[],
    context: SynthesisContext,
  ): { regression: RegressionVerdict; detail: string } {
    if (patches.length === 0) {
      return { regression: 'not_run', detail: '没有可自动固化的规则' };
    }
    if (context.regressionSuite === undefined) {
      return { regression: 'not_run', detail: '没有配置回归集，候选规则未经试跑' };
    }

    const results = context.regressionSuite.run(patches);
    const broken = results.filter((r) => r.broken);
    if (broken.length === 0) {
      return { regression: 'passed', detail: `${results.length} 条用例全绿` };
    }
    return {
      regression: 'failed',
      detail: `破坏了 ${broken.length} 条既有用例：${broken.map((r) => r.caseId).join(' / ')}`,
    };
  }
}

// ========== 构造 Diff ==========

/**
 * 从两份同类型指令构造结构化 Diff。
 *
 * 字段级比对写在这里，各指令类型分开处理：`GenesisCommand` 是联合类型，
 * 直接读 `.palette` 这类只在一种指令上存在的字段，TS 也不让。
 */
export function buildStructuredDiff(
  agentProposal: GenesisCommand,
  humanFinal: GenesisCommand,
): StructuredDiff {
  const modificationPoints = diffPoints(agentProposal, humanFinal);

  let diffType: DiffType = 'modified';
  if (modificationPoints.length === 1 && modificationPoints[0] === 'at') {
    diffType = 'moved';
  } else if (modificationPoints.length >= 3) {
    diffType = 'rejected';
  }

  return { agentProposal, humanFinal, diffType, modificationPoints };
}

function diffPoints(proposal: GenesisCommand, final: GenesisCommand): string[] {
  if (proposal.kind !== final.kind) return ['kind'];

  const points: string[] = [];

  if (proposal.id !== final.id) points.push('id');

  if (proposal.kind === 'PlaceBuilding' && final.kind === 'PlaceBuilding') {
    if (proposal.at.x !== final.at.x || proposal.at.y !== final.at.y) points.push('at');
    if (proposal.templateId !== final.templateId) points.push('templateId');
    if (proposal.orientation !== final.orientation) points.push('orientation');
    for (const slot of Object.keys({ ...proposal.palette, ...final.palette })) {
      if (proposal.palette?.[slot] !== final.palette?.[slot]) points.push(`palette.${slot}`);
    }
  }

  if (proposal.kind === 'CreateRegion' && final.kind === 'CreateRegion') {
    if (proposal.name !== final.name) points.push('name');
    if (proposal.terrainType !== final.terrainType) points.push('terrainType');
    if (proposal.boundaries.length !== final.boundaries.length) points.push('boundaries');
  }

  if (proposal.kind === 'SpawnCharacter' && final.kind === 'SpawnCharacter') {
    if (proposal.name !== final.name) points.push('name');
    if (proposal.role !== final.role) points.push('role');
    if (
      (proposal.relationships?.length ?? 0) !== (final.relationships?.length ?? 0)
    ) {
      points.push('relationships');
    }
  }

  if (proposal.kind === 'SeedHistory' && final.kind === 'SeedHistory') {
    if (proposal.eventKind !== final.eventKind) points.push('eventKind');
    if (proposal.participants.length !== final.participants.length) points.push('participants');
  }

  if (proposal.kind === 'InjectEvent' && final.kind === 'InjectEvent') {
    if (proposal.eventKind !== final.eventKind) points.push('eventKind');
    if (proposal.timing.dayOffset !== final.timing.dayOffset) points.push('timing');
  }

  return points;
}

function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
