/**
 * `pinShotState` 的 8 条分支口径。
 *
 * 场景本体在 Node 里造不出来（Phaser 是空壳），所以钉住逻辑抽在
 * `src/render/pin-shot-state.ts`：渲染分支调的就是这里这些函数。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  NO_SHOT_PIN,
  RENDER_INPUT_TABLE,
  actorFrameOf,
  missingRenderFields,
  phaseInputOf,
  pinActors,
  pinShot,
  pinTrails,
  pinnedTrailsOf,
  pinnedVillagersOf,
  presentedNowOf,
  presentedTideOf,
  unregisteredRenderFields,
  unpinActors,
  unpinShot,
  unpinTrails,
  type ActorPin,
  type TrailPin,
} from '../src/render/pin-shot-state.ts';
import { villagerPose, villagerPoseAtFrame } from '../src/render/villager-frames.ts';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { VillagerSnapshot, WorldSnapshot } from '../src/world/types.ts';

const SNAPSHOT_NOW = 21_000_000;
const SNAPSHOT_TIDE = 0.62;

/**
 * 守卫测试要的是**真的**快照，不是手搓的 fixture：只有真快照的键集合才能
 * 随 `types.ts` 一起长出来。世界本体在 Node 里能造（Phaser 只在渲染层）。
 */
function realSnapshot(): WorldSnapshot {
  const grid = new WorldGrid({
    width: 24,
    height: 18,
    border: 1,
    zones: [],
    regions: [{ id: 'court', x: 1, y: 1, w: 20, h: 15 }],
  });
  const sim = new Simulation({
    grid,
    buildings: [],
    altar: { x: 20, y: 9 },
    villagerName: '汐',
    wallClock: () => 1000,
    villagerProfiles: [{ at: { x: 4, y: 8 }, routine: [] }],
  });
  return sim.snapshot();
}

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

// ------------------------------------------------- 第六钉：地面痕迹（trails）

const TRAIL_A: TrailPin = { at: { x: 49, y: 36 }, strength: 2 };
const TRAIL_B: TrailPin = { at: { x: 47, y: 41 }, strength: 3 };

function trailsWorldOf(trails: readonly { at: { x: number; y: number }; strength: number }[]): WorldSnapshot {
  return { ...worldOf([]), trails: trails as WorldSnapshot['trails'] } as WorldSnapshot;
}

test('17. 第六钉：钉住后逐帧读到的痕迹表恒等于钉入值', () => {
  // 世界侧「只增不减」：1200 时是空表、2800 时多一条 (49,36)。钉住后三帧同值。
  const worldA = trailsWorldOf([]);
  const worldB = trailsWorldOf([TRAIL_A]);
  const pin = pinTrails(pinShot(NO_SHOT_PIN, 12 * 30 * 60_000, 0), [TRAIL_A]);
  const reads = [worldA, worldA, worldB, worldB].map((snapshot) => pinnedTrailsOf(pin, snapshot).trails);
  for (const trails of reads) {
    assert.equal(trails.length, 1);
    assert.deepEqual(trails[0], TRAIL_A);
  }
  assert.equal(pinnedTrailsOf(pin, worldB).trails.length, 1, '晚冻带出来的第二条被钉住值盖掉');
});

test('18. 两组痕迹各自复现：不同时刻钉不同表，互不串味', () => {
  const pinA = pinTrails(NO_SHOT_PIN, [TRAIL_A]);
  const pinB = pinTrails(NO_SHOT_PIN, [TRAIL_B, TRAIL_A]);
  const world = trailsWorldOf([]);

  assert.deepEqual(pinnedTrailsOf(pinA, world).trails, [TRAIL_A]);
  assert.deepEqual(pinnedTrailsOf(pinB, world).trails, [TRAIL_B, TRAIL_A]);
  assert.notDeepEqual(pinnedTrailsOf(pinA, world).trails, pinnedTrailsOf(pinB, world).trails);
  // 连取两次：同一个 pin 读出来的表不随读取次数变化。
  assert.deepEqual(pinnedTrailsOf(pinB, world).trails, pinnedTrailsOf(pinB, world).trails);
});

test('19. 解钉与非法条目：只解痕迹、逐条丢弃、空钉零拷贝', () => {
  const pinned = pinTrails(pinTrails(pinShot(NO_SHOT_PIN, 30 * 60_000, 0), [TRAIL_A]), [TRAIL_B]);
  assert.equal(pinned.trails.length, 1, '重新钉是覆盖，不是追加');

  const released = unpinTrails(pinned);
  assert.equal(released.trails.length, 0);
  assert.equal(released.nowMs, pinned.nowMs, '只解痕迹这一枚，时刻保留');
  assert.deepEqual(pinnedTrailsOf(released, trailsWorldOf([TRAIL_A])).trails, [TRAIL_A], '解钉后回落到世界快照');

  const dirty = pinTrails(NO_SHOT_PIN, [
    { at: { x: Number.NaN, y: 3 }, strength: 2 },
    { at: { x: 1, y: 1 }, strength: 0 },
    { at: { x: 1, y: 1 }, strength: 1.5 },
    TRAIL_A,
  ] as TrailPin[]);
  assert.equal(dirty.trails.length, 1, '非法条目逐条丢弃，合法的那条留下');
  assert.deepEqual(dirty.trails[0], TRAIL_A);

  const allBad = pinTrails(pinned, [{ at: { x: Number.NaN, y: 0 }, strength: 2 }] as TrailPin[]);
  assert.equal(allBad.trails.length, 0, '全非法等价于解钉');
});

test('20. 快照不变：钉痕迹只产出拷贝，世界快照原样；空钉同引用', () => {
  const world = trailsWorldOf([TRAIL_A]);
  const before = JSON.stringify(world);
  const copied = pinnedTrailsOf(pinTrails(NO_SHOT_PIN, [TRAIL_B]), world);
  assert.notEqual(copied, world, '钉住时必须拷贝');
  assert.deepEqual(copied.trails, [TRAIL_B]);
  assert.equal(world.trails.length, 1, '原快照没被改');
  assert.deepEqual(world.trails[0], TRAIL_A);
  assert.equal(JSON.stringify(world), before);
  assert.equal(pinnedTrailsOf(NO_SHOT_PIN, world), world, '默认路径零拷贝');
});

// ------------------------------------------- 渲染输入全集：防未来，不防今天

/**
 * 这条守卫测试的价值是**防未来**，不是防今天：今天它一定是绿的（表是照着
 * 现有快照抄的）。它挡住的是下一次 `types.ts` 给 `WorldSnapshot` 加字段时，
 * 有人直接拿去画、却没回答「它随世界时刻变吗、要不要钉」——那时它会红，
 * 逼着先把那一行登记进 `RENDER_INPUT_TABLE` 再谈画面。
 */
test('21. 守卫：快照字段必须逐个登记，pin 的字段必须真在 ShotPin 上', () => {
  const snapshot = realSnapshot();
  assert.deepEqual(unregisteredRenderFields(snapshot), [], '新字段没登记进渲染输入表');
  assert.deepEqual(missingRenderFields(snapshot), [], '表里有死条目（字段已改名或删除）');

  const pinKeys = new Set(Object.keys(NO_SHOT_PIN));
  for (const entry of RENDER_INPUT_TABLE) {
    if (entry.handling !== 'pin') continue;
    assert.ok(entry.pinKey, `${entry.field} 标了 pin 却没写 pinKey`);
    assert.ok(pinKeys.has(entry.pinKey), `${entry.field} 的 pinKey ${entry.pinKey} 不在 ShotPin 上`);
  }

  // 快照里唯一随世界时刻走的四个字段必须都是 pin，其余只能是 stable/dom。
  // （stable 由三档冻结快照逐字段 diff 为 0 佐证；dom 由第 23 条静态检索佐证。）
  const pinnedFields = RENDER_INPUT_TABLE.filter((entry) => entry.handling === 'pin').map((e) => e.field);
  assert.deepEqual(pinnedFields.sort(), ['now', 'tide', 'trails', 'villagers']);
});

test('22. 摊牌：真实快照 25 个字段，表里 4 个 pin、10 个 stable、11 个 dom', () => {
  const snapshot = realSnapshot();
  const counts = { pin: 0, stable: 0, dom: 0 };
  for (const entry of RENDER_INPUT_TABLE) counts[entry.handling] += 1;
  assert.equal(Object.keys(snapshot).length, RENDER_INPUT_TABLE.length);
  // altar / weather 从 dom 挪到 stable：都是「画面上真的读」，只是不随时刻变。
  assert.deepEqual(counts, { pin: 4, stable: 10, dom: 11 });
});

const RENDER_DIR = fileURLToPath(new URL('../src/render/', import.meta.url));
const SCENE_FILE = fileURLToPath(new URL('../src/scenes/SandboxScene.ts', import.meta.url));
/** 不画 canvas、只做快照合成的两个模块；其余 render 模块一律算绘制路径。 */
const NON_DRAWING_MODULES = new Set(['pin-shot-state.ts', 'villager-pin.ts']);

function renderSnapshotBody(): string {
  const source = readFileSync(SCENE_FILE, 'utf8');
  const start = source.indexOf('private renderSnapshot(');
  assert.ok(start >= 0, 'SandboxScene 里找不到 renderSnapshot');
  const open = source.indexOf('{', start);
  let depth = 1;
  for (let i = open + 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('renderSnapshot 花括号不平衡');
}

test('23. dom 字段在绘制路径 0 命中（静态证明，不依赖某一次运行）', () => {
  const allFiles = readdirSync(RENDER_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  // 两个非绘制模块必须真的存在，避免改名后这条测试退化成空扫。
  for (const name of NON_DRAWING_MODULES) {
    assert.ok(allFiles.includes(name), `非绘制模块 ${name} 不见了`);
  }
  const drawingFiles = allFiles.filter((f) => !NON_DRAWING_MODULES.has(f));
  assert.ok(drawingFiles.length > 0, '绘制路径扫空了');

  const domFields = RENDER_INPUT_TABLE.filter((entry) => entry.handling === 'dom').map((e) => e.field);
  assert.equal(domFields.length, 11);

  const hits: string[] = [];
  const scan = (label: string, text: string) => {
    for (const field of domFields) {
      // 只认属性访问 `.field`；`villager` 不会误吃 `villagers`（\b 卡在 s 前）。
      const count = (text.match(new RegExp(`\\.${field}\\b`, 'g')) ?? []).length;
      if (count > 0) hits.push(`${label}:${field}:${count}`);
    }
  };
  for (const name of drawingFiles) scan(name, readFileSync(join(RENDER_DIR, name), 'utf8'));
  scan('SandboxScene.renderSnapshot', renderSnapshotBody());

  assert.deepEqual(
    hits,
    [],
    'dom 字段出现在绘制路径里：登记表把真进画面的字段错标成了 dom（或新增绘制模块读了它）',
  );
});

