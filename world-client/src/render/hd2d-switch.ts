/** HD-2D 两条表现层开关的唯一解析点（`?hd2d=` / `?dof=`）。
 *
 * 缺省是 `off`：不写参数、写 `off`、写任何别的值都当关。只有 `on` / `1` 算开。
 * 这条不是「默认开、留个后门」——166 张基线是平面世界的既有事实，
 * 这一轮的新表现必须**先证明关掉时一个像素都不动**，才有资格谈打开。
 *
 * 纯函数：不读时钟、不碰 DOM、不 import Phaser。
 */

/** 高度层（台地遮挡）的 URL 参数名。 */
export const HD2D_QUERY = 'hd2d';
/** 远景移轴的 URL 参数名。 */
export const DOF_QUERY = 'dof';
/** 遮挡条子开关：只在 `?hd2d=on` 下有意义。 */
export const OCCLUDERS_QUERY = 'occluders';

function switchOf(search: string | URLSearchParams, key: string): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get(key);
  return value === 'on' || value === '1';
}

/** `?hd2d=on|1` 才开；缺省关闭。 */
export function hd2dEnabledOf(search: string | URLSearchParams): boolean {
  return switchOf(search, HD2D_QUERY);
}

/** `?dof=on|1` 才开；缺省关闭。 */
export function dofEnabledOf(search: string | URLSearchParams): boolean {
  return switchOf(search, DOF_QUERY);
}

/**
 * 遮挡条是否出。**只有 `?hd2d=on` 且没写 `?occluders=off|0` 时才出。**
 *
 * 存在的理由：O1 的正反判据要在同一世界上取「条在 / 条不在」两帧——条不在时
 * 北侧人的腿必须露出来（>0px）。它不是独立开关：`hd2d` 关着时这个参数没有任何
 * 作用，所以单独 `?occluders=on` 不能把高度层带进来。
 */
export function occludersEnabledOf(search: string | URLSearchParams): boolean {
  if (!hd2dEnabledOf(search)) return false;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get(OCCLUDERS_QUERY);
  return value !== 'off' && value !== '0';
}
