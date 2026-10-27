import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentError,
  projectWorldToOverlay,
  snapToDevicePixel,
  revealAnchor,
  revealVisible,
  villagerLabelAnchors,
  type OverlayViewport,
} from '../src/render/labels.ts';
import type { VillagerSnapshot } from '../src/world/types.ts';
import { GRIME_CLEAN } from '../src/world/grime.ts';

function viewport(over: Partial<OverlayViewport> = {}): OverlayViewport {
  return {
    rect: { left: 0, top: 0, width: 960, height: 640 },
    gameWidth: 480,
    gameHeight: 320,
    cameraWorldX: 0,
    cameraWorldY: 0,
    cameraZoom: 1,
    ...over,
  };
}

function villager(over: Partial<VillagerSnapshot> = {}): VillagerSnapshot {
  return {
    id: 'v0',
    name: '莞尔',
    mode: 'idle',
    pos: { x: 7, y: 9 },
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
    ...over,
  };
}

test('世界→overlay 投影：100%/200%/400% 与滚动/相机缩放', () => {
  // 960×640 是原生 480×320 的 200% 显示；world 16px → 32 CSS px。
  assert.deepEqual(projectWorldToOverlay(0, 0, viewport()), { x: 0, y: 0 });
  assert.deepEqual(projectWorldToOverlay(16, 16, viewport()), { x: 32, y: 32 });
  const at400 = viewport({ rect: { left: 0, top: 0, width: 1920, height: 1280 } });
  assert.deepEqual(projectWorldToOverlay(16, 16, at400), { x: 64, y: 64 });
  const at100 = viewport({ rect: { left: 0, top: 0, width: 480, height: 320 } });
  assert.deepEqual(projectWorldToOverlay(16, 16, at100), { x: 16, y: 16 });
  // 相机滚动的 16 世界像素在世界坐标上等价于世界点 +16。
  const scrolled = viewport({ cameraWorldX: 16, cameraWorldY: 8 });
  assert.deepEqual(projectWorldToOverlay(32, 24, scrolled), { x: 32, y: 32 });
  // 相机 zoom=2 时内部像素翻倍，再乘 CSS 缩放。
  const zoomed = viewport({ cameraZoom: 2 });
  assert.deepEqual(projectWorldToOverlay(16, 16, zoomed), { x: 64, y: 64 });
});

test('设备像素取整：非整数 DPR 下不产生 1px 抖动', () => {
  assert.equal(snapToDevicePixel(10.4, 1), 10);
  assert.equal(snapToDevicePixel(10.6, 1), 11);
  assert.equal(snapToDevicePixel(10.5, 2), 10.5);
  assert.ok(Math.abs(snapToDevicePixel(10.24, 1.5) * 1.5 - Math.round(10.24 * 1.5)) < 1e-9);
  assert.equal(snapToDevicePixel(10.4, 0), 10);
});

test('角色名字/气泡锚点：跟随 pos，且沿用旧的隐藏规则', () => {
  const idle = villagerLabelAnchors(villager(), viewport());
  // pos(7,9) → worldX=7.5*16=120, worldY=10*16=160；名字 -30、气泡 -36。
  assert.deepEqual(idle.name, { x: 240, y: 260 });
  assert.equal(idle.bubble, null);

  const talking = villagerLabelAnchors(villager({ bubble: '！吾神降旨！' }), viewport());
  assert.equal(talking.name, null, '有气泡时名字让位');
  assert.deepEqual(talking.bubble, { x: 240, y: 248 });

  const hidden = villagerLabelAnchors(villager({ visible: false, bubble: 'x' }), viewport());
  assert.equal(hidden.name, null);
  assert.equal(hidden.bubble, null);
});

test('对齐误差：≤1 逻辑像素才算通过', () => {
  assert.ok(alignmentError({ x: 100, y: 100 }, { x: 100.4, y: 100 }, 2) <= 1);
  assert.ok(alignmentError({ x: 100, y: 100 }, { x: 105, y: 100 }, 2) > 1);
});

// ------------------------------------------------------- 露话（SPEC_V2 §4.6）

const prop = (over: { reveal?: string | null; grime?: number; x?: number; y?: number } = {}) => ({
  at: { x: over.x ?? 4, y: over.y ?? 8 },
  reveal: over.reveal === undefined ? '井底下压着一句话' : over.reveal,
  grime: over.grime === undefined ? 1 : over.grime,
});

test('露话脏着的时候看不见：洗干净才「露」', () => {
  // 只判 reveal !== null 的话，玩家洗完之前就已经把这句话读完了——
  // 那「露」这个字就白写了，清洗也不再是一件有报酬的事。
  assert.equal(revealVisible(prop({ grime: 1 })), false, '刚积满时压在泥底下');
  assert.equal(revealVisible(prop({ grime: 0.5 })), false, '洗了一半还是看不见');
  assert.equal(revealVisible(prop({ grime: GRIME_CLEAN })), true, '洗到知觉下限就看得见');
  assert.equal(revealVisible(prop({ grime: 0 })), true, '全干净当然看得见');
});

test('没有露话的摆件什么都不显示：不显示一个空框', () => {
  // 莞尔镇一件露话都没有。只判 grime 的话，它的摆件洗完会显示一个空框——
  // 那是在说「这儿本来有东西，只是你看不见」。
  assert.equal(revealVisible(prop({ reveal: null, grime: 0 })), false);
});

test('露话锚在摆件正上方：高过三种剪影，横向不偏', () => {
  // 剪影最高到 y=-23（decor.ts 三个 draw 的实测范围）。锚得不够高，
  // 那句话会压在灯罩上；横向上要对着格子中央，不能偏出一格去。
  const at = revealAnchor(prop({ x: 4, y: 8 }), viewport());
  // 落点 (4.5, 8.8) 格 → 世界像素 x=72、y=140.8，再抬 27 得 y≈113.8。
  // overlay 是画布的两倍（960/480），所以 CSS 像素 x=144、y≈227.6。
  // y 用容差而不是字面量：140.8-27 在二进制里本就不是个整数，
  // 钉住 227.6 只会让这条测试在某个 Node 版本上无故变红。
  assert.equal(at.x, 144, '横向上对着格子中央');
  assert.ok(Math.abs(at.y - 227.6) < 1e-9, `抬过了剪影：${at.y}`);
});
