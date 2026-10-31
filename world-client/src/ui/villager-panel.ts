/** 点一个村民，她说她记得的事。
 *
 * 读侧的最后一段路：场景用 `recallForDialogue` 捞出 Top-3（不调模型、不改世界），
 * 这里只负责摆出来。文字全走 DOM（D5-A），canvas 里一个字不加。
 *
 * **这不是对话系统。** 没有模型参与，也没有性格与关系的口吻——世界里这两样
 * 东西都还没有。这里做的是「把她记得的那句摆出来」，不假装她会说话。
 */

import type { MemoryLine } from '../world/memory/voice.ts';
import { whenApi } from './when-api.ts';

export interface VillagerMemoryView {
  readonly id: string;
  readonly name: string;
  /** 她此刻想得起的事，检索顺序。空数组是常态，不是错误。 */
  readonly lines: readonly MemoryLine[];
}

export interface VillagerOracle {
  readonly lookAtVillager: (villagerId: string) => void;
  /** `null` 是收起：镜头不再跟着她，屏幕上也就不该还摆着她的记忆。 */
  readonly onVillagerMemory: (listener: (view: VillagerMemoryView | null) => void) => () => void;
  /** 面板收起：松开跟随（但记住跟的是谁，「跟随」按钮还要用）。 */
  readonly dismissVillager: () => void;
}

export function bindVillagerPanel(getApi: () => VillagerOracle | undefined): void {
  const panel = document.querySelector<HTMLElement>('#villager-panel');
  const title = document.querySelector<HTMLElement>('#villager-panel-name');
  const body = document.querySelector<HTMLElement>('#villager-panel-body');
  const close = document.querySelector<HTMLButtonElement>('#villager-panel-close');
  if (panel === null || title === null || body === null) return;

  const dismiss = (): void => {
    panel.hidden = true;
    getApi()?.dismissVillager();
  };

  close?.addEventListener('click', dismiss);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    dismiss();
  });

  whenApi(getApi, (api) => {
    api.onVillagerMemory((view) => {
      if (view === null) {
        panel.hidden = true;
        return;
      }
      title.textContent = view.name;
      if (view.lines.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'villager-empty';
        // 空不是错：她可能刚到，也可能这一整天都在走路。照实说。
        // 不说「今天」——她可能只是没有一条能捞回来的记忆，那不是今天的错。
        empty.textContent = '她这会儿想不起什么。';
        body.replaceChildren(empty);
      } else {
        body.replaceChildren(
          ...view.lines.map((line) => {
            const quote = document.createElement('blockquote');
            quote.textContent = line.text;
            const when = document.createElement('span');
            when.className = 'villager-when';
            when.textContent = line.age;
            quote.append(when);
            return quote;
          }),
        );
      }
      panel.hidden = false;
    });
  });
}
