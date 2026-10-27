import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import {
  buildableExample,
  utterancePlaceholder,
} from '../src/ui/oracle-panel.ts';
import { selectSetting, worldForSetting } from '../src/settings/index.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

const placedOf = (
  buildings: readonly { readonly prefabId: string }[],
): ReadonlySet<string> => new Set(buildings.map((building) => building.prefabId));

/**
 * 输入框里那个例子必须**在这张图上真能办到**。
 *
 * `main.ts` 早就为有设定集的图写了这条规矩，还留了一句狠话：「一个都没剩下的
 * 时候不能就不管了」——世界拒绝「同一种铺子建第二栋」，所以模板全落位之后这张
 * 图上一栋新楼也建不出来，这时拿一个注定被拒的句子当例子，比不给例子更糟。
 *
 * 但那道判断只对 `pack.authored` 跑。默认世界（莞尔镇）走的是另一支：例子写死
 * 在 `index.html` 里，是「建一间工坊」。而默认世界里十二种铺子开局落了十一栋，
 * 能建的只有 `workshop_plot` 一种——玩家把它建掉（或读一份已经建了的档）之后，
 * 一种都不剩，例子依旧说着「建一间工坊」，而世界会拿「这种铺子已经有一栋了」
 * 把它拒掉。`intent-context.ts` 自己都承认这种拒绝是**事后**才知道的。
 *
 * 所以把「现在还能建什么」从世界状态里算出来，两支共用，并由这几条钉住。
 */
test('默认世界开局：例子点名新工坊，而它确实还没建', () => {
  const world = buildLargeWorld(blueprints);
  const placed = placedOf(world.buildings);

  const pick = buildableExample(blueprints, placed);
  assert.ok(pick !== undefined, '开局应当还有一种铺子能建');
  assert.equal(pick.id, 'workshop_plot', '十二种里开局只有它没落位');
  assert.ok(!placed.has(pick.id), '例子不能点名一种已经建过的铺子');

  const text = utterancePlaceholder(blueprints, placed);
  assert.ok(text.includes(pick.displayName), `例子要说出能建的那种：${text}`);
});

test('最后一种也建上之后：例子不再拿建造说事', () => {
  const world = buildLargeWorld(blueprints);
  // 玩家把新工坊建掉——或读一份已经建了它的档——之后的状态。
  const placed = new Set([...placedOf(world.buildings), 'workshop_plot']);

  assert.equal(buildableExample(blueprints, placed), undefined, '一种都不该剩');
  const text = utterancePlaceholder(blueprints, placed);
  assert.ok(!text.includes('建'), `没有能建的铺子，例子却还在让人建：${text}`);
});

test('灯潮界留着一个没落位的模板：例子就说那一个', () => {
  const pack = selectSetting('world=dengchao');
  const placed = placedOf(worldForSetting(pack).buildings);
  // 七个模板只落位六个，`waiting_shelter` 是刻意留给「能建一栋」的那一个。
  assert.equal(buildableExample(pack.blueprints, placed)?.id, 'waiting_shelter');
  assert.ok(
    utterancePlaceholder(pack.blueprints, placed).includes('候车亭'),
    '例子要说包上还真能建的那一个',
  );
});

test('包上一种都不剩时：例子不提建造', () => {
  const pack = selectSetting('world=dengchao');
  // 玩家把候车亭也建掉，或读一份已经建了它的档。
  const placed = new Set([...placedOf(worldForSetting(pack).buildings), 'waiting_shelter']);

  assert.equal(buildableExample(pack.blueprints, placed), undefined);
  const text = utterancePlaceholder(pack.blueprints, placed);
  assert.ok(!text.includes('建'), `没有能建的铺子，例子却还在让人建：${text}`);
});
