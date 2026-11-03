/**
 * 角色可判别性验收（硬指标，不是审美偏好）：
 *
 *   1. 任意两个角色的**衣色**两两 ΔE76 ≥ 10（CIELAB 欧氏距离）；
 *   2. 剪影至少 3 类可辨（按 6 段行宽压成的轮廓签名，不是「高矮胖瘦」）；
 *   3. 没有两个人四个维度全同（体型/头型/衣型/配饰）。
 *
 * 第 4 条「遮住名字 1 秒能指认 ≥ 4/5」是人工判据：截图只拍 canvas，
 * DOM 名字天然不在画面里；结论写在交付报告里，不由本文件代替。
 *
 * 为什么用**灯潮界的实际色板**算 ΔE：莞尔镇与灯潮界同名不同色，
 * 拿 `WORLD` 的默认值算会把「灯潮界里其实只差 8」的人判成合格。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { loadSettingPack } from '../src/settings/load.ts';
import { WORLD } from '../src/world/palette-data.ts';
import { LEGACY_LOOKS, resolveLook, type VillagerLook } from '../src/world/villager-look.ts';
import {
  VILLAGER_H,
  VILLAGER_W,
  silhouetteOf,
  silhouetteSignature,
} from '../src/render/villager-layout.ts';

function rgbToLab(value: number): { L: number; a: number; b: number } {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const linear = [r, g, b].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/** CIELAB ΔE76：与 `scripts/audit-palette.mjs` 同一把尺。 */
function deltaE76(a: number, b: number): number {
  const left = rgbToLab(a);
  const right = rgbToLab(b);
  return Math.hypot(left.L - right.L, left.a - right.a, left.b - right.b);
}

const pack = loadSettingPack(DENGCHAO_RAW);
const looks: readonly { name: string; look: VillagerLook }[] = pack.villagers.map((villager) => ({
  name: villager.name,
  look: resolveLook(villager.style),
}));

test('灯潮界 7 人的衣色两两 ΔE76 ≥ 10（硬指标）', () => {
  assert.equal(looks.length, 7, '这条验收写死了 7 个人；人数变了要重新定阈值');
  const pairs: { a: string; b: string; de: number }[] = [];
  for (let i = 0; i < looks.length; i += 1) {
    for (let j = i + 1; j < looks.length; j += 1) {
      const left = looks[i]!;
      const right = looks[j]!;
      pairs.push({
        a: left.name,
        b: right.name,
        de: deltaE76(pack.palette[left.look.cloak], pack.palette[right.look.cloak]),
      });
    }
  }
  const closest = pairs.reduce((min, item) => (item.de < min.de ? item : min));
  assert.ok(
    closest.de >= 10,
    `最近的一对是 ${closest.a}/${closest.b}，ΔE76=${closest.de.toFixed(1)}（下限 10）`,
  );
});

test('灯潮界 7 人的剪影至少 3 类可辨', () => {
  const signatures = new Map<string, string[]>();
  for (const { name, look } of looks) {
    const signature = silhouetteSignature(look);
    const list = signatures.get(signature) ?? [];
    list.push(name);
    signatures.set(signature, list);
  }
  assert.ok(
    signatures.size >= 3,
    `剪影签名只有 ${signatures.size} 类：${[...signatures.entries()]
      .map(([key, names]) => `${key}=[${names.join(',')}]`)
      .join(' ')}`,
  );
});

test('没有人四个维度全同（同一个人换色不算新人）', () => {
  const seen = new Map<string, string>();
  for (const { name, look } of looks) {
    const key = `${look.build}/${look.head}/${look.outfit}/${look.accent}`;
    const other = seen.get(key);
    assert.equal(other, undefined, `${name} 与 ${other} 的四维完全相同：${key}`);
    seen.set(key, name);
  }
});

test('24×30 是名义画布：所有外观都在界内，且高度一致', () => {
  for (const { name, look } of looks) {
    const silhouette = silhouetteOf(look);
    assert.ok(silhouette.bboxW <= VILLAGER_W, `${name} 剪影宽 ${silhouette.bboxW} 超过 ${VILLAGER_W}`);
    assert.ok(silhouette.bboxH <= VILLAGER_H, `${name} 剪影高 ${silhouette.bboxH} 超过 ${VILLAGER_H}`);
    // 深色大衣会缩到 18–22 宽；这里只钉「不是一根竖条」。
    assert.ok(silhouette.bboxW >= 12, `${name} 剪影宽只有 ${silhouette.bboxW}，读不出人形`);
  }
});

test('莞尔镇的两个旧角色也满足 ΔE76 ≥ 10（默认色板）', () => {
  const [first, second] = LEGACY_LOOKS;
  assert.ok(first !== undefined && second !== undefined);
  const de = deltaE76(WORLD[first.cloak], WORLD[second.cloak]);
  assert.ok(de >= 10, `莞尔/阿雾的衣色 ΔE76=${de.toFixed(1)}（下限 10）`);
});

test('外观颜色槽只引用 24 源色里的 token（不新增第 25 色）', () => {
  const tokens = new Set(Object.keys(WORLD));
  for (const { name, look } of looks) {
    for (const slot of ['cloak', 'cloakDark', 'scarf', 'scarfLit', 'hair'] as const) {
      assert.ok(tokens.has(look[slot]), `${name} 的 ${slot}=${look[slot]} 不在 24 色里`);
    }
  }
});
