/** 点一个村民，她说她记得的事。
 *
 * 读侧的最后一段路：场景用 `recallForDialogue` 捞出 Top-3（不调模型、不改世界），
 * 这里只负责摆出来。文字全走 DOM（D5-A），canvas 里一个字不加。
 *
 * **这不是对话系统。** 没有模型参与，也没有性格与关系的口吻——世界里这两样
 * 东西都还没有。这里做的是「把她记得的那句摆出来」，不假装她会说话。
 */

import type { HeardFrom, MemoryLine } from '../world/memory/voice.ts';
import { emoteIdFor, villagerBadgeId } from '../render/art-assets.ts';
import { appendDecor } from './art-decor.ts';
import { whenApi } from './when-api.ts';

/**
 * 「从谁听来」那一行。不是听来的就没有这一行。
 *
 * 三种说法，各有各的实话：
 *
 * - 查得到人 → 「从炉匠听来」。
 * - 听来了，可那个人查不到 → 「从一个不在这张图上的人听来」。**不显示裸 id**：
 *   楼会被拆、人可能不在场，那些都是真实状态，而一串内部编号糊在屏幕上
 *   既不是名字也不是状态。
 * - 没有具体的人（碑文）→ 「镇上的人都这么说」。这一句说的是世界里的事实：
 *   碑文本来就是「大家都这么说」，不是某一个人告诉她的。
 */
export function heardFromText(from: HeardFrom): string {
  if (from.kind === 'everyone') return '镇上的人都这么说';
  return from.name === null ? '从一个不在这张图上的人听来' : `从${from.name}听来`;
}

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
      // 先写名字再挂图：给 textContent 赋值会清掉上次留下的子节点，
      // 顺序反了徽记就只闪一帧。
      title.textContent = view.name;
      appendDecor(title, 'icon', villagerBadgeId(view.id), 'art-badge');
      if (view.lines.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'villager-empty';
        // 空不是错：她可能刚到，也可能这一整天都在走路。照实说。
        // 不说「今天」——她可能只是没有一条能捞回来的记忆，那不是今天的错。
        empty.textContent = '她这会儿想不起什么。';
        body.replaceChildren(empty);
      } else {
        body.replaceChildren(
          ...view.lines.map((line, index) => {
            const quote = document.createElement('blockquote');
            quote.textContent = line.text;
            const when = document.createElement('span');
            when.className = 'villager-when';
            // 「从谁听来」排在时刻前面：先问这话是谁说的，再问什么时候的事。
            when.textContent =
              line.heardFrom === null
                ? line.age
                : `${heardFromText(line.heardFrom)} · ${line.age}`;
            quote.append(when);
            // 表情按序轮转，只作装饰：不是「这句话的情绪」，世界没有这个读数。
            // 挂在 when 之后，引文原来的子节点顺序一个不动。
            appendDecor(quote, 'emote', emoteIdFor(index), 'art-emote');
            return quote;
          }),
        );
      }
      panel.hidden = false;
    });
  });
}
