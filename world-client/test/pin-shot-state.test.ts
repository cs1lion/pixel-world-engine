/**
 * `pinShotState` 的 8 条分支口径。
 *
 * 场景本体在 Node 里造不出来（Phaser 是空壳），所以钉住逻辑抽在
 * `src/render/pin-shot-state.ts`：渲染分支调的就是这里这些函数。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NO_SHOT_PIN,
  phaseInputOf,
  pinShot,
  presentedNowOf,
  presentedTideOf,
  unpinShot,
} from '../src/render/pin-shot-state.ts';

const SNAPSHOT_NOW = 21_000_000;
const SNAPSHOT_TIDE = 0.62;

test('1. 钉 now：画面读钉住值，不读快照', () => {
  const pin = pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0);
  assert.equal(presentedNowOf(pin, SNAPSHOT_NOW), 12 * 30 * 60_000);
  assert.equal(phaseInputOf(pin, { now: SNAPSHOT_NOW }).now, 12 * 30 * 60_000);
});

test('2. 钉 tide：画面读钉住值，不读快照', () => {
  const pin = pinShot(NO_SHOT_PIN, SNAPSHOT_NOW, 0);
  assert.equal(presentedTideOf(pin, SNAPSHOT_TIDE), 0);
});

test('3. 解钉：两路都回到快照值', () => {
  const pin = pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0);
  const released = unpinShot();
  assert.deepEqual(released, NO_SHOT_PIN);
  assert.equal(presentedNowOf(released, SNAPSHOT_NOW), SNAPSHOT_NOW);
  assert.equal(presentedTideOf(released, SNAPSHOT_TIDE), SNAPSHOT_TIDE);
  // 解钉后与从未钉过是同一个对象：默认路径连一次拷贝都不多。
  assert.equal(released, NO_SHOT_PIN);
  assert.ok(pin !== released);
});

test('4. 快照不变：钉住只产出一份派生视图，世界对象原样', () => {
  const snapshot = { now: SNAPSHOT_NOW, tide: { level: SNAPSHOT_TIDE }, villagers: [] };
  const before = JSON.stringify(snapshot);
  const pin = pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0);
  const view = phaseInputOf(pin, snapshot);
  assert.notEqual(view, snapshot, '钉住时必须是拷贝，不能污染快照');
  assert.equal(view.now, 12 * 30 * 60_000);
  assert.equal(view.tide, snapshot.tide, '未涉及的字段保持同一引用');
  assert.equal(snapshot.now, SNAPSHOT_NOW, '快照的 now 没被改');
  assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual(Object.keys(view), Object.keys(snapshot));
});

test('5. 不动冻钟语义：钉呈现态不产生"世界已冻"的信号', () => {
  // 冻钟是场景自己的 `pinnedClock`；钉呈现态只该动这一对画面值。
  const worldClock = { pinned: false, now: SNAPSHOT_NOW };
  const pin = pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0);
  presentedNowOf(pin, worldClock.now);
  presentedTideOf(pin, SNAPSHOT_TIDE);
  phaseInputOf(pin, { now: worldClock.now });
  assert.equal(worldClock.pinned, false);
  assert.equal(worldClock.now, SNAPSHOT_NOW);
  assert.equal('pinned' in pin, false, '钉状态里不该混进冻钟字段');
});

test('6. 非法输入：NaN / Infinity 不写进画面值', () => {
  const base = pinShot(NO_SHOT_PIN, SNAPSHOT_NOW, SNAPSHOT_TIDE);
  assert.equal(pinShot(base, Number.NaN, 0), base, 'NaN now 整条不生效');
  assert.equal(pinShot(base, 12 * 30 * 60_000, Number.POSITIVE_INFINITY), base, 'Infinity tide 不生效');
  assert.equal(
    pinShot(NO_SHOT_PIN, Number.NaN, Number.NaN),
    NO_SHOT_PIN,
    '全非法时仍是未钉住',
  );
  const half = pinShot(base, Number.NaN, 0);
  assert.equal(half, base, '只给一半合法值时不钉半截');
  assert.equal(presentedTideOf(half, SNAPSHOT_TIDE), SNAPSHOT_TIDE, '潮位不会被单独改成 0');
});

test('7. 幂等：同参数不换对象，后钉覆盖前钉', () => {
  const first = pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0);
  const again = pinShot(first, 12 * 30 * 60_000, 0);
  assert.equal(again, first);
  const moved = pinShot(first, 7 * 5 * 60_000, 0);
  assert.equal(presentedNowOf(moved, SNAPSHOT_NOW), 7 * 5 * 60_000);
  assert.equal(presentedTideOf(moved, SNAPSHOT_TIDE), 0);
});

test('8. phaseView 拷贝分支：钉住才拷贝，未钉原样返回', () => {
  const snapshot = { now: SNAPSHOT_NOW, phase: 'noon' as const };
  assert.equal(phaseInputOf(NO_SHOT_PIN, snapshot), snapshot, '默认路径零拷贝');
  const pin = pinShot(NO_SHOT_PIN, 7 * 5 * 60_000, 0);
  const copy = phaseInputOf(pin, snapshot);
  assert.notEqual(copy, snapshot);
  assert.equal(copy.now, 7 * 5 * 60_000);
  assert.equal(copy.phase, 'noon');
});

/**
 * 9. Oracle 契约兼容：`pinShotState(nowMs, tideLevel)` / `unpinShotState()`。
 *
 * 动画侧的脚本按这个签名调，内部结构换成 `ShotPin` 不许动它。这里直接读
 * 场景源码里的导出面——签名被改成对象参数或加了必填第三个参数，这条就红。
 */
test('9. Oracle 契约：pinShotState 两个必填参数、unpinShotState 无参', () => {
  const source = readFileSync(new URL('../src/scenes/SandboxScene.ts', import.meta.url), 'utf8');
  const pinLine = source.match(/pinShotState: \((.*?)\): void =>/s);
  assert.ok(pinLine, 'Oracle 上必须仍然导出 pinShotState');
  assert.equal(
    pinLine[1].replace(/\s+/g, ' ').trim(),
    'nowMs: number, tideLevel: number',
    '签名必须逐字是 (nowMs: number, tideLevel: number)',
  );
  const unpinLine = source.match(/unpinShotState: \((.*?)\): void =>/s);
  assert.ok(unpinLine, 'Oracle 上必须仍然导出 unpinShotState');
  assert.equal(unpinLine[1].trim(), '', 'unpinShotState 必须无参');
});
