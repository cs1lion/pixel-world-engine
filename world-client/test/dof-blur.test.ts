import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * P2 糊图的算术锁。
 *
 * 这层是整节唯一能被 Node 直接验的部分：不依赖 Phaser、不依赖浏览器。
 * 任何一条红了，不许去调截图阈值，先回来改这里。
 */

// ---------------------------------------------------------------- 动态模块
//
// `dof-blur.ts` 是这次合入才有的模块。静态 import 在 base 上会
// `ERR_MODULE_NOT_FOUND`，被 `red:first` 归成 module（exit 2）；改成
// 动态 import + 显式断言后，base 上红在断言上（见 docs/OPEN_ISSUES.md B7）。

interface FocusWindow {
  focusLineY: number;
  cropY: number;
  cropHeight: number;
}

interface DofBlurModule {
  readonly boxBlurRGBA?: (
    src: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
  ) => Uint8ClampedArray;
  readonly countNonOpaque?: (src: Uint8ClampedArray) => number;
  readonly focusWindow?: (worldTopY: number, zoom: number, viewportHeight: number) => FocusWindow | null;
}

const MODULE_PATH = '../src/render/dof-blur.ts';

async function dofBlur(): Promise<Required<DofBlurModule>> {
  let mod: DofBlurModule = {};
  try {
    mod = (await import(MODULE_PATH)) as DofBlurModule;
  } catch {
    // 模块整体不存在时也按「缺导出」处理：红在断言上，不红在解析上。
  }
  for (const name of ['boxBlurRGBA', 'countNonOpaque', 'focusWindow'] as const) {
    assert.equal(typeof mod[name], 'function', `render/dof-blur.ts 必须导出 ${name}`);
  }
  return mod as Required<DofBlurModule>;
}

function field(width: number, height: number, rgba: readonly [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return data;
}

test('常数场逐字节不变：k=3/5/7 都不许把亮度放大或压暗', async () => {
  const { boxBlurRGBA } = await dofBlur();
  for (const radius of [1, 2, 3]) {
    const src = field(7, 5, [37, 120, 200, 255]);
    const out = boxBlurRGBA(src, 7, 5, radius);
    assert.deepEqual(Array.from(out), Array.from(src), `radius=${radius}`);
  }
});

test('横向台阶：边缘复制 + 唯一一次除法（k²）', async () => {
  const { boxBlurRGBA } = await dofBlur();
  // 1 行 4 列，红通道 0 0 10 10；k=3。
  const src = new Uint8ClampedArray(4 * 4);
  for (let x = 0; x < 4; x++) {
    src[x * 4] = x < 2 ? 0 : 10;
    src[x * 4 + 3] = 255;
  }
  const out = boxBlurRGBA(src, 4, 1, 1);
  // 横和（clamp）：0, 10, 20, 30 → 纵和 ×3 → (sum+4)/9。
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => out[x * 4]),
    [0, 3, 7, 10],
    '除以 k 而不是 k² 会把亮度放大 3 倍，这里会先红',
  );
});

test('alpha 恒 255：输入不透明，输出必不透明', async () => {
  const { boxBlurRGBA, countNonOpaque } = await dofBlur();
  const width = 9;
  const height = 9;
  const src = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    src[i * 4] = (i * 7) % 256;
    src[i * 4 + 1] = (i * 13) % 256;
    src[i * 4 + 2] = (i * 29) % 256;
    src[i * 4 + 3] = 255;
  }
  const out = boxBlurRGBA(src, width, height, 3);
  assert.equal(countNonOpaque(out), 0);
  assert.equal(countNonOpaque(src), 0);
});

test('纯函数：同一输入两次结果逐字节相同', async () => {
  const { boxBlurRGBA } = await dofBlur();
  const src = field(11, 6, [9, 40, 77, 255]);
  src[5 * 4] = 200;
  src[3 * 4 + 1] = 1;
  const a = boxBlurRGBA(src, 11, 6, 2);
  const b = boxBlurRGBA(src, 11, 6, 2);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('radius = 0 是恒等，非法输入直接抛', async () => {
  const { boxBlurRGBA } = await dofBlur();
  const src = field(5, 4, [1, 2, 3, 255]);
  assert.deepEqual(Array.from(boxBlurRGBA(src, 5, 4, 0)), Array.from(src));
  assert.throws(() => boxBlurRGBA(src, 5, 4, -1));
  assert.throws(() => boxBlurRGBA(src, 5, 4, 1.5));
  assert.throws(() => boxBlurRGBA(new Uint8ClampedArray(4), 5, 4, 1));
});

test('行裁切窗：2 倍镜 79 高、1 倍镜 159 高，焦线是上沿 + 半屏', async () => {
  const { focusWindow } = await dofBlur();
  assert.deepEqual(focusWindow(384, 2, 320), { focusLineY: 464, cropY: 384, cropHeight: 79 });
  assert.deepEqual(focusWindow(608, 1, 320), { focusLineY: 768, cropY: 608, cropHeight: 159 });
});

test('不支持的倍率返回 null（1.5 / 3 不猜）', async () => {
  const { focusWindow } = await dofBlur();
  assert.equal(focusWindow(0, 1.5, 320), null);
  assert.equal(focusWindow(0, 3, 320), null);
});

test('窗口整数对齐：非整数上沿四舍五入，绝不出现半行', async () => {
  const { focusWindow } = await dofBlur();
  assert.deepEqual(focusWindow(100.4, 2, 320), { focusLineY: 180, cropY: 100, cropHeight: 79 });
  assert.deepEqual(focusWindow(100.6, 2, 320), { focusLineY: 181, cropY: 101, cropHeight: 79 });
});
