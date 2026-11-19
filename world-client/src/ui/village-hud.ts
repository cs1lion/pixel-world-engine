/** 左上角「时钟天气牌 + 村民头像条」。
 *
 * 原来左上角什么都没有：时辰天气埋在报纸抬头与维护条里，村民要逐个点开
 * 大面板才看得到她在干嘛。这块把两样都收进一格：牌上说「现在几点、什么天」，
 * 条上每人一个头像，头像角上一枚极简状态微标（躲雨 / 行礼 / 劳作 / 睡觉）。
 *
 * 三条纪律，与这个仓库一贯的相同：
 *
 * 1. **中文不进 canvas**（SPEC §4.8）：这是 DOM 覆盖层，摆在 `#stage` 左上角，
 *    与右上角的小地图同一套位置语言。
 * 2. **不碰仿真**：只读 `Oracle.view()` 的快照；点击头像只是把镜头飞过去 /
 *    锁过去（场景已有的 `panTo` / `follow`），世界不因看而变。
 * 3. **`?art=0` 下一张图都不请求**：头像就是名字的第一个字，不挂任何素材；
 *    装饰图那条路（`appendDecor`）这里不走。
 *
 * 微标只认快照里真有的读数：`mode` 与作息牌子 `routine`。没有「睡觉」这个
 * mode——睡是她 idle 时牌子上那句「…睡下了」，所以判据读牌子文字，不自己
 * 编一个状态出来。
 */

import type { VillagerMode, VillagerSnapshot, Weather, WorldSnapshot } from '../world/types.ts';
import { formatBoundaryClock } from '../world/clock-alignment.ts';
import { WEATHER_LABEL } from '../world/weather.ts';
import { DAY_MS } from '../world/memory/config.ts';
import { whenApi } from './when-api.ts';

/** 头像角上那枚小标说的话。`null` 是「此刻没有值得说的状态」，不硬凑一枚。 */
export type MicroBadge = '躲雨' | '行礼' | '劳作' | '睡觉';

/** 头像条至多几人。世界人多也只收这一条，多了就读不动了。 */
export const VILLAGER_STRIP_MAX = 7;

/** 赶路四支 + 干活 + 交付：她在为这件镇子办事，读作「劳作」。 */
const BUSY_MODES: ReadonlySet<VillagerMode> = new Set([
  'working',
  'toWork',
  'delivering',
  'toAltar',
  'bearingDecree',
]);

/**
 * 她这会儿的微标。四种话都从快照里读得出来，一句不编：
 *
 * - `sheltering` → 躲雨：世界状态就是「跑向屋檐下躲雨」（`villager-words.ts`）。
 * - `saluting` → 行礼：同上，「正向神谕行礼」。
 * - 赶路/干活/交付四支 → 劳作：她在办事，不管办的是哪一件。
 * - `idle` 且牌子上写着「睡」→ 睡觉：睡不是 mode，是作息牌子上那句话
 *   （疲劳就地睡「就地睡下了」、定时夜休「在祭坛边睡下了」都含这个字）。
 *
 * 其余（白天闲着）没有微标：没事可说就不说，条上只摆名字。
 */
export function microBadgeFor(
  villager: VillagerSnapshot,
): MicroBadge | null {
  if (villager.mode === 'sheltering') return '躲雨';
  if (villager.mode === 'saluting') return '行礼';
  if (BUSY_MODES.has(villager.mode)) return '劳作';
  if (villager.mode === 'idle' && villager.routine !== null && villager.routine.includes('睡')) {
    return '睡觉';
  }
  return null;
}

export interface ClockWeather {
  /** 世界第几天，从 0 起（与 `dayLabel` / 日历抽屉同一口径）。 */
  readonly day: number;
  /** 世界一天内的此刻，`HH:MM`。 */
  readonly clock: string;
  /** 天气的人话（晴 / 雨 / 暴雨 / 雾）。 */
  readonly weather: string;
}

/**
 * 时钟天气牌上那一行。时辰取世界毫秒（`snapshot.now`），不读墙钟——
 * 世界自己的钟，与真实时间几点了无关。
 */
export function clockWeatherOf(snapshot: {
  readonly now: number;
  readonly weather: Weather;
}): ClockWeather {
  const now = Math.max(0, snapshot.now);
  return {
    day: Math.floor(now / DAY_MS),
    clock: formatBoundaryClock(now % DAY_MS),
    weather: WEATHER_LABEL[snapshot.weather],
  };
}

/** 牌上那句完整的话：「第 3 天 · 14:05 · 雨」。 */
export function clockWeatherLine(reading: ClockWeather): string {
  return `第 ${reading.day} 天 · ${reading.clock} · ${reading.weather}`;
}

export interface StripItem {
  readonly id: string;
  readonly name: string;
  readonly badge: MicroBadge | null;
  /** 不在画面上的人不踢出条上，只压暗——她可能只是走到雾里了。 */
  readonly visible: boolean;
}

/**
 * 头像条要摆的人：按 id 排（稳定，不随快照顺序晃），至多 `VILLAGER_STRIP_MAX` 人。
 */
export function stripItems(snapshot: WorldSnapshot): readonly StripItem[] {
  return [...snapshot.villagers]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, VILLAGER_STRIP_MAX)
    .map((villager) => ({
      id: villager.id,
      name: villager.name,
      badge: microBadgeFor(villager),
      visible: villager.visible,
    }));
}

/** 头像条要的那几样场景能力。场景已有的口子直接接，不另造。 */
export interface VillageHudOracle {
  readonly view: () => WorldSnapshot;
  /** 平滑飞到某人脚下（不锁镜头、不开面板）。 */
  readonly flyToVillager: (villagerId: string) => void;
  /** 镜头锁住某人（场景的 `follow`）。 */
  readonly followVillager: (villagerId: string) => void;
  /** 松开跟随，但记住跟的是谁（相机自己的 `releaseFollow`）。 */
  readonly releaseCameraFollow: () => void;
  readonly onStatus: (listener: (line: string) => void) => () => void;
}

export interface VillageHudOptions {
  /** 每秒刷一次牌子（时辰在走）。测试可以注一个立刻执行的。 */
  readonly tick?: (fn: () => void) => () => void;
}

/**
 * 头像条的选择状态：点过谁、锁了谁。
 * 「再次点击」与「跟随」按钮是同一件事的两条路，所以状态只有这三个值。
 */
export interface VillageSelection {
  readonly selectedId: string | null;
  readonly followingId: string | null;
}

/**
 * 点一个头像时的状态机。纯函数，好测：
 *
 * - 跟着谁点她 → 松开（再点一下就是「别跟了」）。
 * - 选中的人再点一次 → 锁住她。
 * - 点别人 → 飞过去看，不锁。
 */
export function nextSelection(
  current: VillageSelection,
  clickedId: string,
): VillageSelection {
  if (current.followingId === clickedId) {
    return { selectedId: clickedId, followingId: null };
  }
  if (current.selectedId === clickedId) {
    return { selectedId: clickedId, followingId: clickedId };
  }
  return { selectedId: clickedId, followingId: null };
}

export function bindVillageHud(
  getApi: () => VillageHudOracle | undefined,
  options: VillageHudOptions = {},
): void {
  const host = document.querySelector<HTMLElement>('#village-hud');
  const chip = document.querySelector<HTMLElement>('#village-clock');
  const strip = document.querySelector<HTMLElement>('#village-strip');
  const follow = document.querySelector<HTMLButtonElement>('#village-follow');
  if (host === null || chip === null || strip === null) return;

  const tick = options.tick ?? ((fn: () => void) => {
    const timer = window.setInterval(fn, 1000);
    return () => window.clearInterval(timer);
  });

  let selection: VillageSelection = { selectedId: null, followingId: null };
  /** 上一次摆出来的人的 id 串；没变就不重排按钮（保住焦点与按压态）。 */
  let builtIds = '';
  const avatarButtons = new Map<string, HTMLButtonElement>();
  /** 徽章节点与头像一一对应，单独记一份：假 DOM 上没有实例级 `querySelector`。 */
  const avatarBadges = new Map<string, HTMLElement>();

  const act = (id: string): void => {
    const api = getApi();
    if (api === undefined) return;
    const was = selection;
    selection = nextSelection(selection, id);
    if (selection.followingId === id) {
      api.followVillager(id);
    } else if (was.followingId === id && selection.followingId === null) {
      // 跟着她时再点一下：松开跟随（相机记住她，下次「跟随」还能接上）。
      api.releaseCameraFollow();
    } else {
      api.flyToVillager(id);
    }
    paint(api);
  };

  const paint = (api: VillageHudOracle): void => {
    const snapshot = api.view();
    const reading = clockWeatherOf(snapshot);
    chip.textContent = clockWeatherLine(reading);

    const items = stripItems(snapshot);
    const ids = items.map((item) => item.id).join(',');
    if (ids !== builtIds) {
      builtIds = ids;
      strip.replaceChildren();
      avatarButtons.clear();
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'village-avatar';
        button.dataset.villagerId = item.id;
        button.title = item.name;
        // 头像就是名字的第一个字：没有素材可挂（`?art=0`），也不该挂——
        // 这条栏的价值是「一眼扫到谁在哪」，不是再来一套立绘。
        const face = document.createElement('span');
        face.className = 'village-avatar-face';
        face.textContent = item.name.slice(0, 1);
        const badge = document.createElement('span');
        badge.className = 'village-avatar-badge';
        button.append(face, badge);
        button.addEventListener('click', () => act(item.id));
        strip.append(button);
        avatarButtons.set(item.id, button);
        avatarBadges.set(item.id, badge);
      }
    }
    for (const item of items) {
      const button = avatarButtons.get(item.id);
      const badge = avatarBadges.get(item.id);
      if (button === undefined || badge === undefined) continue;
      button.classList.toggle('away', !item.visible);
      button.classList.toggle('selected', selection.selectedId === item.id);
      button.classList.toggle('following', selection.followingId === item.id);
      button.setAttribute('aria-pressed', String(selection.followingId === item.id));
      badge.textContent = item.badge ?? '';
      badge.hidden = item.badge === null;
    }

    if (follow !== null) {
      const canFollow = selection.selectedId !== null;
      follow.disabled = !canFollow;
      const locked = selection.followingId !== null;
      follow.textContent = locked ? '松开跟随' : '跟随';
      follow.setAttribute('aria-pressed', String(locked));
    }
  };

  follow?.addEventListener('click', () => {
    const api = getApi();
    if (api === undefined || selection.selectedId === null) return;
    if (selection.followingId === selection.selectedId) {
      api.releaseCameraFollow();
      selection = { selectedId: selection.selectedId, followingId: null };
    } else {
      api.followVillager(selection.selectedId);
      selection = { selectedId: selection.selectedId, followingId: selection.selectedId };
    }
    paint(api);
  });

  whenApi(getApi as () => VillageHudOracle | undefined, (api) => {
    api.onStatus(() => paint(api));
    paint(api);
  }, {
    onGiveUp: () => {
      // 世界没醒来就不摆空牌子：那一行留白，比写一句兑不了的话好。
      chip.textContent = '';
    },
  });

  tick(() => {
    const api = getApi();
    if (api !== undefined) paint(api);
  });
}
