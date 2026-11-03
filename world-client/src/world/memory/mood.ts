/** 情绪残留：从当日记忆合成、按半衰期衰减。纯函数，不调模型。 */

import type { MemoryEntry, Mood } from './types.ts';

export const MOOD_HALF_LIFE_DAYS = 1;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** 情绪标签只由 (valence, arousal) 决定，不读任何别的东西。 */
export function moodLabel(valence: number, arousal: number): string {
  const base =
    valence <= -0.4 ? '沉重'
      : valence <= -0.2 ? '低落'
        : valence < -0.05 ? '有点闷'
          : valence < 0.05 ? '平静'
            : valence < 0.2 ? '平稳'
              : valence < 0.4 ? '轻快'
                : '雀跃';
  return arousal >= 0.6 && valence <= -0.2 ? `${base} · 紧绷` : base;
}

/** 把一条 Mood 从它的 `updatedAt` 衰减到 `at`。 */
export function decayedMood(mood: Mood, at: number, dayMs: number): Mood {
  const elapsedDays = Math.max(0, (at - mood.updatedAt) / dayMs);
  const factor = Math.pow(0.5, elapsedDays / Math.max(0.25, mood.halfLifeDays));
  const valence = clamp(mood.valence * factor, -1, 1);
  const arousal = clamp(mood.arousal * factor, 0, 1);
  return {
    ...mood,
    valence,
    arousal,
    label: moodLabel(valence, arousal),
    updatedAt: at,
  };
}

/**
 * 日终更新：先衰减旧情绪，再把当天记忆的加权情绪混进去。
 *
 * 权重只用 `salience`，不另造「情绪强度」；`because` 取当天最显著的两条
 * 记忆 id，供面板追溯。没有当天记忆时，只衰减，不凭空生成情绪。
 */
export function nextMood(
  previous: Mood | undefined,
  entries: readonly MemoryEntry[],
  holderId: string,
  day: number,
  at: number,
  dayMs: number,
): Mood {
  const todays = entries
    .filter((entry) => entry.holderId === holderId
      && entry.createdDay === day
      && entry.kind === 'episodic'
      // 只算直接经历：听来的转述与摘要都不能把同一天的情绪再翻一遍；
      // 否则「一件事被重复讲」会让情绪越滚越大。
      && (entry.sourceMode === 'witnessed' || entry.sourceMode === 'inferred')
      && !entry.redacted
      && !entry.archived)
    .sort((a, b) => b.salience - a.salience || a.memoryId.localeCompare(b.memoryId));
  const base = previous === undefined
    ? { holderId, valence: 0, arousal: 0.2, label: '平静', because: [], updatedAt: at, halfLifeDays: MOOD_HALF_LIFE_DAYS }
    : decayedMood(previous, at, dayMs);
  if (todays.length === 0) return base;

  const weight = todays.reduce((sum, entry) => sum + Math.max(0.05, entry.salience), 0);
  const targetValence = todays.reduce((sum, entry) => sum + entry.content.valence * Math.max(0.05, entry.salience), 0) / weight;
  const targetArousal = todays.reduce((sum, entry) => sum + entry.content.arousal * Math.max(0.05, entry.salience), 0) / weight;
  const valence = clamp(base.valence * 0.55 + targetValence * 0.45, -1, 1);
  const arousal = clamp(base.arousal * 0.55 + targetArousal * 0.45, 0, 1);
  return {
    holderId,
    valence,
    arousal,
    label: moodLabel(valence, arousal),
    because: todays.slice(0, 2).map((entry) => entry.memoryId),
    updatedAt: at,
    halfLifeDays: MOOD_HALF_LIFE_DAYS,
  };
}
