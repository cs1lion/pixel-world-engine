/** 设定集里的静态像素构件。坐标来自网格，碰撞与潮水仍由世界层决定。
 *
 * 分层是这一层的契约，不是随手调的数值：
 * - 轨道 depth 1：铺在地上，潮水（depth 3）要能盖住它；退潮只让水退开，不删轨道。
 * - 桥 depth 4：桥面在水面之上，人走桥上。
 * - 灯池/灯光 depth 700：在地面之上、建筑与人物之下——光是地面上的亮，不遮挡人。
 * - 建筑构件 depth 1400：叠浪楼的红栏要压在街面人流之前。
 * - 蒸汽 depth 8010：飘在屋顶上方的空气，必须在最前。
 *
 * 一个 Graphics 只有一个 depth，所以不同层的构件不能用同一个对象：
 * 早先共享一张 `statics` 时，最后设置的 depth 会把轨道一起抬到人物前面。
 */
import Phaser from 'phaser';
import type { SettingPack } from '../settings/types.ts';
import { TILE_PX } from '../world/setup.ts';

export interface SettingSceneryView {
  update(level: number, now: number): void;
  destroy(): void;
}

export function createSettingScenery(scene: Phaser.Scene, pack: SettingPack): SettingSceneryView {
  const track = scene.add.graphics().setDepth(1);
  const bridge = scene.add.graphics().setDepth(4);
  const groundLight = scene.add.graphics().setDepth(700);
  const props = scene.add.graphics().setDepth(1050);
  const architecture = scene.add.graphics().setDepth(1400);
  const steam = scene.add.graphics().setDepth(8010);
  const c = pack.palette;

  for (const item of pack.scenery) {
    if (item.kind === 'steam') continue;
    const x = item.at.x * TILE_PX;
    const y = item.at.y * TILE_PX;
    if (item.kind === 'track') {
      // 铁轨画在地面上，潮水盖在其上；退潮不会重铺或删除它。
      for (const dx of [4, 11]) {
        track.fillStyle(c.charcoal, 1);
        track.fillRect(x, y + dx, item.length! * TILE_PX, 2);
      }
      for (let i = 0; i < item.length!; i += 1) {
        track.fillStyle(c.timberDark, 1);
        track.fillRect(x + i * TILE_PX + 2, y + 2, 3, 13);
        if (i % 5 === 0) {
          track.fillStyle(c.grassLit, 0.7);
          track.fillRect(x + i * TILE_PX, y + 12, 6, 3);
        }
      }
    } else if (item.kind === 'lantern') {
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 7, y - 21, 2, 37);
      props.fillRect(x + 4, y - 22, 10, 2);
      props.fillStyle(c.ember, 1);
      props.fillRect(x + 5, y - 19, 7, 10);
      props.fillStyle(c.warmLight, 1);
      props.fillRect(x + 7, y - 17, 3, 6);
      props.fillStyle(c.ink, 1);
      props.fillRect(x + 5, y - 9, 7, 1);
    } else if (item.kind === 'bridge') {
      bridge.fillStyle(c.terracotta, 1);
      bridge.fillRect(x, y, item.length! * TILE_PX, 18);
      bridge.fillStyle(c.timberDark, 1);
      for (let i = 0; i < item.length!; i += 1) bridge.fillRect(x + i * TILE_PX + 2, y, 2, 18);
      bridge.fillStyle(c.ember, 1);
      bridge.fillRect(x, y - 7, item.length! * TILE_PX, 3);
      bridge.fillRect(x, y + 14, item.length! * TILE_PX, 3);
      for (let i = 0; i < item.length!; i += 2) bridge.fillRect(x + i * TILE_PX, y - 8, 3, 26);
    } else if (item.kind === 'sign') {
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 3, y - 15, 3, 31);
      props.fillStyle(c.copper, 1);
      props.fillRect(x - 8, y - 17, 25, 13);
      props.fillStyle(c.trim, 1);
      props.fillRect(x - 3, y - 12, 13, 2);
      props.fillRect(x + 7, y - 14, 2, 6);
    } else if (item.kind === 'debris') {
      props.fillStyle(c.ink, 1);
      props.fillRect(x + 2, y + 5, 13, 7);
      props.fillStyle(c.charcoal, 1);
      props.fillRect(x + 4, y + 3, 8, 7);
      props.fillStyle(c.copper, 0.8);
      props.fillRect(x + 6, y + 4, 2, 5);
    } else if (item.kind === 'stall') {
      // 摊位：矮柜台 + 布棚。柜台压在人腰以下，棚顶高过人头，街面才有前后层次。
      props.fillStyle(c.ink, 1);
      props.fillRect(x - 1, y + 5, 26, 11);
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x, y + 6, 24, 8);
      props.fillStyle(c.terracotta, 1);
      props.fillRect(x + 1, y + 6, 22, 3);
      props.fillStyle(c.trim, 1);
      props.fillRect(x + 2, y + 7, 20, 1);
      // 棚：两根细杆撑起一条布，布边留 1px 缺口，读成被风掀着。
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 2, y - 12, 1, 19);
      props.fillRect(x + 21, y - 12, 1, 19);
      props.fillStyle(c.copper, 1);
      props.fillRect(x - 2, y - 14, 29, 4);
      props.fillStyle(c.pale, 0.85);
      props.fillRect(x - 1, y - 13, 27, 1);
      props.fillStyle(c.ember, 1);
      props.fillRect(x - 2, y - 11, 29, 1);
    } else if (item.kind === 'banner') {
      // 幌布：斜挑一根杆，两幅布长短不一，避免整条街变成同一种竖线。
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 6, y - 26, 1, 28);
      props.fillRect(x + 6, y - 26, 9, 1);
      props.fillStyle(c.ember, 1);
      props.fillRect(x + 8, y - 25, 6, 11);
      props.fillStyle(c.trim, 1);
      props.fillRect(x + 8, y - 25, 6, 1);
      props.fillStyle(c.pale, 1);
      props.fillRect(x + 9, y - 21, 3, 1);
      props.fillStyle(c.terracotta, 1);
      props.fillRect(x + 15, y - 25, 4, 8);
    } else if (item.kind === 'statue') {
      props.fillStyle(c.stone, 1);
      props.fillRect(x, y + 8, 16, 8);
      props.fillRect(x + 4, y - 3, 8, 12);
      props.fillStyle(c.plaza, 1);
      props.fillRect(x + 5, y - 2, 3, 8);
      props.fillStyle(c.water, 1);
      props.fillRect(x + 2, y + 4, 12, 2);
    }
  }

  // 叠浪楼的红栏与逐层窗火独立于通用建筑轮廓，避免它被当成另一栋普通小屋。
  const hall = pack.placements.find((p) => p.prefabId === 'wave_house');
  if (hall !== undefined) {
    const x = hall.at.x * TILE_PX;
    const y = hall.at.y * TILE_PX;
    architecture.fillStyle(c.terracotta, 1);
    for (const dy of [23, 44, 65]) {
      architecture.fillRect(x - 3, y + dy, 118, 3);
      for (let i = 0; i < 8; i += 1) architecture.fillRect(x + i * 15, y + dy, 2, 10);
    }
  }

  return {
    update(level, now) {
      groundLight.clear();
      steam.clear();
      for (const item of pack.scenery) {
        const x = item.at.x * TILE_PX;
        const y = item.at.y * TILE_PX;
        if (item.kind === 'lantern') {
          // 灯油越足，地上那团光越亮；灯油只是画面，不影响潮汐或通行。
          groundLight.fillStyle(c.amber, 0.07 + level * 0.03);
          groundLight.fillRect(x - 6, y - 5, 28, 14);
        } else if (item.kind === 'steam') {
          const drift = Math.floor(now / 300 + item.at.x) % 9;
          steam.fillStyle(c.pale, 0.14);
          steam.fillRect(x + drift, y - 24, 7, 9);
          steam.fillRect(x + 6 + drift, y - 36, 10, 8);
          steam.fillStyle(c.deepShade, 0.15);
          steam.fillRect(x + 1 + drift, y - 15, 10, 6);
        }
      }
    },
    destroy() {
      for (const layer of [track, bridge, groundLight, props, architecture, steam]) layer.destroy();
    },
  };
}
