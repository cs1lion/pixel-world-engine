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
