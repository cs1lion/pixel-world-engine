/**
 * 日历抽屉：把 `DayDigest` 读成「每天一行」。
 *
 * 这一屏只读，不改世界、不改存档。数据来自场景的 `dayCards()`——
 * 它只调 `dayDigests()` 与 `factDigest()` 两个读方法。面板本身不碰库，
 * 也不做第二次推导：卡、旗子、周摘要都由 `world/memory/daycard.ts` 算好。
 *
 * 摆放：与镇志同一套硬投影语言，落在左侧。两个抽屉互斥——日历拉开时
 * 镇志收起，反之亦然，免得同一块屏幕叠两层字。
 *
 * 文案纪律：远档当天没有原句，**不印「时刻不明」**。一行只答四件事：
 * 有没有事 / 几个人 / 哪一天不平静 / 那天大概发生了什么。
 */

import {
  dayCardBytes,
  groupIntoWeeks,
  weekViewOf,
  type DayCardView,
} from '../world/memory/daycard.ts';

export interface DayCardRead {
  readonly cards: readonly DayCardView[];
  readonly readMs: number;
  readonly days: number;
}

/**
 * 纯读证明：建卡前后 `world.memory` 与存档原文的字节数/哈希。
 * 相等才算「开关这一屏没有偷偷写库」。
 */
export interface DayCardProof {
  readonly readMs: number;
  readonly days: number;
  readonly memoryBytesBefore: number;
  readonly memoryBytesAfter: number;
  readonly memoryEqual: boolean;
  readonly saveBytesBefore: number;
  readonly saveBytesAfter: number;
  readonly saveEqual: boolean;
}

export interface DayCardOracle {
  readonly dayCards?: () => DayCardRead | null;
  readonly dayCardProof?: () => DayCardProof | null;
}

type Range = 7 | 30 | 'all';

const RANGE_LABEL: Readonly<Record<string, string>> = {
  '7': '近 7 天',
  '30': '近 30 天',
  all: '全部',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

const byteText = (bytes: number): string => `${bytes} B`;

export function bindDayCardPanel(getApi: () => DayCardOracle | undefined): void {
  const panel = document.querySelector<HTMLElement>('#daycard');
  const openButton = document.querySelector<HTMLButtonElement>('#daycard-open');
  const closeButton = document.querySelector<HTMLButtonElement>('#daycard-close');
  const refreshButton = document.querySelector<HTMLButtonElement>('#daycard-refresh');
  const heading = document.querySelector<HTMLElement>('#daycard-heading');
  const note = document.querySelector<HTMLElement>('#daycard-note');
  const list = document.querySelector<HTMLElement>('#daycard-list');
  const rangeButtons = [7, 30, 'all'].map((range) => ({
    range: range as Range,
    button: document.querySelector<HTMLButtonElement>(`#daycard-range-${range}`),
  }));

  if (panel === null || heading === null || note === null || list === null) return;

  let range: Range = 30;

  const setOpen = (next: boolean): void => {
    panel.hidden = !next;
    openButton?.setAttribute('aria-expanded', String(next));
  };

  const closeChronicle = (): void => {
    const chronicle = document.querySelector<HTMLElement>('#chronicle');
    if (chronicle !== null && !chronicle.hidden) {
      chronicle.hidden = true;
      document
        .querySelector<HTMLButtonElement>('#chronicle-open')
        ?.setAttribute('aria-expanded', 'false');
    }
  };

  const paintNote = (read: DayCardRead): void => {
    const proof = getApi()?.dayCardProof?.() ?? null;
    const parts = [
      '只读',
      `建卡 ${read.readMs.toFixed(2)} ms / ${read.days} 天`,
    ];
    if (proof !== null) {
      const memory = proof.memoryEqual ? '记忆未变' : '记忆变了！';
      const save = proof.saveEqual ? '存档未变' : '存档变了！';
      parts.push(`${memory} ${byteText(proof.memoryBytesBefore)}`, `${save} ${byteText(proof.saveBytesBefore)}`);
    }
    note.textContent = parts.join(' · ');
    note.classList.toggle('bad', proof !== null && (!proof.memoryEqual || !proof.saveEqual));
  };

  const paint = (): void => {
    const read = getApi()?.dayCards?.() ?? null;
    list.replaceChildren();
    if (read === null || read.cards.length === 0) {
      heading.textContent = '日历';
      note.textContent = '还没有日摘要。世界关账之后，日历上才会长出第一格。';
      return;
    }

    const sorted = [...read.cards].sort((a, b) => a.d - b.d);
    const shown = range === 'all' ? sorted : sorted.slice(-range);
    heading.textContent = `日历 · ${RANGE_LABEL[String(range)]} · 第 ${shown[0]?.d ?? 0}–${shown.at(-1)?.d ?? 0} 天`;
    paintNote(read);

    // 按周切块，最近的周放最上面——日历先给人看「这一周安不安生」。
    const weeks = [...groupIntoWeeks(shown)].reverse();
    for (const week of weeks) {
      let view;
      try {
        view = weekViewOf(week.cards);
      } catch (error) {
        const guard = element('div', 'daycard-week daycard-week-bad');
        guard.textContent = `周视图守卫拦下了：${error instanceof Error ? error.message : String(error)}`;
        list.append(guard);
        continue;
      }
      const weekHead = element('div', 'daycard-week');
      weekHead.textContent = view.summary;
      list.append(weekHead);

      for (const card of [...week.cards].reverse()) {
        const row = element('div', card.tense ? 'daycard-row daycard-row-tense' : 'daycard-row');
        const line = element('div', 'daycard-row-line');
        line.textContent = `第 ${card.d} 天 · ${card.e > 0 ? '有事' : '没什么事'} · ${card.p} 人`;
        const what = element('div', 'daycard-row-what');
        // `s` 是四字标签，`what` 是那句粗描述；两样都摆出来，不压成一行。
        what.textContent = `${card.s} · ${card.what}`;
        const bytes = element('span', 'daycard-row-bytes');
        bytes.textContent = `${dayCardBytes(card)} B`;
        row.append(line, what, bytes);
        list.append(row);
      }
    }
  };

  const open = (): void => {
    closeChronicle();
    setOpen(true);
    paint();
  };

  openButton?.addEventListener('click', open);
  closeButton?.addEventListener('click', () => setOpen(false));
  refreshButton?.addEventListener('click', paint);

  for (const item of rangeButtons) {
    item.button?.addEventListener('click', () => {
      range = item.range;
      for (const other of rangeButtons) {
        other.button?.setAttribute('aria-pressed', String(other.range === range));
      }
      paint();
    });
    item.button?.setAttribute('aria-pressed', String(item.range === range));
  }

  // 反过来：镇志拉开时收起日历。两个抽屉同占左侧，不能让它们叠着。
  document.querySelector<HTMLButtonElement>('#chronicle-open')?.addEventListener('click', () => {
    if (!panel.hidden) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    setOpen(false);
  });
}
