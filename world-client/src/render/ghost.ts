/** 造物模式的幽灵预览：一块跟着指针走的半透明占地轮廓。
 *
 * 画的是**淡填充 + 实轮廓 + 门口标记**三样，不是「只画轮廓」：填充是 `ink` 0.22，
 * 淡到还能看见下面的人和路，又足以看出自己占了哪些格；轮廓是 1px 的冷/暖实线；
 * 门口是一个 4×4 的色块压一个 2×2 的墨点，标出入口落在哪一侧。
 * （文件头原来写「只画轮廓不画实心：实心会把下面的人和路全盖住」，而 `show` 里
 * 一直有一条 `fillRect`——那句话描述的不是这份代码。已改成现状。）
 *
 * 合法用 `water`（冷），不合法用 `ember`（暖）——冷暖对立比两种暖色好认，
 * 也避免玩家把「橙色」当成「可以」。两色都在 24 色表里，不新增第 25 色。
 *
 * alpha 分两处且用途不同：填充的 0.22 是压暗（让轮廓不抢画面），轮廓线的 0.9
 * 是线的不透明度。这里原来引「ART_SPEC §2.4 的『压暗』一类」——**仓库里从来没有
 * `ART_SPEC` 这个文档**（`git log --all --diff-filter=A -- '*ART_SPEC*'` 全史为空），
 * 那条出处是假的，已删。仓内真实存在的压暗上限在 `docs/adr/ADR_WORLD_ALIVE.md`
 * （时相压暗浓度不超 0.46），但它管的是时相那一层，不是阴影/轮廓这类 alpha，
 * 别混作一谈——所以这里只记现值，不假装有条统一的纪律在管它。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import type { GridPoint, PrefabBlueprint } from '../world/types.ts';
import { WORLD } from '../world/palette-data.ts';

export interface GhostView {
  /** 显示幽灵；`ok` 决定颜色。 */
  show(at: GridPoint, blueprint: PrefabBlueprint, ok: boolean): void;
  hide(): void;
  /** 当前幽灵是否可见。 */
  visible(): boolean;
}

const GHOST_DEPTH = 7900;

export function createGhostView(scene: Phaser.Scene): GhostView {
  const g = scene.add.graphics();
  g.setDepth(GHOST_DEPTH);
  g.setVisible(false);

  return {
    show(at, blueprint, ok) {
      g.clear();
      const x = at.x * TILE_PX;
      const y = at.y * TILE_PX;
      const w = blueprint.footprint.w * TILE_PX;
      const h = blueprint.footprint.h * TILE_PX;
      // 冷暖对立，比「两种暖色」好认：可行是冷色水蓝，不可行是暖色故障橙。
      // 也避开了「橙色=可点」的习惯读法——这里橙色恰恰是「不行」。
      const color = ok ? WORLD.water : WORLD.ember;

      // 淡填充 + 实轮廓 + 门口标记。
      g.fillStyle(WORLD.ink, 0.22);
      g.fillRect(x, y, w, h);
      g.lineStyle(1, color, 0.9);
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // 门口：一个 3px 的缺口标记，告诉玩家入口在哪边。
      const dx = x + blueprint.door.x * TILE_PX + TILE_PX / 2;
      const dy = y + blueprint.door.y * TILE_PX + TILE_PX / 2;
      g.fillStyle(color, 1);
      g.fillRect(dx - 2, dy - 2, 4, 4);
      g.fillStyle(WORLD.ink, 1);
      g.fillRect(dx - 1, dy - 1, 2, 2);

      g.setVisible(true);
    },
    hide() {
      g.clear();
      g.setVisible(false);
    },
    visible() {
      return g.visible;
    },
  };
}
