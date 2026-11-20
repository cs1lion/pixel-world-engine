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
import { emoteIdFor, emoteIdForKind, plateIdFor } from '../render/art-assets.ts';
import { appendDecor } from './art-decor.ts';
import type {
  CounterfactualTrajectoryDiff,
  TurnpointBadge,
  WorldlineTreeSummary,
} from '../world/history/scene-history.ts';
import {
  buildWorldlineDiffReport,
  formatTurnpointBadge,
  renderWorldlineDiffCard,
  resolveParityTarget,
  serializeButterflySlice,
} from './worldline-diff.ts';

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
  /** 历史已记到的日子（行内回溯按钮只给有记录的日子挂）。 */
  readonly historyDays?: () => readonly { readonly day: number; readonly kind: string }[];
  /** 当前世界日（已关账口径）。 */
  readonly currentDay?: () => number;
  /** 时光轨迹分支状态摘要（给 #daycard-note 展示；纯读）。 */
  readonly trajectoryBanner?: (currentDay: number) => string;
  /** 真回滚：两段式确认的「确认」这一步才调它（走场景 historyRestoreToDay）。 */
  readonly historyRestoreToDay?: (day: number) => Promise<unknown>;
  /** 平行世界树只读摘要（供日历顶部切换条与对照日追赶计算）。*/
  readonly worldlineSummary?: () => WorldlineTreeSummary | null;
  /** 某天在当前世界线上的结构化转折徽章（最多 2 条，纯读）。*/
  readonly worldlineTurnpoints?: (day: number) => readonly TurnpointBadge[];
  /** 同日反事实对比数据（纯读，供《平行世界对照报》）。*/
  readonly worldlineDiff?: (branchId: string, day?: number) => CounterfactualTrajectoryDiff | null;
  /** 无损切换活跃世界线分支。*/
  readonly worldlineSwitchBranch?: (branchId: string) => Promise<unknown>;
  /** 一键确定性快进至目标对照日。*/
  readonly worldlineFastForwardToDay?: (targetDay: number) => Promise<unknown>;
  /** 导出改命切片回调。*/
  readonly worldlineExportSlice?: (sliceJson: string) => void;
}

/**
 * 给某一天的历史行挂两段式确认按钮：[回溯此日] → [确认回溯 Dxx] / [取消]。
 *
 * 纪律：**点「回溯此日」只是展开确认态，不写世界**；只有「确认回溯」才调
 * `onConfirm`（场景的真回滚）。取消/再点一次收回确认态，零变化。
 * 打开面板与 `dayCardProof()` 不经过这里——纯读契约不受影响。
 */
export function attachDayCardRewindAction(
  rowEl: HTMLElement,
  day: number,
  onConfirm: (day: number) => void,
): void {
  const open = element('button', 'daycard-rewind-open');
  open.type = 'button';
  open.textContent = '回溯此日';
  const confirm = element('button', 'daycard-rewind-confirm');
  confirm.type = 'button';
  confirm.textContent = `确认回溯 D${String(day).padStart(2, '0')}`;
  confirm.hidden = true;
  const cancel = element('button', 'daycard-rewind-cancel');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.hidden = true;

  const setArmed = (armed: boolean): void => {
    confirm.hidden = !armed;
    cancel.hidden = !armed;
    open.textContent = armed ? '回溯此日…' : '回溯此日';
  };
  open.addEventListener('click', () => setArmed(confirm.hidden));
  cancel.addEventListener('click', () => setArmed(false));
  confirm.addEventListener('click', () => {
    setArmed(false);
    onConfirm(day);
  });
  rowEl.append(open, confirm, cancel);
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
    // 时光轨迹状态摘要：纯读展示（当前分支/最近一次分叉保真度），不写任何东西。
    const api = getApi();
    const banner = api?.trajectoryBanner?.(api?.currentDay?.() ?? 0);
    if (banner !== undefined && banner !== '') {
      const bar = element('div', 'daycard-note-rewind');
      bar.textContent = banner;
      note.append(bar);
    }
    const summary = api?.worldlineSummary?.() ?? null;
    if (summary !== null && summary.branches.length > 0) {
      const bar = element('div', 'daycard-worldline-bar');
      for (const branch of summary.branches) {
        const btn = element('button', branch.isActive ? 'daycard-branch-btn is-active' : 'daycard-branch-btn');
        btn.type = 'button';
        const tag = branch.forkDay !== null ? `D${branch.forkDay}` : '主线';
        const stamps = branch.interventions.length > 0 ? ` · ${branch.interventions.length}印记` : '';
        btn.textContent = `${branch.branchId} (${tag}${stamps})`;
        btn.disabled = branch.isActive || api?.worldlineSwitchBranch === undefined;
        if (!branch.isActive && api?.worldlineSwitchBranch !== undefined) {
          const switchBranch = api.worldlineSwitchBranch;
          btn.addEventListener('click', () => {
            void switchBranch(branch.branchId).then(() => paint());
          });
        }
        bar.append(btn);
      }

      const activeBranch = summary.branches.find((b) => b.branchId === summary.activeBranchId) ?? null;
      const parity = resolveParityTarget(summary, summary.activeBranchId, api?.currentDay?.() ?? 0);
      if (parity.canFastForward && parity.targetParityDay !== null && api?.worldlineFastForwardToDay !== undefined) {
        const ffBtn = element('button', 'daycard-fastforward-btn');
        ffBtn.type = 'button';
        const targetDay = parity.targetParityDay;
        ffBtn.textContent = `快进至对照日 D${String(targetDay).padStart(2, '0')}`;
        const fastForward = api.worldlineFastForwardToDay;
        ffBtn.addEventListener('click', () => {
          void fastForward(targetDay).then(() => paint());
        });
        bar.append(ffBtn);
      }

      const diffHost = element('div', 'daycard-worldline-diff-host');
      diffHost.hidden = true;
      if (parity.latestComparableDay !== null && api?.worldlineDiff !== undefined) {
        const diffBtn = element('button', 'daycard-diff-toggle-btn');
        diffBtn.type = 'button';
        diffBtn.textContent = '查看《平行世界对照报》';
        const getDiff = api.worldlineDiff;
        const comparableDay = parity.latestComparableDay;
        diffBtn.addEventListener('click', () => {
          if (!diffHost.hidden) {
            diffHost.hidden = true;
            return;
          }
          const diff = getDiff(summary.activeBranchId, comparableDay);
          if (diff === null) return;
          diffHost.replaceChildren(
            renderWorldlineDiffCard(buildWorldlineDiffReport(diff, activeBranch), {
              onContinue: () => {
                diffHost.hidden = true;
              },
              onReturnMain:
                api?.worldlineSwitchBranch !== undefined
                  ? () => {
                      void api.worldlineSwitchBranch?.('branch-0').then(() => paint());
                    }
                  : undefined,
              onExportSlice:
                activeBranch !== null
                  ? () => {
                      const sliceJson = serializeButterflySlice(summary.worldId, activeBranch);
                      if (api?.worldlineExportSlice !== undefined) {
                        api.worldlineExportSlice(sliceJson);
                      } else if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
                        void navigator.clipboard.writeText(sliceJson);
                      }
                    }
                  : undefined,
            }),
          );
          diffHost.hidden = false;
        });
        bar.append(diffBtn);
      }

      note.append(bar, diffHost);
    }
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
    for (const [weekIndex, week] of weeks.entries()) {
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
      // 11-11 构图稿切出来的画册贴片按周轮转：纯装饰，不改这一周的读数。
      appendDecor(weekHead, 'plate', plateIdFor(weekIndex), 'art-plate');
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
        // 表情按那天的性质选：不平静 / 有事 / 平常三路，平常再按日号轮转。
        // 不是「情绪读数」——世界没有这条数据，不假装有。
        const emote = card.tense ? emoteIdForKind('storm')
          : card.e > 0 ? emoteIdForKind('alert') : emoteIdFor(card.d);
        // 挂在第一行文字里而不是 row 上：row 是 grid，多一个子节点会多撑一行。
        appendDecor(line, 'emote', emote, 'art-emote');
        // 行内回溯：只给「有记录且不是今天」的日子挂两段式按钮。
        // 确认才真回滚（走场景 historyRestoreToDay）；打开面板/纯读证明不经过这里。
        const api = getApi();
        const turnpoints = api?.worldlineTurnpoints?.(card.d) ?? [];
        if (turnpoints.length > 0) {
          const badgesWrap = element('span', 'daycard-turnpoints');
          for (const badge of turnpoints.slice(0, 2)) {
            const pill = element('span', `daycard-turnpoint-badge daycard-turnpoint-${badge.kind}`);
            pill.textContent = formatTurnpointBadge(badge);
            badgesWrap.append(pill);
          }
          what.append(badgesWrap);
        }
        const recorded = api?.historyDays?.() ?? [];
        const currentDay = api?.currentDay?.() ?? -1;
        const hasRecord = recorded.some((r) => r.day === card.d && r.kind !== 'missing');
        if (hasRecord && card.d < currentDay && api?.historyRestoreToDay !== undefined) {
          const restore = api.historyRestoreToDay;
          attachDayCardRewindAction(row, card.d, (day) => {
            void restore(day).then(() => paint());
          });
        }
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
