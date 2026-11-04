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
