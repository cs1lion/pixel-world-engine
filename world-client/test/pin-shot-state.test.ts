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
  actorFrameOf,
  phaseInputOf,
  pinActors,
  pinShot,
  pinnedVillagersOf,
  presentedNowOf,
  presentedTideOf,
  unpinActors,
  unpinShot,
  type ActorPin,
} from '../src/render/pin-shot-state.ts';
import { villagerPose, villagerPoseAtFrame } from '../src/render/villager-frames.ts';
import type { VillagerSnapshot, WorldSnapshot } from '../src/world/types.ts';

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

/** 造一条最小可用的角色快照；只填渲染会读的字段。 */
function villagerOf(overrides: Partial<VillagerSnapshot> & { id: string }): VillagerSnapshot {
  return {
    name: overrides.id,
    mode: 'idle',
    pos: { x: 10, y: 10 },
    walking: false,
    facing: 'down',
    visible: true,
    taskId: null,
    bubble: null,
    routine: null,
    umbrella: false,
    carrying: null,
    lampOil: 1,
    nameState: 'held',
    carries: [],
    ...overrides,
  } as VillagerSnapshot;
}

function worldOf(villagers: VillagerSnapshot[]): WorldSnapshot {
  return { now: SNAPSHOT_NOW, villagers, villager: villagers[0] } as unknown as WorldSnapshot;
}

const ACTOR_A: ActorPin = {
  id: 'v0',
  pos: { x: 48, y: 36 },
  facing: 'down',
  mode: 'saluting',
  walking: false,
  frame: 0,
  visible: true,
};

const ACTOR_B: ActorPin = {
  id: 'v0',
  pos: { x: 40, y: 40 },
  facing: 'left',
  mode: 'delivering',
  walking: true,
  frame: 2,
  visible: true,
};

test('10. 第五钉：钉住后逐帧读到的角色恒等于钉入值', () => {
  const snapshot = worldOf([villagerOf({ id: 'v0', pos: { x: 12, y: 9 }, facing: 'right' })]);
  const pin = pinActors(pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0), [ACTOR_A]);
  // 连取三帧：结果不随读取次数、时刻、快照原值变化。
  const read = [0, 1, 2].map(() => pinnedVillagersOf(pin, snapshot).villagers[0] as VillagerSnapshot);
  for (const villager of read) {
    assert.deepEqual(villager.pos, ACTOR_A.pos);
    assert.equal(villager.facing, ACTOR_A.facing);
    assert.equal(villager.mode, ACTOR_A.mode);
    assert.equal(villager.walking, ACTOR_A.walking);
    assert.equal(villager.visible, ACTOR_A.visible);
  }
  // 帧号是第五钉里唯一不进快照的那个维度，单独由 `actorFrameOf` 提供。
  assert.equal(actorFrameOf(pin, 'v0'), ACTOR_A.frame);
});

test('11. 两组姿态各自复现：同帧号必得同一副身子，不同帧号可区分', () => {
  const standing = villagerPoseAtFrame('idle', false, 0);
  const walking = villagerPoseAtFrame('idle', true, 2);
  assert.notDeepEqual(standing, walking, '站姿与走姿必须能分开');
  assert.deepEqual(villagerPoseAtFrame('idle', false, 0), standing, '第一组复现');
  assert.deepEqual(villagerPoseAtFrame('idle', true, 2), walking, '第二组复现');

  // 两组钉各自得到自己的帧号，互不串。
  const pinA = pinActors(NO_SHOT_PIN, [ACTOR_A]);
  const pinB = pinActors(NO_SHOT_PIN, [ACTOR_B]);
  assert.equal(actorFrameOf(pinA, 'v0'), 0);
  assert.equal(actorFrameOf(pinB, 'v0'), 2);
  assert.equal(actorFrameOf(pinB, 'v1'), null, '没钉的角色交回原路径');
});

test('12. 解钉复原：unpinActors 只解角色，unpinShot 连时刻潮位一起解', () => {
  const timed = pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0);
  const pinned = pinActors(timed, [ACTOR_A]);
  // 后钉时刻不许把已钉的角色抹掉。
  const later = pinShot(pinned, 7 * 5 * 60_000, 0);
  assert.equal(later.actors[0]?.id, 'v0');
  assert.equal(presentedNowOf(later, SNAPSHOT_NOW), 7 * 5 * 60_000);

  const clearedActors = unpinActors(later);
  assert.equal(clearedActors.actors.length, 0);
  assert.equal(clearedActors.nowMs, later.nowMs, '解角色不动时刻');

  const released = unpinShot();
  assert.equal(released, NO_SHOT_PIN);
  assert.equal(released.actors.length, 0);
  assert.equal(presentedNowOf(released, SNAPSHOT_NOW), SNAPSHOT_NOW);
});

test('13. 非法条目逐条丢弃：合法的照钉，不因一个人写错退回等站定', () => {
  const bad = [
    ACTOR_A,
    { ...ACTOR_A, id: '' },
    { ...ACTOR_A, pos: { x: Number.NaN, y: 36 } },
    { ...ACTOR_A, facing: 'sideways' },
    { ...ACTOR_A, frame: -1 },
    { ...ACTOR_A, frame: 1.5 },
  ] as unknown as ActorPin[];
  const pin = pinActors(NO_SHOT_PIN, bad);
  assert.equal(pin.actors.length, 1);
  assert.deepEqual(pin.actors[0], ACTOR_A);
  // 全非法等价于解钉，且不换对象。
  const empty = pinActors(NO_SHOT_PIN, [{ ...ACTOR_A, id: '' }] as unknown as ActorPin[]);
  assert.equal(empty, NO_SHOT_PIN);
});

test('14. 快照不变：角色钉只产出派生视图，世界对象原样', () => {
  const untouched = villagerOf({ id: 'v1', pos: { x: 20, y: 20 } });
  const snapshot = worldOf([villagerOf({ id: 'v0', pos: { x: 12, y: 9 } }), untouched]);
  const before = JSON.stringify(snapshot);
  const pin = pinActors(NO_SHOT_PIN, [ACTOR_A]);
  const view = pinnedVillagersOf(pin, snapshot);
  assert.notEqual(view, snapshot, '钉住时必须拷贝');
  assert.equal(snapshot.villagers[0]?.pos.x, 12, '快照的位置没被改');
  assert.equal(view.villagers[1], untouched, '没钉的人保持同一引用');
  assert.equal(JSON.stringify(snapshot), before);
  // 默认路径零拷贝：没有角色钉时原样返回。
  assert.equal(pinnedVillagersOf(NO_SHOT_PIN, snapshot), snapshot);
  assert.equal(
    pinnedVillagersOf(pinActors(NO_SHOT_PIN, [{ ...ACTOR_B, id: 'v9' }]), snapshot),
    snapshot,
    '一个 id 都没命中也不拷贝',
  );
});

test('15. 等待无关：原路径的帧号随取样时刻变，钉住后同一帧号恒定', () => {
  // 这条就是「三跑 0 差是等出来的」的机理：1200ms 与 2800ms 取到不同帧号。
  const originalA = villagerPose('idle', false, 1200);
  const originalB = villagerPose('idle', false, 2800);
  assert.notEqual(originalA.frame, originalB.frame, '未钉时两个等待确实取到不同帧');

  const pin = pinActors(NO_SHOT_PIN, [ACTOR_A]);
  const frame = actorFrameOf(pin, 'v0');
  assert.notEqual(frame, null);
  const pinnedA = villagerPoseAtFrame('idle', false, frame as number);
  const pinnedB = villagerPoseAtFrame('idle', false, frame as number);
  assert.deepEqual(pinnedA, pinnedB, '钉住后 1200/2800/5000 都是同一帧');
});

test('16. Oracle 契约：第五钉是并列入口，不改 pinShotState 的参数顺序', () => {
  const source = readFileSync(new URL('../src/scenes/SandboxScene.ts', import.meta.url), 'utf8');
  const pinShotLine = source.match(/pinShotState: \((.*?)\): void =>/s);
  assert.ok(pinShotLine);
  assert.equal(
    pinShotLine[1].replace(/\s+/g, ' ').trim(),
    'nowMs: number, tideLevel: number',
    '加第五钉不许动四钉的签名',
  );
  const pinActorsLine = source.match(/pinActors: \((.*?)\): void =>/s);
  assert.ok(pinActorsLine, 'Oracle 上必须导出并列的 pinActors');
  assert.equal(
    pinActorsLine[1].replace(/\s+/g, ' ').trim(),
    'actors: readonly ActorPin[]',
  );
  const unpinActorsLine = source.match(/unpinActors: \((.*?)\): void =>/s);
  assert.ok(unpinActorsLine, 'Oracle 上必须导出 unpinActors');
  assert.equal(unpinActorsLine[1].trim(), '', 'unpinActors 必须无参');
});
