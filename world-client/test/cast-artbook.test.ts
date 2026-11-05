/**
 * 设定集形象的验收：五个主要人物必须同时满足
 *   - 24×30 分层外观能分开（衣色 ΔE76、剪影签名、四维不重）；
 *   - 每人有一份完整档案，且档案只走 `genesis` / `read` 的记忆边界；
 *   - 开局注入是幂等的，不生成目击、断言或痕迹。
 *
 * 「1 秒遮名」是自动判据：五人三向剪影两两比 IoU + 行/列投影 + 头肩比，
 * 同向任意两人相似度必须低于 `MAX_SILHOUETTE_SIMILARITY`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENGCHAO_CAST_ARTBOOK, DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { Simulation } from '../src/world/simulation.ts';
import { buildUnitStatus } from '../src/ui/unit-status.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { resolveLook, type VillagerLook } from '../src/world/villager-look.ts';
import { silhouetteSignature } from '../src/render/villager-layout.ts';
import { facingSilhouettes, pairwiseSilhouettes } from '../src/render/silhouette-match.ts';

const MAIN = ['迷路人', '汐', '炉匠', '沉灯夫人', '灯笼头'] as const;
/** 合成相似度上限：≥此值视为「同一剪影」。实测最坏 0.775（迷路人/汐、迷路人/沉灯夫人，同向）。 */
const MAX_SILHOUETTE_SIMILARITY = 0.85;
/**
 * 同一人正/侧/背的区间：下限证明「三向还是同一个人」（不能全像换了个人），
 * 上限证明「三向确实不同」（不能只换脸换发、外轮廓一模一样）。
 * 实测最像的一对是同人：汐 正/背 0.884；最低是炉匠 正/侧 0.772。
 */
const SAME_PERSON_MIN = 0.6;
const SAME_PERSON_MAX = 0.9;
const pack = loadSettingPack(DENGCHAO_RAW);

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

function deltaE76(a: number, b: number): number {
  const left = rgbToLab(a);
  const right = rgbToLab(b);
  return Math.hypot(left.L - right.L, left.a - right.a, left.b - right.b);
}

const mainLooks: readonly { name: string; look: VillagerLook }[] = MAIN.map((name) => {
  const villager = pack.villagers.find((item) => item.name === name);
  assert.ok(villager !== undefined, `缺少主要人物 ${name}`);
  return { name, look: resolveLook(villager.style) };
});

test('五个主要人物都有设定集页码与完整档案', () => {
  for (const name of MAIN) {
    assert.ok(DENGCHAO_CAST_ARTBOOK[name] !== undefined, `${name} 没有设定集页码`);
    const villager = pack.villagers.find((item) => item.name === name);
    assert.ok(villager?.archive !== undefined, `${name} 没有档案`);
    assert.equal(villager.archive.bonds.length, 2, `${name} 的关系初值不是 2 段`);
    const targets = villager.archive.bonds.map((bond) => bond.to);
    for (const target of targets) {
      assert.ok(pack.villagers.some((item) => item.name === target), `${name} 的关系指向不存在的 ${target}`);
    }
  }
});

test('五个主要人物的衣色两两 ΔE76 ≥ 10', () => {
  const pairs: { a: string; b: string; de: number }[] = [];
  for (let i = 0; i < mainLooks.length; i += 1) {
    for (let j = i + 1; j < mainLooks.length; j += 1) {
      const left = mainLooks[i]!;
      const right = mainLooks[j]!;
      pairs.push({
        a: left.name,
        b: right.name,
        de: deltaE76(pack.palette[left.look.cloak], pack.palette[right.look.cloak]),
      });
    }
  }
  const closest = pairs.reduce((min, item) => (item.de < min.de ? item : min));
  assert.ok(closest.de >= 10, `最近的一对是 ${closest.a}/${closest.b}，ΔE76=${closest.de.toFixed(1)}`);
});

test('五个主要人物的剪影至少 3 类，且四维不重', () => {
  const signatures = new Set(mainLooks.map(({ look }) => silhouetteSignature(look)));
  assert.ok(signatures.size >= 3, `五个主要人物的剪影只有 ${signatures.size} 类`);
  const seen = new Set(mainLooks.map(({ look }) => `${look.build}/${look.head}/${look.outfit}/${look.accent}`));
  assert.equal(seen.size, mainLooks.length, '主要人物有四维全同的');
});

test('五个主要人物是五类不同剪影，且同向两两相似度 < 0.85', () => {
  const signatures = new Set(mainLooks.map(({ look }) => silhouetteSignature(look)));
  assert.equal(signatures.size, mainLooks.length, `剪影只有 ${signatures.size} 类：${[...signatures].join(' / ')}`);
  const pairs = pairwiseSilhouettes(mainLooks);
  assert.equal(pairs.length, 30, '五人 × 三向应得 30 组读数');
  const closest = pairs.reduce((max, item) => (item.similarity > max.similarity ? item : max));
  assert.ok(
    closest.similarity < MAX_SILHOUETTE_SIMILARITY,
    `最像的一对是 ${closest.a}/${closest.b}（${closest.facing}），相似度 ${closest.similarity} ≥ ${MAX_SILHOUETTE_SIMILARITY}`,
  );
});

test('同一个人正/侧/背的相似度落在 [0.60, 0.90]：既认得出是同一人，又确实是三个朝向', () => {
  for (const { name, look } of mainLooks) {
    for (const reading of facingSilhouettes(look)) {
      const label = `${name} ${reading.facing}/${reading.against}`;
      assert.ok(
        reading.similarity >= SAME_PERSON_MIN,
        `${label} 只有 ${reading.similarity}，三向已经不像同一个人`,
      );
      assert.ok(
        reading.similarity <= SAME_PERSON_MAX,
        `${label} 高达 ${reading.similarity}，三向只是换了脸和发，外轮廓没变`,
      );
    }
  }
});

test('档案落到单位面板：主要人物面板读得到来历、忌讳、动线与关系初值', () => {
  const world = buildSettingWorld(pack);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '迷路人',
    villagerNames: pack.villagers.map((villager) => villager.name),
  });
  const snapshot = sim.snapshot();
  const byName = new Map(snapshot.villagers.map((villager) => [villager.name, villager.id]));
  const archives: Record<string, NonNullable<(typeof pack.villagers)[number]['archive']>> = {};
  for (const villager of pack.villagers) {
    if (villager.archive === undefined) continue;
    const id = byName.get(villager.name);
    assert.ok(id !== undefined, `${villager.name} 不在开局快照里`);
    archives[id] = villager.archive;
  }
  const id = byName.get('迷路人');
  assert.ok(id !== undefined);
  const content = buildUnitStatus({ ...snapshot, archives }, { kind: 'villager', id });
  assert.ok(content !== null);
  const keys = content.lines.map((line) => line.key);
  for (const key of ['档案', '辈分', '来历', '牵挂', '忌讳', '动线', '口吻', '关系初值']) {
    assert.ok(keys.includes(key), `面板缺少「${key}」`);
  }
});

test('开局档案以 genesis/read 注入：一条记忆、两段关系、无目击断言痕迹', () => {
  const memory = new MemoryRuntime({ worldId: 'cast-artbook-test' });
  const archive = pack.villagers.find((item) => item.name === '迷路人')?.archive;
  assert.ok(archive !== undefined);
  const seeded = memory.seedGenesis({
    holderId: 'a',
    at: { x: 23, y: 29 },
    atMs: 0,
    text: '档案上写着：我叫迷路人。',
    bonds: archive.bonds.map((bond) => ({
      to: bond.to,
      trust: bond.trust,
      warmth: bond.warmth,
      debt: bond.debt,
      familiarity: bond.familiarity,
    })),
  });
  assert.equal(seeded, true, '第一次注入应写入');
  const view = memory.viewOf('a');
  assert.ok(view !== null);
  assert.equal(view.memories.length, 1, '开局只写一条档案记忆');
  const entry = view.memories[0]!;
  assert.equal(entry.sourceMode, 'read', '档案是读到的，不是目击');
  assert.deepEqual(entry.eventRefs, ['genesis:a']);
  assert.equal(entry.tier, 'long');
  assert.equal(view.beliefs.length, 0, '不生成断言');
  assert.equal(view.traces.length, 0, '不落痕迹');
  assert.equal(memory.bondsOf('a').length, 2, '两段关系初值要落账');
  const snapshot = JSON.parse(memory.toJSON()) as { world: { claims: unknown[]; facts: { source: string }[] } };
  assert.equal(snapshot.world.claims.length, 0, '不生成断言/传言');
  assert.ok(snapshot.world.facts.every((fact) => fact.source === 'genesis'));

  assert.equal(memory.seedGenesis({
    holderId: 'a',
    at: { x: 23, y: 29 },
    atMs: 0,
    text: '重复注入',
    bonds: archive.bonds.map((bond) => ({
      to: bond.to,
      trust: bond.trust,
      warmth: bond.warmth,
      debt: bond.debt,
      familiarity: bond.familiarity,
    })),
  }), false, '同一人物重复注入应幂等');
  assert.equal(memory.viewOf('a')?.memories.length, 1);
  assert.equal(memory.bondsOf('a').length, 2);
});
