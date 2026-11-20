/** 灯槽池挑选与光源表的单测。
 *
 * 「谁被照亮」不该靠肉眼验收：28 盏街灯 + 10 个槽位的取舍、同坐标重影、
 * 周期散开——这些全是纯函数，写错了唯一的症状是「画面里灯不对」，而那
 * 恰恰最难排查。这里把它们钉死在输入输出上。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LightPool, selectLights, type LightRequest, type LightsManagerLike, type LightLike } from '../src/render/art1/lighting-pool.ts';
import {
  buildWarmSources,
  hallAnchorsOf,
  lampAnchorsOf,
  warmSourceOf,
  type LightAnchor,
} from '../src/render/art1/lighting-sources.ts';
import { warmLightIntensity, type WarmLightSource } from '../src/render/art1/lighting.ts';

// ---------------------------------------------------------------- 挑选

const request = (over: Partial<LightRequest> & { key: string; x: number; y: number }): LightRequest => ({
  radius: 40,
  rgb: 0xffc27a,
  intensity: 0.6,
  priority: 1,
  ...over,
});

test('selectLights：容量内全收；超容量按「近镜头优先」裁', () => {
  const focus = { x: 0, y: 0 };
  const requests = [
    request({ key: 'far', x: 900, y: 0 }),
    request({ key: 'near', x: 10, y: 0 }),
    request({ key: 'mid', x: 100, y: 0 }),
  ];
  const picked = selectLights(requests, focus, 2);
  assert.deepEqual(picked.taken.map((r) => r.key), ['near', 'mid'], '近的两盏进槽');
  assert.equal(picked.dropped, 1);
  assert.equal(picked.taken[0]!.key, 'near');
});

test('selectLights：priority 压过距离——正在发生的事不被街灯挤掉', () => {
  const focus = { x: 0, y: 0 };
  const requests = [
    request({ key: 'oracle', x: 5000, y: 5000, priority: 3 }), // 很远但优先
    request({ key: 'lamp-near', x: 5, y: 5, priority: 1 }),
    request({ key: 'lamp-near2', x: 6, y: 5, priority: 1 }),
  ];
  const picked = selectLights(requests, focus, 2);
  assert.deepEqual(picked.taken.map((r) => r.key), ['oracle', 'lamp-near']);
  assert.equal(picked.dropped, 1);
});

test('selectLights：强度 0 的请求不占槽（熄着的灯不参加竞选）', () => {
  const focus = { x: 0, y: 0 };
  const requests = [
    request({ key: 'off', x: 1, y: 1, intensity: 0 }),
    request({ key: 'on', x: 2, y: 2, intensity: 0.5 }),
  ];
  const picked = selectLights(requests, focus, 2);
  assert.deepEqual(picked.taken.map((r) => r.key), ['on']);
  assert.equal(picked.dropped, 0);
});

test('selectLights：容量 0 什么都不收、不炸', () => {
  const picked = selectLights([request({ key: 'a', x: 0, y: 0 })], { x: 0, y: 0 }, 0);
  assert.deepEqual(picked.taken, []);
  assert.equal(picked.dropped, 1);
});

// ---------------------------------------------------------------- 槽池

/** 手捏 LightsManager：记录 addLight 与 lights 数组，供池做增删。
 *  桩上的灯多带一格 `intensity`，测试才读得到「这一槽现在多亮」。 */
interface StubLight extends LightLike {
  intensity: number;
}
const managerStub = (maxLights: number) => {
  const lights: StubLight[] = [];
  const manager: LightsManagerLike = {
    lights,
    maxLights,
    enable: () => undefined,
    disable: () => undefined,
    setAmbientColor: () => undefined,
    addLight: (x = 0, y = 0, radius = 128, _rgb = 0xffffff, intensity = 1) => {
      const light: StubLight = {
        x,
        y,
        radius,
        intensity,
        setIntensity(value: number) {
          this.intensity = value;
        },
        setColor: () => undefined,
        setRadius(value: number) {
          this.radius = value;
        },
      };
      lights.push(light);
      return light;
    },
  };
  return { manager, lights };
};

test('LightPool：槽位一次建满、长度恒定；空槽强度归零', () => {
  const { manager, lights } = managerStub(4);
  const pool = LightPool.create(manager);
  assert.equal(pool.capacity, 4);
  assert.equal(lights.length, 4, '槽位必须建满（不是按需建）');

  pool.apply(
    [
      request({ key: 'a', x: 10, y: 10, intensity: 0.5 }),
      request({ key: 'b', x: 20, y: 20, intensity: 0.7 }),
    ],
    { x: 0, y: 0 },
  );
  assert.equal(lights[0]!.intensity, 0.5);
  assert.equal(lights[1]!.intensity, 0.7);
  assert.equal(lights[2]!.intensity, 0, '空槽要归零');
  assert.equal(lights[3]!.intensity, 0);
  assert.equal(lights.length, 4, 'apply 之后灯数不许变');
});

test('LightPool：maxLights 为 -1（未 enable）时按缺省 10 建池', () => {
  const { manager } = managerStub(-1);
  assert.equal(LightPool.create(manager).capacity, 10);
});

test('LightPool.destroy：把自己建的槽摘出 lights 数组', () => {
  const { manager, lights } = managerStub(3);
  const pool = LightPool.create(manager);
  assert.equal(lights.length, 3);
  pool.destroy();
  assert.equal(lights.length, 0, '摘除后 lights 数组要回到原样');
});

// ---------------------------------------------------------------- 光源表

test('warmSourceOf：kind 决定半径/强度/颜色，周期按序号散开', () => {
  const lamp = warmSourceOf({ x: 10, y: 20, kind: 'lamp', index: 0 });
  const beacon = warmSourceOf({ x: 10, y: 20, kind: 'beacon', index: 0 });
  assert.ok(lamp.radius < beacon.radius, '灯塔照得更远');
  assert.ok(lamp.intensity < beacon.intensity);
  assert.notEqual(lamp.color, beacon.color);
  // 同 kind 不同序号 → 不同周期（不然整条街同相闪）。
  const periods = Array.from({ length: 10 }, (_, i) => warmSourceOf({ x: 0, y: 0, kind: 'lamp', index: i }).periodMs);
  assert.ok(new Set(periods).size > 1, '十个序号至少要给出两种周期');
  // 同序号永远同周期（重启不漂）。
  assert.equal(warmSourceOf({ x: 0, y: 0, kind: 'lamp', index: 5 }).periodMs, warmSourceOf({ x: 0, y: 0, kind: 'lamp', index: 5 }).periodMs);
});

test('buildWarmSources：同坐标只留一盏，灯塔压过街灯压过窗口', () => {
  const anchors: LightAnchor[] = [
    { x: 10, y: 10, kind: 'lamp', index: 0 },
    { x: 10, y: 10, kind: 'beacon', index: 1 },
    { x: 10, y: 10, kind: 'hall', index: 2 },
    { x: 30, y: 10, kind: 'hall', index: 3 },
  ];
  const sources = buildWarmSources(anchors);
  assert.equal(sources.length, 2, '同一坐标三盏只该留灯塔一盏');
  const at10 = sources.find((s) => s.x === 10)!;
  assert.equal(at10.color, warmSourceOf({ x: 0, y: 0, kind: 'beacon', index: 0 }).color);
});

test('lampAnchorsOf：只取前 N 盏，悬挂灯归 hall 档', () => {
  const lamps = Array.from({ length: 12 }, (_, order) => ({
    order,
    x: order * 20,
    y: 100,
    hanging: order % 3 === 0,
  }));
  const anchors = lampAnchorsOf(lamps, 8);
  assert.equal(anchors.length, 8);
  assert.equal(anchors.filter((a) => a.kind === 'hall').length, 3, 'order 0/3/6 是悬挂灯');
  assert.ok(anchors.every((a) => Number.isInteger(a.x) && Number.isInteger(a.y)));
});

test('hallAnchorsOf：没人的楼不发光；宽楼给两扇窗', () => {
  const sources = hallAnchorsOf([
    { instanceId: 'a', x: 100, y: 200, w: 64, h: 48, active: true },
    { instanceId: 'b', x: 300, y: 200, w: 32, h: 48, active: false },
  ]);
  assert.equal(sources.length, 2, 'a 楼两窗，b 楼不亮');
  assert.ok(sources.every((s) => s.kind === 'hall'));
});

test('hallAnchorsOf：同一栋楼永远同一相位（instanceId 哈希稳定）', () => {
  const make = () => hallAnchorsOf([{ instanceId: 'b7', x: 0, y: 0, w: 48, h: 32, active: true }]);
  const first = make();
  const again = make();
  assert.deepEqual(first.map((a) => a.index), again.map((a) => a.index));
});

// ---------------------------------------------------------------- 串联

test('串起来：光源表 → 槽池请求 → 挑选，镜头对着楼时窗口不被街灯挤掉', () => {
  const anchors: LightAnchor[] = [
    ...lampAnchorsOf(
      Array.from({ length: 12 }, (_, order) => ({ order, x: order * 30, y: 0, hanging: false })),
      12,
    ),
    ...hallAnchorsOf([{ instanceId: 'h1', x: 50, y: 50, w: 64, h: 32, active: true }]),
  ];
  const sources: WarmLightSource[] = buildWarmSources(anchors);
  // 12 盏街灯（y=0）+ 2 扇窗（y=36）：坐标不同，去重不该误删它们。
  assert.equal(sources.length, 14);

  const pool = LightPool.create(managerStub(10).manager);
  const requests = pool.warmRequests(sources, 1200);
  assert.equal(requests.length, sources.length);

  // 14 个请求挤 10 个槽：镜头压在窗口那栋楼上，两扇窗（同档最近）必须保留。
  const focus = { x: 45, y: 55 };
  const picked = selectLights(requests, focus, pool.capacity);
  assert.equal(picked.taken.length, 10);
  assert.equal(picked.dropped, 4, '超容量必须有记账，不许静默');
  const kept = picked.taken.map((r) => r.key);
  assert.ok(kept.includes('w12') && kept.includes('w13'), '窗口离镜头最近，两扇都要保留');
});

test('呼吸强度在槽池链路里保持确定性：同一帧同一读数', () => {
  const source = warmSourceOf({ x: 0, y: 0, kind: 'lamp', index: 3 });
  const a = warmLightIntensity(source, 8123);
  const b = warmLightIntensity(source, 8123);
  assert.equal(a, b);
});
