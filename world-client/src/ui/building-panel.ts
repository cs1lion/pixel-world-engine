/** 点一栋楼，看它叫什么、接过什么活、墙上留着什么。
 *
 * 这是三件事的读出口，三件事各有一个来源，一个都不新造：
 *
 * | 行 | 从哪来 |
 * | --- | --- |
 * | 名字（含称号）与历史链 | `MemoryRuntime.placeNamesOf`（协议 §11 的历史链） |
 * | 接什么活 | `PlacedBuilding.boundTask`，说法用 `TASK_PROFILES` 的 label |
 * | 此刻状态 | `WorkstationSnapshot.activity.kind` |
 * | 墙上的痕迹 | `MemoryRuntime.placeHints`——**与画在墙上的那一份同源** |
 *
 * 痕迹走 `placeHints` 而不是自己翻 `traces`，是因为补充设计 §10 把话堵在
 * 「表现层只消费 ExpressionHint，不直接读记忆库」上。面板与 canvas 读同一扇门，
 * 屏幕上画了三道、面板里写着三道，才对得上。
 *
 * 文字全走 DOM（D5-A），canvas 里一个字不加。形状照 `villager-panel.ts`：
 * 摆出来 / 收回去 / Escape 只在开着时生效 / 晚订阅不补发。那四条都有测试。
 */

import { TASK_PROFILES } from '../world/tasks.ts';
import type { TraceLayer } from '../world/memory/types.ts';
import type { WorkshopTask } from '../world/types.ts';
import { whenApi } from './when-api.ts';
import { activityDecorId } from '../render/art-assets.ts';
import type { BuildingLandingView } from '../world/landing-readout.ts';
import { appendDecor } from './art-decor.ts';

/** 楼此刻在干什么。与 `WorkstationActivity` 的四个分支一一对应。 */
export type BuildingActivity = 'idle' | 'operating' | 'overheating' | 'cooling';

/** 墙上一道痕迹，给纸面看的形状。 */
export interface BuildingTraceView {
  readonly layer: TraceLayer;
  /** 0..1。风化只降这个数，不删记录（协议 §11）。 */
  readonly visibility: number;
}

/** 历史链上的一节。 */
export interface BuildingHistoryView {
  readonly day: number;
  /** 改完之后的名字。 */
  readonly name: string;
  /**
   * 因为哪件事改的。查得到那句话就引出来，查不到就是 `null`——不编一个理由。
   *
   * 事件 id 是内部编号，纸面上不该出现（`SandboxScene.buildingName` 那条注释
   * 记着同一个教训：内部编号被当地名念出来，比说不准更糟）。
   */
  readonly because: string | null;
}

export interface BuildingPanelView {
  readonly placeId: string;
  /** 此刻的名字。改过名就带着称号。 */
  readonly name: string;
  readonly history: readonly BuildingHistoryView[];
  /** 接什么活。`null` 是这栋楼不接活——派过来的活会被拒，照实说。 */
  readonly task: WorkshopTask | null;
  readonly activity: BuildingActivity;
  readonly traces: readonly BuildingTraceView[];
  /** 造物落地账的脚注：谁提的、落地检查过没过。没有记录就是 `null`。
   *  读侧纯函数在 `world/landing-readout.ts`；面板只负责把那句话摆出来。 */
  readonly landing: BuildingLandingView | null;
}

export interface BuildingOracle {
  readonly lookAtBuilding: (placeId: string) => void;
  /** `null` 是收起：面板关掉之后，晚订阅的人也不该再被补发一份。 */
  readonly onBuilding: (listener: (view: BuildingPanelView | null) => void) => () => void;
  readonly dismissBuilding: () => void;
  /** 面板与脚本读同一份视图。给浏览器验收用，与 `Oracle.stele()` 同一个口子。 */
  readonly building: (placeId: string) => BuildingPanelView | null;
}

/**
 * 痕迹层的纸面说法。
 *
 * 与 `traces.ts` 那张 `INFERENCE_TABLE` 分开写：那张表说的是「这道痕说明发生过
 * 什么」，这里说的是「这道痕叫什么」。混成一张，改一个词的措辞就会动到推断。
 */
const TRACE_NAMES: Readonly<Record<TraceLayer, string>> = {
  scorch: '焦痕',
  damage: '破损',
  patch: '补板',
  garland: '花环',
  worn_path: '磨损的小径',
  inscription: '刻字',
  ruin: '废墟',
};

export function traceName(layer: TraceLayer): string {
  return TRACE_NAMES[layer];
}

/** 楼此刻在干什么，一句人话。 */
export function activityText(activity: BuildingActivity): string {
  switch (activity) {
    case 'idle':
      return '此刻闲着。';
    case 'operating':
      return '此刻有人在里面干活。';
    case 'overheating':
      return '此刻出了故障，冒黑烟。';
    case 'cooling':
      return '刚干完一单，正在冷下来。';
  }
}

/** 接什么活，一句人话。不接活的那句要说清后果：派过来的活会被拒。 */
export function taskText(task: WorkshopTask | null): string {
  if (task === null) return '不接活：派到这里的活会被拒。';
  return `接的活：${TASK_PROFILES[task].label}。`;
}

/** 痕迹那一段的一句话。空的时候照实说，不留一行空白让人猜。 */
export function traceText(traces: readonly BuildingTraceView[]): string {
  if (traces.length === 0) return '墙上什么都没留下。';
  return `墙上留着 ${traces.length} 道痕迹。`;
}

/** 一道痕迹：叫什么、还剩几分可见。 */
export function traceLineText(trace: BuildingTraceView): string {
  const percent = Math.round(trace.visibility * 100);
  return `${traceName(trace.layer)} · 还剩 ${percent}% 可见`;
}

/** 历史链的一行。没有历史时那句话由调用方决定（空态与「没改过名」是两回事）。 */
export function historyLineText(entry: BuildingHistoryView): string {
  const head = `第 ${entry.day} 天改成「${entry.name}」`;
  return entry.because === null ? head : `${head}——因为「${entry.because}」`;
}

export function bindBuildingPanel(getApi: () => BuildingOracle | undefined): void {
  const panel = document.querySelector<HTMLElement>('#building-panel');
  const title = document.querySelector<HTMLElement>('#building-panel-name');
  const body = document.querySelector<HTMLElement>('#building-panel-body');
  const close = document.querySelector<HTMLButtonElement>('#building-panel-close');
  if (panel === null || title === null || body === null) return;

  const dismiss = (): void => {
    panel.hidden = true;
    getApi()?.dismissBuilding();
  };

  close?.addEventListener('click', dismiss);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    dismiss();
  });

  whenApi(getApi, (api) => {
    api.onBuilding((view) => {
      if (view === null) {
        panel.hidden = true;
        return;
      }
      title.textContent = view.name;
      const line = (className: string, text: string): HTMLElement => {
        const node = document.createElement('p');
        node.className = className;
        node.textContent = text;
        return node;
      };
      const stateRow = line('building-state', activityText(view.activity));
      // 四态图与 `activityText` 同源，都是 `view.activity`；图只是把那句话
      // 配上一张同一状态的插画，状态本身仍由文字说清（图坏了不影响读数）。
      appendDecor(stateRow, 'state', activityDecorId(view.activity), 'art-state-icon');
      const rows: HTMLElement[] = [
        line('building-task', taskText(view.task)),
        stateRow,
      ];
      if (view.landing !== null) {
        // 谁提的 + 检查过没过。违规原文照抄账本，不在面板里改写成好听的话。
        const suffix = view.landing.clean
          ? '落地检查通过'
          : `落地检查有问题：${view.landing.violations.join('；')}`;
        rows.push(line('building-landing', `${view.landing.originLabel}提的；${suffix}`));
      }
      rows.push(line('building-trace', traceText(view.traces)));
      if (view.traces.length > 0) {
        const list = document.createElement('ul');
        list.className = 'building-trace-list';
        for (const trace of view.traces) {
          const item = document.createElement('li');
          item.textContent = traceLineText(trace);
          list.append(item);
        }
        rows.push(list);
      }
      // 「没改过名」与「还没登记名字」是两件事：前者说得出「还是原来的名字」，
      // 后者什么都说不出。这里只有前者——`name` 一定有个值才走到这一步。
      rows.push(
        view.history.length === 0
          ? line('building-history', '还没改过名。')
          : (() => {
              const wrap = document.createElement('div');
              wrap.className = 'building-history';
              for (const entry of view.history) {
                const row = document.createElement('p');
                row.textContent = historyLineText(entry);
                wrap.append(row);
              }
              return wrap;
            })(),
      );
      body.replaceChildren(...rows);
      panel.hidden = false;
    });
  });
}
