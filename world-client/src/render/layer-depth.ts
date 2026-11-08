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
 * P2 糊图：压在**整条贴地带之上**（地形 / 痕迹 / 铺装 / 铁轨 / 桥 / 渡口木栈与船 /
 * 滩涂补绘），**人物与立体构件之下**（`ALTITUDE = 1000` 起）。
 *
 * 为什么不更高：糊图要盖住原件才看得见，所以 depth 必须高于闭包里的所有层；
 * 而人物与建筑的 depth 是按落地行逐行交错的（`sceneryDepth` / `villagerDepthAt`），
 * 一张平面图不可能同时压在建筑上、又垫在人物下。上界因此钉在 1000 之下——
 * 立体构件（摊位 / 楼 / 立面补绘）留在 S-4 未闭合项里，不冒充已解决。
 *
 * 早先放在 -5：只糊地形，远带里木栈、栏杆、船全是锐边，读成「水变柔了」而不是
 * 景深。往上抬到 999 后这些贴地结构一起进闭包，原件被糊图盖住，不再需要 mask
 * （Phaser 4 的 WebGL 后端本来也不支持 GeometryMask）。
 */
export const DOF_DEPTH = 999;
