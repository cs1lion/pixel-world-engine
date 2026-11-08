/** 场景分层的两个邻居 depth，供夹序断言引用（不要在多处再抄字面量）。
 *
 * 分层契约（见 `setting-scenery.ts` 文件头）：
 * - 潮水 `TIDE_DEPTH = 3` 盖住铺装/轨道，退潮只让水退开；
 * - 街面光池 `LAMP_POOL_DEPTH = 3.2` 压在潮水之上、桥与构件之下；
 * - 落地投影 `GROUND_SHADOW_DEPTH = 3.1` **必须严格**夹在两者之间：
 *   `TIDE_DEPTH < GROUND_SHADOW_DEPTH < LAMP_POOL_DEPTH`。
 *
 * 谁调了潮水或光池的 depth，`test/ground-shadow.test.ts` 的夹序断言会先红，
 * 不会等到截图里影子被水盖掉或被光池盖掉才发现。
 */
export const TIDE_DEPTH = 3;
export const LAMP_POOL_DEPTH = 3.2;

/**
 * P2 糊图：压在**地形之上**、痕迹/铺装/潮水/结构**之下**。
 *
 * 这个位置只覆盖地形层，代价与收益都写在 §13.6 里：
 * - 潮位在糊图上面 → 远带水面与岸线是硬的（记录项，S-9 裁决点）；
 * - 建筑 / 摆件 / 轨道 / 人物都在 1000 以上或 0 以上 → 保持清晰，不会被盖掉。
 *
 * 一开始把糊图放在潮水与铺装之间（2.9），结果码头轨道（depth 0）被盖住、
 * 远带里整条轨道消失——「该糊的糊、该在的不能没」，所以让位到地形之上。
 */
export const DOF_DEPTH = -5;
