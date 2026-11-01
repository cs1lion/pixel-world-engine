/** 哪些事重复了会踩出一条路，哪些不会。
 *
 * 「走的人多了就是路」这句话里的主语是**人**。补充设计 §1.2 给 `worn_path`
 * 的溯因是「最近有人频繁往返于这条路线」——一张查表，不是联想。
 *
 * 这一组钉的是那张白名单（`traces.ts` 的 `FOOTFALL_KINDS`）。它之所以值得
 * 单独一个文件，是因为漏一个的后果不是报错，而是**画面上多出一条谁也不曾走过
 * 的路**：潮水一天来回四次，八个世界日就是三十二次，落在祭坛上稳稳过门槛。
 * 而祭坛恰恰是最显眼的那一格。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consequenceOf } from '../src/world/memory/traces.ts';

/** 一件事在这个地点重复 `recurrence` 次之后留下的痕迹。 */
function layersAfter(kind: string, recurrence: number, placeType = 'generic'): string[] {
  return consequenceOf({
    eventId: 'ev_1',
    kind,
    placeId: 'somewhere',
    placeType,
    intensity: 0.2,
    day: 3,
    recurrence,
  }).map((spec) => spec.layerType);
}

test('人反复站同一个地方：第三次之后踩出一条路', () => {
  for (const kind of ['routine_done', 'task_done']) {
    assert.deepEqual(layersAfter(kind, 2), [], `${kind} 两次只是偶尔经过`);
    assert.deepEqual(layersAfter(kind, 3), ['worn_path'], `${kind} 三次才踩出路来`);
  }
});

test('潮水反复冲刷同一个地方：一条路都不该有', () => {
  // 潮水不走人。它一天来回四次，八个世界日三十多次——只要它落进白名单，
  // 祭坛上就会出现一条谁也没走过的路，而且没人会怀疑它。
  assert.deepEqual(layersAfter('tide_turn', 32), [], '潮水不走路');
  assert.deepEqual(layersAfter('weather_anomaly', 32), [], '天气也不走路');
});

test('事故反复发生：修的是墙，不是路', () => {
  // 事故有自己的那一支：第一次焦痕/损伤，第二次起转成修补。它不该同时
  // 攒出一条路——「这儿炸过很多次」和「这儿人来人往」是两件事。
  assert.deepEqual(layersAfter('workshop_accident', 1), ['damage'], '第一次、强度 0.2 时是损伤');
  assert.deepEqual(layersAfter('workshop_accident', 2), ['patch'], '第二次起转成修补');
  assert.deepEqual(layersAfter('workshop_accident', 5), ['patch'], '修了还是修，不会越修越多');
  assert.ok(!layersAfter('conflict', 5).includes('worn_path'), '冲突再多也不踩路');
});

test('祭坛不踩路：那条闸今天恒真，但它得在', () => {
  // `runtime.observe` 从不填 `placeType`，所以今天 `depositTraces` 拿到的
  // 永远是 'generic'——这条闸咬不到任何人。留着它是给上游那条路
  // （`ingestUpstream` 真的会递 placeType），所以这里直接喂给它验一次。
  assert.deepEqual(layersAfter('routine_done', 10, 'altar'), [], '祭坛是世界的中心，不是谁上班的路');
  assert.deepEqual(layersAfter('routine_done', 10, 'workshop'), ['worn_path']);
});
