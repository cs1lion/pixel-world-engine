/** 落位放不下的存档：备份 + 新世界 + 指名是哪栋楼，而不是白屏。
 *
 * 这条闸补的是 ADR_SAVE §1.3 里点名「仍然白屏」的三条路子：两栋楼重叠、
 * 门口落在自己占地里、门口到不了镇心。它们与「坐标在不在世界里」
 * （`save-bounds.test.ts`）不是一件事——那些存档的坐标全都规规矩矩在界内，
 * 形状校验也一路放行，只有真建一次才看得出来。
 *
 * 三种坏档都是**手改存档**才够得着：世界自己落位全走 `checkPlacement`，
 * 落地即合法。所以这道闸防的是存档坏了，不是世界跑偏——与界外坐标那道同族。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildWorld,
  buildWorldFromSave,
  LARGE_ALTAR,
  LARGE_WORLD_SPEC,
} from '../src/world/setup.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { Simulation } from '../src/world/simulation.ts';
import { SaveStore, parseSaveText, type StorageLike } from '../src/ui/save-store.ts';
import type { WorldSave } from '../src/world/save.ts';

const BLUEPRINTS = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);
const BOUNDS = { width: LARGE_WORLD_SPEC.width, height: LARGE_WORLD_SPEC.height };

/** 真建一次。这正是 `main.ts` 递进来的那个函数——检查的与开工的不能是两套。 */
function tryBuildWorld(save: WorldSave): string | null {
  try {
    buildWorldFromSave(save.world.buildings, BLUEPRINTS, LARGE_WORLD_SPEC, LARGE_ALTAR);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** 大世界跑 200 拍之后的存档。建筑齐、村民在跑，与真存档同形状。 */
function worldSave(): WorldSave {
  const built = buildWorld(BLUEPRINTS, LARGE_WORLD_SPEC, LARGE_ALTAR);
  const sim = new Simulation({
    grid: built.grid,
    buildings: built.buildings,
    altar: built.altar,
    villagerName: '莞尔',
  });
  for (let i = 0; i < 200; i += 1) sim.update(16);
  return sim.toSave();
}

/**
 * 改存档里某一栋楼，再序列化成文本。
 *
 * 走 `Record<string, unknown>` 而不是 `PlacedBuilding`：`origin` / `door` 那些字段
 * 是 readonly 的（`types.ts` 的 `PlacedBuilding`），而手改存档的人改的正是它们。
 * 与 `save-bounds.test.ts` 的 `editSave` 同一路数——不让类型系统替世界说法。
 */
function patchBuilding(save: WorldSave, index: number, patch: Record<string, unknown>): string {
  const raw = JSON.parse(JSON.stringify(save)) as {
    world: { buildings: Record<string, unknown>[] };
  };
  Object.assign(raw.world.buildings[index]!, patch);
  return JSON.stringify(raw);
}

const BASE = worldSave();

/** 一间工坊的占地与门，三种坏档都拿它开刀。 */
const SHOP = BASE.world.buildings[0]!;
const OTHER = BASE.world.buildings[1]!;

// ------------------------------------------------------------------ 三种坏档

test('三种落位放不下的坏档：形状校验放行，真建一次才拦得住', () => {
  const cases: readonly { readonly name: string; readonly text: string }[] = [
    {
      name: '两栋楼重叠',
      text: patchBuilding(BASE, 1, { origin: { ...SHOP.origin } }),
    },
    {
      name: '门口落在自己占地里',
      text: patchBuilding(BASE, 0, { door: { ...SHOP.origin } }),
    },
    {
      name: '门口到不了镇心',
      text: patchBuilding(BASE, 0, { door: { x: BOUNDS.width - 1, y: BOUNDS.height - 1 } }),
    },
  ];

  for (const { name, text } of cases) {
    // 只做形状校验：全都放行。这一半是「旧行为」的实测记录——不是猜的。
    const shapeOnly = parseSaveText(text);
    assert.equal(shapeOnly.ok, true, `${name}：形状合法，旧行为确实放行`);

    // 连界外坐标一起查，仍然放行：这些坐标一个都没出界。
    const withBounds = parseSaveText(text, BOUNDS);
    assert.equal(withBounds.ok, true, `${name}：坐标全在界内，界外那道拦不住它`);

    // 真建一次：拒。
    const parsed = parseSaveText(text, BOUNDS, tryBuildWorld);
    assert.equal(parsed.ok, false, `${name}：该被拒`);
    if (parsed.ok) continue;
    assert.equal(parsed.reason, 'unplaceable');
    assert.equal(parsed.problems?.length, 1, `${name}：理由一条（第一枚放不下就抛）`);
    // 指名是哪栋楼：只说「存档有问题」玩家不知道该改哪儿。
    assert.match(parsed.problems![0]!, /\S/);
    console.log(`${name} → ${parsed.problems![0]}`);
  }
});

test('一份好存档照样建得起来：不是把世界自己的存档也拒了', () => {
  const text = JSON.stringify(BASE);
  const parsed = parseSaveText(text, BOUNDS, tryBuildWorld);
  assert.equal(parsed.ok, true, `好存档被拒了：${JSON.stringify(parsed)}`);
  // 好存档重放出来的网格，与当年那一份是同一套落位。
  const rebuilt = buildWorldFromSave(parsed.save.world.buildings, BLUEPRINTS, LARGE_WORLD_SPEC, LARGE_ALTAR);
  assert.equal(rebuilt.buildings.length, BASE.world.buildings.length);
});

test('不递 tryBuildWorld 就只做形状校验：那是知道有洞而不查', () => {
  const text = patchBuilding(BASE, 1, { origin: { ...SHOP.origin } });
  const parsed = parseSaveText(text, BOUNDS);
  assert.equal(parsed.ok, true, '不递建造器时不该查落位——这一条钉的是「洞还在」');
});

// ------------------------------------------------------------------ read() / importText()

/** 一个能记账的假存储：读得到写过的每一笔。 */
class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function storeWith(text: string): { store: SaveStore; storage: FakeStorage; warnings: string[] } {
  const storage = new FakeStorage();
  storage.setItem('k', text);
  const warnings: string[] = [];
  return {
    storage,
    warnings,
    store: new SaveStore({
      storageKey: 'k',
      storage,
      wallClock: () => 1700000000000,
      bounds: BOUNDS,
      tryBuildWorld,
      onWarning: (message) => warnings.push(message),
    }),
  };
}

test('read()：放不下的存档按坏档处理——备份、指名、用新世界启动', () => {
  const text = patchBuilding(BASE, 1, { origin: { ...SHOP.origin } });
  const { store, storage, warnings } = storeWith(text);

  const result = store.read();
  assert.equal(result.ok, false, '该被拒');
  if (result.ok) return;
  // 与坏档同一个出口：read() 的 reason 只有那么几种，不必为它再加一种。
  assert.equal(result.reason, 'corrupt');
  assert.equal(result.paused, false, '不是只读模式：新世界要继续自动存档');
  assert.match(result.message, /放不进这张地图/);
  assert.match(result.message, new RegExp(OTHER.displayName), '消息里点名了是哪栋楼');

  // 原档备份在，玩家改得动。
  assert.equal(storage.getItem('k'), text, '主槽没有被改写');
  assert.equal(store.listBackups().length, 1, '原档备份了一份');
  assert.equal(storage.getItem(store.listBackups()[0]!), text, '备份的是原文');

  // 提示说给玩家听了。
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /放不进这张地图/);
});

test('importText()：放不下的存档拒绝导入，且不写槽', () => {
  const text = patchBuilding(BASE, 0, { door: { x: BOUNDS.width - 1, y: BOUNDS.height - 1 } });
  const { store, storage } = storeWith('原有内容');

  const result = store.importText(text);
  assert.equal(result.ok, false, '该被拒');
  assert.equal(result.reason, 'corrupt');
  assert.match(result.message, /放不进这张地图/);
  // 不写槽：写了的话，下一次启动就带着这份坏档走进白屏。
  assert.equal(storage.getItem('k'), '原有内容', '导入失败不该动主槽');
  assert.equal(store.isAutoSaveEnabled(), true, '导入失败不该停自动存档');
});

test('importText()：好存档照样导得进，槽里换成它', () => {
  const { store, storage } = storeWith('原有内容');
  const result = store.importText(JSON.stringify(BASE));
  assert.equal(result.ok, true, `好存档被拒了：${result.message}`);
  assert.notEqual(storage.getItem('k'), '原有内容');
  assert.equal(store.isAutoSaveEnabled(), true);
});

// ------------------------------------------------------------------ 白屏这件事本身

test('少了这道闸，坏档会把启动打成白屏——这一条钉的是危害', () => {
  const text = patchBuilding(BASE, 1, { origin: { ...SHOP.origin } });
  const shapeOnly = parseSaveText(text);
  assert.equal(shapeOnly.ok, true, '前提：形状校验放行');
  if (!shapeOnly.ok) return;
  // 旧行为：main.ts 顶层直接拿它建世界，抛出来没有人接。
  assert.throws(
    () => buildWorldFromSave(shapeOnly.save.world.buildings, BLUEPRINTS, LARGE_WORLD_SPEC, LARGE_ALTAR),
    /放不进网格/,
    '这一步不该变成「建得起来」——那说明 `place()` 的规矩变了，本文件的三种坏档要重挑',
  );
});
