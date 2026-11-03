/** 内心独白：规则模板，只读；绝不写公开 `bubble`。 */

import type { Bond, MemoryEntry, Mood } from './types.ts';
import { MOOD_TENSE_AROUSAL } from './mood.ts';

export interface InnerVoice {
  /** 模板 id。同一事件在两种 mood 下必须不同——验收断言看的是这个。 */
  readonly templateId: string;
  readonly text: string;
}

function toneOf(mood: Mood): 'low' | 'neutral' | 'high' {
  if (mood.valence <= -0.2) return 'low';
  if (mood.valence >= 0.2) return 'high';
  return 'neutral';
}

/** 只读：输入是这个人自己的记忆与关系，不读全局。 */
export function innerVoiceOf(
  holderId: string,
  mood: Mood,
  memories: readonly MemoryEntry[],
  bonds: readonly Bond[],
): InnerVoice {
  const tone = toneOf(mood);
  const energy = mood.arousal >= MOOD_TENSE_AROUSAL ? 'tense' : 'calm';
  const recent = memories
    .filter((entry) => entry.holderId === holderId && !entry.redacted && !entry.archived)
    .sort((a, b) => b.salience - a.salience || b.createdDay - a.createdDay || a.memoryId.localeCompare(b.memoryId));
  const top = recent[0];
  const debt = bonds
    .filter((bond) => bond.from === holderId && bond.debt > 0.25)
    .sort((a, b) => b.debt - a.debt)[0];

  if (top === undefined) {
    return {
      templateId: `inner.${tone}.${energy}.empty`,
      text: tone === 'low'
        ? '心里空落落的，说不上来为什么。'
        : tone === 'high' ? '心里是亮的，没什么特别惦记的。' : '眼下没什么特别惦记的。',
    };
  }

  const templateId = `inner.${tone}.${energy}.${top.kind}${debt === undefined ? '' : '.debt'}`;
  const what = top.content.what;
  const text =
    tone === 'low'
      ? debt === undefined
        ? `${what}。心里还沉着，没那么容易过去。`
        : `${what}。心里还沉着；另外，还欠着一份人情没还。`
      : tone === 'high'
        ? debt === undefined
          ? `${what}。心里是亮的，连脚步都轻一点。`
          : `${what}。心里是亮的；欠着的人情，记得去还。`
        : debt === undefined
          ? `${what}。还在心里转，没急着放下。`
          : `${what}。还在心里转；那份人情，也还记着。`;
  return { templateId, text };
}
