/** 调试摆位：把某几个村民的**画面位置**钉在固定格上。
 *
 * 只改这一帧要画的东西，不写 `Simulation`：世界里的路线、作息、存档都不动。
 * 用途是让「站在摊位后应被挡住、站在摊位前应盖住」这条判据有一张**可复现**
 * 的截图——冻结帧里没有人的路线正好走到那一格，就只能摆一个上去看。
 *
 * 名字与气泡跟身体一起走：overlay 读的是同一份快照，所以这里连
 * `visible` 一起改，避免出现「人搬了、名字还留在原地」。
 */

import type { Vec2, VillagerSnapshot, WorldSnapshot } from '../world/types.ts';

export type VillagerPins = ReadonlyMap<string, Vec2>;

export function pinVillagers(snapshot: WorldSnapshot, pins: VillagerPins): WorldSnapshot {
  if (pins.size === 0) return snapshot;
  let changed = false;
  const villagers = snapshot.villagers.map((villager) => {
    const pin = pins.get(villager.id);
    if (pin === undefined) return villager;
    changed = true;
    const moved: VillagerSnapshot = { ...villager, pos: pin, visible: true };
    return moved;
  });
  if (!changed) return snapshot;
  return {
    ...snapshot,
    villagers,
    // 兼容字段必须与 villagers[0] 对齐：旧调用方读的是这一条。
    villager: villagers[0] ?? snapshot.villager,
  };
}
