/**
 * 上游轮询失败时，世界把那句话说几遍。
 *
 * 这不是新加的要求，是同一句旧话的第二个出事地点。`saidMiss`（`venue.ts`
 * 那条路）修掉的是「派不下去」说十六遍；这里是「上游连不上了」说二十遍。
 * 两处的病一模一样：**按调用次数去重，而不是按状态**。
 *
 * 为什么二十遍比不说更糟（而不是「只是吵」）：
 *
 * 1. **事件流就是世界的记忆。** 记忆里那一晚只剩一句重复过二十遍的抱怨，
 *    真正发生过的事被挤得一条都不剩。而这个世界对用户的全部承诺，就是
 *    这份记忆是真的。
 * 2. **它每次还作为命令结果发给界面。** `onResult` 是回执那一行的唯一
 *    来路，于是用户说「下雨了」，屏上一秒后是「上游连不上了，世界照常
 *    过日子。」——一句他没问过的事，把他那句的回执擦掉了。他不知道雨
 *    到底下没下。
 *
 * 顶栏的「上游离线」与事件流各有一处，都说得很全（连「手上的单可能不全」
 * 都写着）。回执那一行不该是第三处，尤其不该是会擦掉前两行的那一处。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { TaskFoldState } from '../src/world/task-events.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 一份空折叠：上游什么都还没说。 */
const EMPTY_FOLD: TaskFoldState = { open: [], settled: [], cancelled: [], cursor: 0 };

function sim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
}

/** 断线 n 次轮询，每次一拍。 */
function disconnect(s: Simulation, times: number): void {
  for (let i = 0; i < times; i += 1) {
    s.enqueue({ kind: 'syncEvents', fold: EMPTY_FOLD, connected: false });
    s.update(16);
  }
}

/** 那句话在事件流里出现几遍。 */
function saidOffline(s: Simulation): number {
  return s.recentEvents(999).filter((event) => event.text.includes('上游连不上了')).length;
}

test('上游一次都没连上：那句话只说一遍，不说二十遍', () => {
  // 轮询是每秒一次的服务端探测，不是用户动作。用户什么都没做，
  // 而世界的记忆被同一句话刷屏——那不是诚实，是噪音。
  const s = sim();
  disconnect(s, 20);
  assert.equal(saidOffline(s), 1, `该只说一遍，实际说了 ${saidOffline(s)} 遍`);
});

test('断/连反复横跳：每次真的变了才说，不变就闭嘴', () => {
  // 反方向也得钉。去重要是按「这辈子只准说一次」，上游真的掉线了第二次
  // 时屏幕就再也不更新——那又成了假的沉默。所以按**状态**去重：
  // 从连上变成掉线是新话，该说；一直掉着不是。
  const s = sim();
  disconnect(s, 3);
  s.enqueue({ kind: 'syncEvents', fold: EMPTY_FOLD, connected: true });
  s.update(16);
  disconnect(s, 3);
  s.enqueue({ kind: 'syncEvents', fold: EMPTY_FOLD, connected: true });
  s.update(16);
  disconnect(s, 3);

  assert.equal(saidOffline(s), 3, `三次真的掉线该说三遍，实际 ${saidOffline(s)} 遍`);
  assert.equal(s.snapshot().feed.connected, false, '最后是掉线状态');
});

test('状态没变时给空结果：空结果不擦回执', () => {
  // 这才是用户看得见的那一半。回执那一行的唯一来路是 onResult，而轮询
  // 每次也走这条路。从前它每次都说一遍，于是用户那句话的回执活不过一秒。
  const s = sim();
  disconnect(s, 1);
  const first = s.update(0);
  assert.equal(first.length, 0, '没有新命令就没有新结果');

  // 再来一次断线轮询：状态没变，结果里不该有那句话。
  s.enqueue({ kind: 'syncEvents', fold: EMPTY_FOLD, connected: false });
  const repeat = s.update(16);
  assert.equal(repeat.length, 1, '命令照常结算');
  assert.equal(
    repeat[0]!.message,
    '',
    '状态没变时该给空，实际给的是「' + repeat[0]!.message + '」',
  );
});

test('第一次掉线那句话照旧说：它不是被删掉，是被去重', () => {
  // 别把修正做成了静音。上游真的掉了，世界必须说出来——只是说一次。
  const s = sim();
  s.enqueue({ kind: 'syncEvents', fold: EMPTY_FOLD, connected: false });
  const [result] = s.update(16);
  assert.equal(result!.ok, false, '掉线不是成功');
  assert.equal(result!.message, '上游连不上了，世界照常过日子。');
  assert.equal(s.snapshot().feed.connected, false, '状态行要知道自己离线');
});

test('离线不影响世界自己过日子：本地单照常派照常交', () => {
  // `feed-recovery.test.ts` 钉过「离线时本地单照样能交」，这里只补那之后
  // 新长出来的一问：去重那条提前 return 的路，会不会顺手把本地那套也停了。
  //
  // 顺带记一笔：离线时上游单**进不来**是设计如此，不是漏洞。`connected:false`
  // 表示这一轮根本没读到日志，所以 `syncEvents` 直接返回、不碰任务表——把一份
  // 没读到的折叠当真，比少派一单更糟（见 `simulation.ts` 的 syncEvents）。
  const s = sim();
  disconnect(s, 5);
  s.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (s.snapshot().deliveries.local < 1) {
    s.update(100);
    if ((guard += 1) > 400) throw new Error('离线时短活也该结束');
  }
  assert.ok(s.snapshot().deliveries.local >= 1, '离不离线都要把活干完');
  assert.equal(s.snapshot().feed.connected, false, '世界该知道自己离线');
});
