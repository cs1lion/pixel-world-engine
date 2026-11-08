/**
 * P2 判据取证：C1 / C1b / C3 / C4（外加 C6 的稳定前提）。
 *
 * 口径：
 * - 两页用同一个世界、同一时刻、同一镜头、同一组「停住」开关；世界已冻。
 * - 截图只取画布包围盒（`shotStable` 的测量面契约，CHROME / DYNAMIC 已隐藏）。
 * - 比较在**屏幕空间**做，区域由 `Oracle.camera()` 换算：焦点带下半屏、
 *   隔离行是焦线上一行（1 world px）、远景带是上半屏减隔离行。
 * - 不读 canvas backing buffer（E9：WebGL 下 toDataURL 全黑），只用页面合成截图。
 *
 * 判据：
 * - C1：焦点带（下半屏，不含隔离行）off/on 逐字节相同 → exactDiffPct = 0。
 * - C1b：隔离行（焦线上一行）逐字节相同 → exactDiffPct = 0。
 * - C3：远景带必须真的变：exactDiffPct > 0 且 visibleDiffPct ≥ 0.5（ΔRGB ≥ 2 记可见）。
 * - C4：结构性读数先比：images +1、drawCalls +1、totalCommands 不动；再看像素。
 *
 * C2（硬件 / SwiftShader 双后端 0 diff）不在这里跑：本机只有 SwiftShader，
 * 跨后端比较留给 CI 的两台执行器。
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shotStable } from './lib/shot-stable.mjs';
import { assertSameFrames, frameClockInitScript, freezeFrameClock, pinClock, stepFrames } from './lib/frame-clock.mjs';

const BASE = process.env.PWE_URL ?? 'http://127.0.0.1:5211';
const OUT = resolve(process.env.PWE_OUT ?? 'tmp/check-dof');
const WORLD = process.env.PWE_DOF_WORLD ?? 'dengchao';
/** 远景带必须含水：灯潮界的湾在 y≈1..14 格，镜头中心压在这里。 */
const CAMERA = { x: 300, y: 160 };
const QUERY = `?world=${WORLD}&time=noon&feed=off&ledger=off&debug=1`;

const DIFF_SCRIPT = String.raw`
import json, sys
from PIL import Image
off = Image.open(sys.argv[1]).convert('RGBA')
on = Image.open(sys.argv[2]).convert('RGBA')
if off.size != on.size:
    print(json.dumps({'error': f'size {off.size} != {on.size}'}))
    raise SystemExit(2)
regions = json.loads(sys.argv[3])
a = off.load(); b = on.load()
out = {}
for name, (x0, y0, w, h) in regions.items():
    diff = 0; vis = 0; maxd = 0
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            pa = a[x, y]; pb = b[x, y]
            d = max(abs(pa[i] - pb[i]) for i in range(3))
            if d > 0: diff += 1
            if d >= 2: vis += 1
            if d > maxd: maxd = d
    n = w * h
    out[name] = {'pixels': n, 'exactDiffPct': 100.0 * diff / n, 'visibleDiffPct': 100.0 * vis / n, 'maxDelta': maxd}
print(json.dumps(out))
`;

function diffRegions(offPng, onPng, regions) {
  const stdout = execFileSync('python', ['-c', DIFF_SCRIPT, offPng, onPng, JSON.stringify(regions)], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function freeze(page) {
  await page.evaluate((camera) => {
    const oracle = window.Oracle;
    oracle.debugHoldWorld(true);
    // 雨/雾的强度按**世界时间**衰减，冻住世界就永远停在半途（实测 0.0997）。
    // 先把强度踩到渲染层的隐藏阈值（0.02）以下，再谈「画面停住」。
    oracle.debugSetWeather('clear');
    for (let step = 0; step < 120 && oracle.debugWeatherIntensity() > 0.02; step += 1) {
      oracle.debugStepWorld(5000);
    }
    // 人是唯一还在按渲染帧微动的东西（E12）：全部钉在原地，否则逐字节闸门永远红。
    for (const villager of oracle.view().villagers) {
      oracle.debugPinVillager(villager.id, { x: villager.pos.x, y: villager.pos.y });
    }
    oracle.debugPinTide(0);
    oracle.debugHideAmbience(true);
    if (typeof oracle.debugHideBayMist === 'function') oracle.debugHideBayMist(true);
    oracle.debugLampMotion({ ignite: false, breathe: false, sway: false });
    oracle.debugStallMotion({ cloth: false, fire: false });
    oracle.debugBannerMotion({ sway: false, shadow: false });
    oracle.debugSmokeMotion({ drift: false });
    oracle.debugGroundShadows({ on: false });
    oracle.setCameraMode('free');
    oracle.centerCameraOn(camera.x, camera.y);
  }, CAMERA);
}

async function open(browser, dofOn) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 760 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(frameClockInitScript, { freezeAt: 0, frameMs: 1000 / 60 });
  await page.goto(`${BASE}${QUERY}${dofOn ? '&dof=on' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined && window.Oracle.view !== undefined);
  await page.waitForTimeout(400);
  await freeze(page);
  return { page, errors };
}

async function capture(entry, frame) {
  const { page, errors } = entry;
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('找不到画布包围盒');
  const before = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  if (before !== frame) throw new Error(`抓拍帧号 ${before} ≠ 钉住的 ${frame}`);

  const shot = await shotStable(page, {
    clip: box,
    advance: () => stepFrames(page, 1, 'dof-shot'),
  });
  if (!shot.stable) throw new Error(`C6 前提不成立：${shot.reason}`);
  const file = join(OUT, entry.dofOn ? 'on.png' : 'off.png');
  writeFileSync(file, shot.buffer);

  const readings = await page.evaluate(() => ({
    camera: window.Oracle.camera(),
    stats: window.Oracle.renderStats(),
    clock: window.__CAPTURE_STATE__.frame,
    dof: typeof window.Oracle.dof === 'function' ? window.Oracle.dof() : null,
  }));
  await page.close();
  if (errors.length > 0) throw new Error(`页面异常：${errors.join('; ')}`);
  return { file, box, readings, hash: shot.hash };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  try {
    const off = await open(browser, false);
    const on = await open(browser, true);
    off.dofOn = false;
    on.dofOn = true;

    // 两页各自冻住后，钉到同一个绝对帧号 + 同一段沉降，再逐帧比较。
    const frozenOff = await freezeFrameClock(off.page);
    const frozenOn = await freezeFrameClock(on.page);
    const target = Math.max(frozenOff, frozenOn) + 30;
    const settle = 60;
    const frameOff = await pinClock(off.page, { targetFrame: target, settleFrames: settle, label: 'dof-off' });
    const frameOn = await pinClock(on.page, { targetFrame: target, settleFrames: settle, label: 'dof-on' });
    assertSameFrames([frameOff], [frameOn], { label: 'dof' });

    const shotOff = await capture(off, frameOff);
    const shotOn = await capture(on, frameOn);
    assertSameFrames([shotOff.readings.clock], [shotOn.readings.clock], { label: 'dof-capture' });

    const zoom = shotOff.readings.camera.zoom;
    const scale = shotOff.box.width / 480;
    const row = Math.round(zoom * scale); // 隔离行 = 1 world px
    const half = Math.round(shotOff.box.height / 2);
    const width = Math.round(shotOff.box.width);
    const height = Math.round(shotOff.box.height);
    const regions = {
      far: [0, 0, width, half - row],
      isolation: [0, half - row, width, row],
      focus: [0, half, width, height - half],
      whole: [0, 0, width, height],
    };
    const diff = diffRegions(shotOff.file, shotOn.file, regions);

    const failures = [];
    if (diff.focus.exactDiffPct !== 0) failures.push(`C1 焦点带变了 ${diff.focus.exactDiffPct}%`);
    if (diff.isolation.exactDiffPct !== 0) failures.push(`C1b 隔离行变了 ${diff.isolation.exactDiffPct}%`);
    if (!(diff.far.exactDiffPct > 0)) failures.push('C3 远景带一个像素都没变');
    if (!(diff.far.visibleDiffPct >= 0.5)) failures.push(`C3 远景带可见差异只有 ${diff.far.visibleDiffPct}%`);

    const sOff = shotOff.readings.stats;
    const sOn = shotOn.readings.stats;
    if (sOn.images !== sOff.images + 1) failures.push(`C4 images ${sOff.images} → ${sOn.images}（应 +1）`);
    if (sOn.drawCalls !== sOff.drawCalls + 1) failures.push(`C4 drawCalls ${sOff.drawCalls} → ${sOn.drawCalls}（应 +1）`);
    if (sOn.totalCommands !== sOff.totalCommands) {
      failures.push(`C4 totalCommands ${sOff.totalCommands} → ${sOn.totalCommands}（应不动）`);
    }

    const report = {
      base: BASE,
      world: WORLD,
      camera: { ...CAMERA, observed: shotOff.readings.camera },
      zoom,
      hashes: { off: shotOff.hash, on: shotOn.hash },
      diff,
      structure: {
        off: { images: sOff.images, drawCalls: sOff.drawCalls, totalCommands: sOff.totalCommands },
        on: { images: sOn.images, drawCalls: sOn.drawCalls, totalCommands: sOn.totalCommands },
      },
      dof: shotOn.readings.dof,
      files: { off: shotOff.file, on: shotOn.file },
    };
    writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) {
      console.error(`[P2 判据红] ${failures.join('；')}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
