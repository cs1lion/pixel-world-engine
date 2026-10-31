/** 碑：点镇心旁边那块石头，看镇上认下了哪些事。
 *
 * 读侧的最后一段路：场景用 `steleLines(memory.legends(), day)` 排好序，这里只
 * 负责摆出来。文字全走 DOM（D5-A），canvas 里一个字不加——碑在画面上只是一块
 * 石头（`render/setting-scenery.ts` 的 `stele` 那一支）。
 *
 * 形状照 `villager-panel.ts`：摆出来 / 收回去 / Escape 只在开着时生效 / 晚订阅
 * 不补发一个已经关掉的面板。那四条都有测试（`test/stele-panel.test.ts`）。
 *
 * **截断必须说出来。** 实测第 4 天一次立起 19 条传说，而面板只摆
 * `STELE_MAX_LINES` 条——屏幕少掉的十几条得有个数说给用户听，否则他会以为
 * 世界只立了 5 条。静默截断是这里唯一的错法。
 */

import { DEFAULT_MEMORY_CONFIG } from '../world/memory/config.ts';
import type { SteleLine } from '../world/memory/stele.ts';
import { whenApi } from './when-api.ts';

export interface SteleView {
  /** 全部传说排好序后的前 `STELE_MAX_LINES` 条。空数组是常态。 */
  readonly lines: readonly SteleLine[];
  /** 被截掉几条。0 表示全摆在屏上了。 */
  readonly hidden: number;
}

export interface SteleOracle {
  readonly openStele: () => void;
  /** `null` 是收起：面板关掉之后，晚订阅的人也不该再被补发一份。 */
  readonly onStele: (listener: (view: SteleView | null) => void) => () => void;
  readonly dismissStele: () => void;
}

/**
 * 空碑上那句话。
 *
 * 两个数**从配置取，不手写**：`legendHolders` / `legendDays` 是定稿的设计数，
 * 有人调参那天，写死的那句就变成假话——而屏幕上没人会怀疑它。
 */
export function emptySteleText(config = DEFAULT_MEMORY_CONFIG): string {
  return `碑上还没有刻字。要等一件事被${config.legendHolders}个人讲满${config.legendDays}天。`;
}

export function bindStelePanel(getApi: () => SteleOracle | undefined): void {
  const panel = document.querySelector<HTMLElement>('#stele-panel');
  const body = document.querySelector<HTMLElement>('#stele-panel-body');
  const close = document.querySelector<HTMLButtonElement>('#stele-panel-close');
  if (panel === null || body === null) return;

  const dismiss = (): void => {
    panel.hidden = true;
    getApi()?.dismissStele();
  };

  close?.addEventListener('click', dismiss);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    dismiss();
  });

  whenApi(getApi, (api) => {
    api.onStele((view) => {
      if (view === null) {
        panel.hidden = true;
        return;
      }
      if (view.lines.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'stele-empty';
        empty.textContent = emptySteleText();
        body.replaceChildren(empty);
      } else {
        const rows = view.lines.map((line) => {
          const row = document.createElement('blockquote');
          // 几种讲法分行摆，不改写：同一件事有几种说法，正是传说该有的样子。
          for (const text of line.texts) {
            const quote = document.createElement('p');
            quote.textContent = text;
            row.append(quote);
          }
          const when = document.createElement('span');
          when.className = 'stele-when';
          const parts = [`第 ${line.formedDay} 天立`, `${line.reach} 人在讲`, line.age];
          if (line.faded) parts.push('已淡去');
          when.textContent = parts.join(' · ');
          row.append(when);
          return row;
        });
        const extra = view.hidden > 0
          ? [(() => {
              const more = document.createElement('p');
              more.className = 'stele-more';
              // 不静默截断：少掉的每一条都得有个数。
              more.textContent = `还有 ${view.hidden} 块碑没刻上来。`;
              return more;
            })()]
          : [];
        body.replaceChildren(...rows, ...extra);
      }
      panel.hidden = false;
    });
  });
}
