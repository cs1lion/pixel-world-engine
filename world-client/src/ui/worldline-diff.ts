/** 命运分叉沙盘 UI 纯逻辑与《平行世界对照报》视图构件。
 *
 * 职责边界：
 * - 将 src/world/history/worldline-tree.ts 产出的纯结构化 TurnpointBadge 格式化为展示文案（支持 WorldBundle 自定义词表）；
 * - 显式区分「已达成最大公共对比日 (latestComparableDay)」与「父分支目标追赶日 (targetParityDay)」；
 * - 基于 CounterfactualTrajectoryDiff 生成双栏复古《平行世界对照报》数据与 DOM 卡片；
 * - 提供轻量「改命切片（ButterflySlice）」序列化/解析，供 WorldBundle 跨会话分享复现。
 */

import type {
  CounterfactualTrajectoryDiff,
  InterventionStamp,
  TurnpointBadge,
  WorldlineBranchSummary,
  WorldlineTreeSummary,
} from '../world/history/scene-history.ts';

const DEFAULT_EXTREME_WEATHER_LABELS: Readonly<Record<string, string>> = {
  thunderstorm: '雷暴来袭',
  snowstorm: '暴风雪',
  blizzard: '暴风雪',
  sandstorm: '沙尘暴',
  hurricane: '飓风过境',
  typhoon: '台风过境',
  cyclone: '气旋风暴',
  heatwave: '酷暑热浪',
  heavy_rain: '特大暴雨',
  drought: '持续大旱',
  flood: '洪涝袭村',
  storm: '暴风雨',
  tempest: '狂风暴雨',
};

export interface TurnpointFormatOptions {
  readonly weatherLabels?: Readonly<Record<string, string>>;
  readonly phasePrefix?: string;
}

export function formatTurnpointBadge(
  badge: TurnpointBadge,
  options: TurnpointFormatOptions = {},
): string {
  switch (badge.kind) {
    case 'phase_shift': {
      const prefix = options.phasePrefix ?? '进入';
      const phase = (badge.token ?? '').trim();
      return phase ? `${prefix}${phase}` : `${prefix}新阶段`;
    }
    case 'extreme_weather': {
      const token = (badge.token ?? '').trim().toLowerCase();
      if (token && options.weatherLabels && options.weatherLabels[token]) {
        return options.weatherLabels[token];
      }
      if (token && DEFAULT_EXTREME_WEATHER_LABELS[token]) {
        return DEFAULT_EXTREME_WEATHER_LABELS[token];
      }
      return token || '极端天气';
    }
    case 'belief_drop': {
      const delta = badge.delta ?? 0;
      const signed = delta <= 0 ? `${delta}` : `-${delta}`;
      return `信念骤降(${signed})`;
    }
    case 'belief_surge': {
      const delta = Math.abs(badge.delta ?? 0);
      return `信念飙升(+${delta})`;
    }
    case 'building_growth': {
      const delta = Math.abs(badge.delta ?? 0);
      return `新建+${delta}栋`;
    }
  }
}

export interface ParityTargetView {
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly latestComparableDay: number | null;
  readonly targetParityDay: number | null;
  readonly remainingDays: number;
  readonly canFastForward: boolean;
}

export function resolveParityTarget(
  summary: WorldlineTreeSummary,
  branchId: string,
  currentDay: number,
): ParityTargetView {
  const branch = summary.branches.find((b) => b.branchId === branchId);
  if (!branch || branch.isMain || branch.parentBranchId === null) {
    return {
      branchId,
      parentBranchId: branch?.parentBranchId ?? null,
      latestComparableDay: branch?.parityDay ?? null,
      targetParityDay: null,
      remainingDays: 0,
      canFastForward: false,
    };
  }
  const parent = summary.branches.find((b) => b.branchId === branch.parentBranchId);
  const targetParityDay = parent?.maxDay ?? branch.forkFromDay ?? null;
  const remainingDays =
    targetParityDay !== null && currentDay < targetParityDay ? targetParityDay - currentDay : 0;
  return {
    branchId: branch.branchId,
    parentBranchId: branch.parentBranchId,
    latestComparableDay: branch.parityDay,
    targetParityDay,
    remainingDays,
    canFastForward: remainingDays > 0,
  };
}

export interface WorldlineMetricDeltaItem {
  readonly key: 'buildings' | 'roads' | 'beliefs' | 'facts';
  readonly title: string;
  readonly delta: number;
  readonly formatted: string;
}

export interface WorldlineDiffReport {
  readonly day: number;
  readonly branchA: string;
  readonly branchB: string;
  readonly forkDay: number | null;
  readonly forkFromDay: number | null;
  readonly fingerprintA: string;
  readonly fingerprintB: string;
  readonly fingerprintChanged: boolean;
  readonly interventions: readonly InterventionStamp[];
  readonly metrics: readonly WorldlineMetricDeltaItem[];
}

function formatSignedDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return `${n}`;
}

export function buildWorldlineDiffReport(
  diff: CounterfactualTrajectoryDiff,
  branch: WorldlineBranchSummary | null | undefined,
): WorldlineDiffReport {
  return {
    day: diff.day,
    branchA: diff.branchA,
    branchB: diff.branchB,
    forkDay: branch?.forkDay ?? null,
    forkFromDay: branch?.forkFromDay ?? null,
    fingerprintA: diff.fingerprintA,
    fingerprintB: diff.fingerprintB,
    fingerprintChanged: diff.fingerprintChanged,
    interventions: branch ? [...branch.interventions] : [],
    metrics: [
      { key: 'buildings', title: 'Δ建筑', delta: diff.deltaBuildings, formatted: formatSignedDelta(diff.deltaBuildings) },
      { key: 'roads', title: 'Δ道路', delta: diff.deltaRoads, formatted: formatSignedDelta(diff.deltaRoads) },
      { key: 'beliefs', title: 'Δ信念', delta: diff.deltaBeliefs, formatted: formatSignedDelta(diff.deltaBeliefs) },
      { key: 'facts', title: 'Δ事实', delta: diff.deltaFacts, formatted: formatSignedDelta(diff.deltaFacts) },
    ],
  };
}

export interface ButterflySlicePayload {
  readonly version: 1;
  readonly worldId: string;
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly forkDay: number | null;
  readonly forkFromDay: number | null;
  readonly interventions: readonly InterventionStamp[];
}

export function serializeButterflySlice(
  worldId: string,
  branch: WorldlineBranchSummary,
): string {
  const payload: ButterflySlicePayload = {
    version: 1,
    worldId,
    branchId: branch.branchId,
    parentBranchId: branch.parentBranchId,
    forkDay: branch.forkDay,
    forkFromDay: branch.forkFromDay,
    interventions: branch.interventions.map((item) => ({
      day: item.day,
      kind: item.kind,
      label: item.label,
      ...(item.targetId !== undefined ? { targetId: item.targetId } : {}),
    })),
  };
  return JSON.stringify(payload);
}

export function parseButterflySlice(raw: string): ButterflySlicePayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ButterflySlicePayload> | null;
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.worldId !== 'string' || typeof parsed.branchId !== 'string') return null;
    if (!Array.isArray(parsed.interventions)) return null;
    const interventions: InterventionStamp[] = [];
    for (const item of parsed.interventions) {
      if (
        !item ||
        typeof item.day !== 'number' ||
        typeof item.kind !== 'string' ||
        typeof item.label !== 'string'
      ) {
        return null;
      }
      interventions.push({
        day: item.day,
        kind: item.kind,
        label: item.label,
        ...(typeof item.targetId === 'string' ? { targetId: item.targetId } : {}),
      });
    }
    return {
      version: 1,
      worldId: parsed.worldId,
      branchId: parsed.branchId,
      parentBranchId: typeof parsed.parentBranchId === 'string' ? parsed.parentBranchId : null,
      forkDay: typeof parsed.forkDay === 'number' ? parsed.forkDay : null,
      forkFromDay: typeof parsed.forkFromDay === 'number' ? parsed.forkFromDay : null,
      interventions,
    };
  } catch {
    return null;
  }
}

export interface WorldlineDiffCardActions {
  readonly onContinue?: () => void;
  readonly onReturnMain?: () => void;
  readonly onRefork?: () => void;
  readonly onExportSlice?: () => void;
}

export function renderWorldlineDiffCard(
  report: WorldlineDiffReport,
  actions: WorldlineDiffCardActions = {},
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'worldline-diff-card';
  root.dataset.day = String(report.day);

  const header = document.createElement('header');
  header.className = 'worldline-diff-header';
  const title = document.createElement('h3');
  title.textContent = `《平行世界对照报》· D${report.day}`;
  const proof = document.createElement('span');
  proof.className = 'worldline-diff-proof';
  proof.textContent = report.fingerprintChanged
    ? '状态指纹已分叉（100% 自证）'
    : '状态指纹一致（尚无分叉差异）';
  header.append(title, proof);
  root.append(header);

  const meta = document.createElement('div');
  meta.className = 'worldline-diff-meta';
  const forkText = report.forkDay !== null ? `分叉点 D${report.forkDay}` : '未记录分叉点';
  const stamps =
    report.interventions.length > 0
      ? report.interventions.map((s) => `D${s.day} ${s.label}`).join(' · ')
      : '无蝴蝶干预';
  meta.textContent = `${forkText} ｜ 蝴蝶印记：${stamps}`;
  root.append(meta);

  const columns = document.createElement('div');
  columns.className = 'worldline-diff-columns';

  const left = document.createElement('div');
  left.className = 'worldline-diff-col worldline-diff-col-a';
  left.textContent = `原世界线 (${report.branchA}) · ${report.fingerprintA.slice(0, 10)}`;

  const right = document.createElement('div');
  right.className = 'worldline-diff-col worldline-diff-col-b';
  right.textContent = `改命世界线 (${report.branchB}) · ${report.fingerprintB.slice(0, 10)}`;

  columns.append(left, right);
  root.append(columns);

  const metricsRow = document.createElement('div');
  metricsRow.className = 'worldline-diff-metrics';
  for (const item of report.metrics) {
    const pill = document.createElement('span');
    pill.className = `worldline-diff-metric worldline-diff-metric-${item.key}`;
    pill.textContent = `${item.title} ${item.formatted}`;
    metricsRow.append(pill);
  }
  root.append(metricsRow);

  const footer = document.createElement('footer');
  footer.className = 'worldline-diff-actions';
  const buttons: readonly [string, (() => void) | undefined][] = [
    ['继续推演本线', actions.onContinue],
    ['跳回原世界线', actions.onReturnMain],
    ['在分叉点再开新线', actions.onRefork],
    ['导出改命切片', actions.onExportSlice],
  ];
  for (const [text, handler] of buttons) {
    if (!handler) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.addEventListener('click', handler);
    footer.append(btn);
  }
  if (footer.childElementCount > 0) root.append(footer);

  return root;
}
