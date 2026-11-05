/** 建筑三层深度的算术：纯函数，不碰 Phaser，可在 Node 里直接验算。
 *
 * 为什么单独一个文件
 * ------------------
 * `buildings.ts` import 了 Phaser，Node 里跑不起来，于是这套遮挡算术在提交时
 * **没有任何回归保护** —— 当时那 15 项断言是临时的、没入库。QA 指出这是真问题。
 * 这里把算术抽出来，`building-depth.test.ts` 就能直接锁住它。
 *
 * 角色一侧的口径（`villager.ts` 的 `villagerDepthAt`）：
 * `depth = ALTITUDE + 脚底 + 8`，其中 `脚底 = (pos.y + 1) * TILE_PX`。
 * 抽成 `actorDepthAt` 是为了能在 Node 里验算，那边怎么算仍以 `villager.ts` 为准——
 * 改一处必须改两处。
 *
 * （这里原来写着两个行号，指的是同一行代码。它们在 2026-10-27 我往
 * `villager.ts` 文件头加了一段说明之后集体失效——那行现在在更下面，
 * 而行号引用审计查不出来，因为它仍然"有代码"，只是不再是那一行。
 * 所以改成指名那行代码长什么样。）
 */

import { TILE_PX } from '../world/setup.ts';

/** 角色 depth 的偏移量，与 villager.ts 保持一致。改一处必须改两处。 */
export const ACTOR_DEPTH_OFFSET = 8;

/**
 * 各层相对建筑落地线 baseY 的像素偏移。front 的推导见下方 frontOffset 说明。
 *
 * `decal`（墙上的痕迹）取 16：在楼体（0）之后、站在门口的人（+24）之前——
 * 痕迹是墙的一部分，人走过去该挡住它。这一层不动其余三个数。
 */
export const BUILDING_DEPTH = { back: -2, body: 0, decal: 16, front: 32 } as const;

/** 建筑落地线：占地底边的世界 y。 */
export function buildingBaseY(originY: number, footprintH: number): number {
  return originY + footprintH * TILE_PX;
}

/** 角色站在某个格子上时的 depth。 */
export function actorDepthAt(gridY: number, altitude: number): number {
  return altitude + (gridY + 1) * TILE_PX + ACTOR_DEPTH_OFFSET;
}

/** 建筑某一层的 depth。 */
export function layerDepth(
  layer: keyof typeof BUILDING_DEPTH,
  baseY: number,
  altitude: number,
): number {
  return altitude + baseY + BUILDING_DEPTH[layer];
}

/**
 * front 为什么取 32
 * -----------------
 * 门口格恒在占地底边**下一行**（prefabs.json 里 `door.y === footprint.h`），所以：
 *
 *   baseY            = door.y * 16                  ← 门口格的上边
 *   站门口的角色      = baseY + 16 + 8 = baseY + 24
 *   门口下 1 格的角色 = baseY + 32 + 8 = baseY + 40
 *
 * 要让前檐压住站门口的人，需要 `front > baseY + 24`；同时不压到再下一格的人，
 * 需要 `front < baseY + 40`。取区间中点 **+32**。
 *
 * （这里原来写「而不是美术文档 §1.3 写的 12」，末了还有一句「文档的 +12 落在
 * baseY+12 < baseY+24」。那个出处不在仓里，git 全史也查不到 `front: 12`
 * 或任何一份写着 12 的美术文档——**这个数在本仓没有痕迹**，拿它当对立面
 * 等于给一句查无实据的话背书。上面的推导不依赖它：区间、端点、中点都从
 * prefabs.json 的几何算得出来。所以只留推导，删出处。）
 */
export const FRONT_OFFSET_MIN_EXCLUSIVE = 24;
export const FRONT_OFFSET_MAX_EXCLUSIVE = 40;
