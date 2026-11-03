import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTOR_DWELL_MS,
  DIRECTOR_IDLE_MS,
  ZOOM_STEPS,
  zoomAtStep,
  stepZoomIndex,
  clampScroll,
  scrollForOrigin,
  scrollForZoomAnchor,
  viewOriginOf,
} from '../src/render/camera-math.ts';

// ------------------------------------------------------------------ 缩放档位

test('缩放档位全是整数或半整数，保证像素对齐', () => {
  for (const step of ZOOM_STEPS) {
    assert.ok(step > 0, '缩放必须为正');
    assert.equal(step * 2, Math.round(step * 2), `${step} 必须是 0.5 的整数倍`);
  }
});

test('档位单调递增，没有重复', () => {
  for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
    assert.ok(ZOOM_STEPS[i]! > ZOOM_STEPS[i - 1]!, '档位必须严格递增');
  }
});

test('档位索引在两端夹住，不会越界', () => {
  assert.equal(stepZoomIndex(0, -1), 0, '已经最小就不能再缩');
  assert.equal(stepZoomIndex(ZOOM_STEPS.length - 1, 1), ZOOM_STEPS.length - 1);
});

test('放大缩小是可逆的：进一档再退一档回到原值', () => {
  for (let i = 0; i < ZOOM_STEPS.length; i += 1) {
    const up = stepZoomIndex(i, 1);
    const back = stepZoomIndex(up, -1);
    if (up === i) continue; // 已在顶
    assert.equal(back, i, `从 ${i} 进一档再退应回到 ${i}`);
  }
});

test('zoomAtStep 返回对应档位值', () => {
  assert.equal(zoomAtStep(0), ZOOM_STEPS[0]);
  assert.equal(zoomAtStep(ZOOM_STEPS.length - 1), ZOOM_STEPS[ZOOM_STEPS.length - 1]);
});

// ------------------------------------------------------------------ 边界夹取

test('镜头不会滚出世界左上角', () => {
  assert.deepEqual(clampScroll(-50, -30, 1280, 960, 480, 320, 2), { x: 0, y: 0 });
});

test('镜头不会滚出世界右下角', () => {
  const result = clampScroll(9999, 9999, 1280, 960, 480, 320, 2);
  // 视野 480×320 在 2 倍缩放下覆盖 240×160 世界像素。
  assert.equal(result.x, 1280 - 240);
  assert.equal(result.y, 960 - 160);
});

test('世界比视野还小时，镜头贴住左上，不会出现负偏移', () => {
  const result = clampScroll(100, 100, 200, 150, 480, 320, 2);
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
});

test('合法范围内的滚动值原样保留', () => {
  assert.deepEqual(clampScroll(300, 200, 1280, 960, 480, 320, 2), { x: 300, y: 200 });
});

// ------------------------------------------------------------------ 视野原点

/**
 * `scrollX` 不是视野左上角。
 *
 * 这组数不是从规范里抄的，是 Phaser 的 `worldView` 算式
 * （`scrollX + width/2 - width/(2*zoom)`）在 480 宽画布上的值。
 * `world-overlay.ts` 曾经把 `scrollX` 当原点传给 DOM 层，于是放大到 2 倍时
 * 名字与气泡整体偏了 120 世界像素——正好半个画布。
 */
test('视野原点不是 scroll：只有 1 倍时两者相等', () => {
  assert.equal(viewOriginOf(0, 480, 1), 0, '1 倍时相等');
  assert.equal(viewOriginOf(0, 480, 2), 120, '2 倍时差 120 世界像素');
  assert.equal(viewOriginOf(0, 480, 3), 160);
});

test('原点与 scroll 的换算是可逆的', () => {
  for (const zoom of ZOOM_STEPS) {
    const scroll = scrollForOrigin(300, 480, zoom);
    assert.ok(Math.abs(viewOriginOf(scroll, 480, zoom) - 300) < 1e-9, `${zoom} 倍下来回一趟该回到 300`);
  }
});

test('2 倍下夹到右下角，换回的 scrollX 落在 Phaser 自己的夹取范围里', () => {
  // 视野原点最大是 worldW - 480/2 = 1040；换算成 scrollX 要再减 120。
  const origin = clampScroll(9999, 9999, 1280, 960, 480, 320, 2);
  assert.equal(origin.x, 1040);
  const scrollX = scrollForOrigin(origin.x, 480, 2);
  assert.equal(scrollX, 920, 'Phaser 的 scrollX 上限是 worldW - W/2 - W/(2z)');
  // 原来直接拿 scrollX 去夹，会停在 1040——比 Phaser 允许的多 120，放大时露白边。
  assert.notEqual(scrollX, 1040);
});

// ------------------------------------------------------------------ 捏合锚点

/** 屏幕 `screen` 处看到的世界坐标（与生产读取相机四件套的口径相同）。 */
function worldAtScreen(scroll: number, size: number, zoom: number, screen: number): number {
  return viewOriginOf(scroll, size, zoom) + screen / zoom;
}

test('以两指中点为锚：中点正好是画布中心时，scroll 不变', () => {
  // 中心锚 = 现有 `zoomStep` 的效果；捏合到画面正中时不该额外位移。
  const scroll = 300;
  assert.equal(scrollForZoomAnchor(scroll, 480, 2, 3, 240), scroll);
  assert.equal(scrollForZoomAnchor(scroll, 320, 2, 3, 160), scroll);
});

test('以左边缘为锚：边缘下的世界坐标在换档前后不动', () => {
  const before = worldAtScreen(0, 480, 2, 0);
  const after = worldAtScreen(scrollForZoomAnchor(0, 480, 2, 3, 0), 480, 3, 0);
  assert.ok(Math.abs(before - after) < 1e-9, `${before} → ${after}`);
});

test('任意屏幕点、任意档位对：锚点下的世界坐标都不漂', () => {
  for (let i = 0; i + 1 < ZOOM_STEPS.length; i += 1) {
    const from = ZOOM_STEPS[i]!;
    const to = ZOOM_STEPS[i + 1]!;
    for (const screen of [0, 120, 240, 480]) {
      const scroll = 200;
      const before = worldAtScreen(scroll, 480, from, screen);
      const after = worldAtScreen(scrollForZoomAnchor(scroll, 480, from, to, screen), 480, to, screen);
      assert.ok(
        Math.abs(before - after) < 1e-9,
        `${from}→${to} 屏幕 ${screen} 处：${before} → ${after}`,
      );
    }
  }
});

test('锚点不是中心时，scroll 必须真的挪，否则放大就变成「画面被拽走」', () => {
  // 屏幕 0 处为锚、2→3 倍：scroll 要减 40，才能让左边那一点留在原处。
  // 差值形式会有 1e-14 的尾巴，所以比容差而不是比字符串。
  assert.ok(Math.abs(scrollForZoomAnchor(0, 480, 2, 3, 0) + 40) < 1e-9);
});

// ------------------------------------------------------------------ 导播节奏

test('导播在闲置一段时间后才接管，且停留时间明确', () => {
  assert.ok(DIRECTOR_IDLE_MS >= 5000, '不该刚停手就切镜头');
  assert.ok(DIRECTOR_DWELL_MS >= 5000, '每个镜头至少停几秒才看得清');
});
