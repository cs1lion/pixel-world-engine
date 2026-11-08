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
 * - C7：三处已知静态摆件边缘（木栈竖边 / 栏杆横边 / 船壳）的最大梯度，
 *   `?dof=off` 下 >40、糊带内 <20。窗口按世界像素点名，不量整条远带。
 *
 * C2（硬件 / SwiftShader 双后端 0 diff）不在这里跑：本机只有 SwiftShader，
 * 跨后端比较留给 CI 的两台执行器。
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { shotStable } from './lib/shot-stable.mjs';
import { assertSameFrames, frameClockInitScript, freezeFrameClock, pinClock, stepFrames } from './lib/frame-clock.mjs';
import { resolveShotDir } from './lib/shot-output.mjs';

const BASE = process.env.PWE_URL ?? 'http://127.0.0.1:5211';
const OUT = resolveShotDir('check-dof');
const WORLD = process.env.PWE_DOF_WORLD ?? 'dengchao';
/** 远景带必须含水：灯潮界的湾在 y≈1..14 格，镜头中心压在这里。 */
const CAMERA = { x: 300, y: 160 };
const QUERY = `?world=${WORLD}&time=noon&feed=off&ledger=off&debug=1`;

// 比较在 Node 里做，不引 python / PIL：CI 的浏览器 job 只装了 npm 依赖。
// 只支持 Playwright 截出来的 8-bit 非隔行 PNG（灰度 / RGB / RGBA）——
// 截图契约就是它，遇到别的编码直接报错，不静默猜。
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function decodePng(buf) {
  if (buf.length < 8 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('不是 PNG 文件');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG（interlace=1）');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += len + 12;
  }
  const channels = CHANNELS[colorType];
  if (depth !== 8 || !channels) {
    throw new Error(`只支持 8-bit 灰度/RGB/RGBA：bitDepth=${depth}, colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`未知 PNG 行过滤类型 ${filter}`);
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

function diffRegions(offPng, onPng, regions) {
  const off = decodePng(readFileSync(offPng));
  const on = decodePng(readFileSync(onPng));
  if (off.width !== on.width || off.height !== on.height) {
    throw new Error(`尺寸不同：${off.width}x${off.height} ≠ ${on.width}x${on.height}`);
  }
  const out = {};
  for (const [name, [x0, y0, w, h]] of Object.entries(regions)) {
    let diff = 0;
    let vis = 0;
    let maxd = 0;
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const i = (y * off.width + x) * off.channels;
        const j = (y * on.width + x) * on.channels;
        let d = 0;
        for (let c = 0; c < Math.min(3, off.channels); c += 1) {
          const delta = Math.abs(off.data[i + c] - on.data[j + c]);
          if (delta > d) d = delta;
        }
        if (d > 0) diff += 1;
        if (d >= 2) vis += 1;
        if (d > maxd) maxd = d;
      }
    }
    const n = w * h;
    out[name] = {
      pixels: n,
      exactDiffPct: (100 * diff) / n,
      visibleDiffPct: (100 * vis) / n,
      maxDelta: maxd,
    };
  }
  return out;
}

/**
 * 糊带内的锐边统计：沿 x / y 的相邻像素最大梯度。
 *
 * 为什么不量整条远带：远带里还有两类**本来就不该糊**的东西——≥1000 的建筑/道具
 * （与人物逐行交错，平面糊图结构上盖不到，S-4 未闭合）和 HUD/地点标签（画在
 * 糊图之上）。拿它们的最大梯度做判据，等于要求糊图盖住整座世界。
 *
 * 所以按摆件点名量：三块窗口各自压在**已知静态摆件**的一条边上（世界像素，
 * 来自 `dengchao` 渡口的绘制命令缓冲，改画法时这里要跟着改）：
 * - `ladder`：渡口木栈的左竖边 —— `harbor-view` 的 `fillRect(176, py+3, 32, 12)`；
 * - `railing`：横贯全幅的栏杆两条横边 —— `setting-scenery` 街面层的
 *   `fillRect(32, 132, 960, 2)` / `fillRect(32, 139, 960, 2)`；
 * - `boat`：船壳与船篷的横边 —— `harbor-view` 的 `drawBoat` 一带。
 *
 * 判据：`?dof=off` 下这些边 >40（锐），糊带内必须 <20（平）。
 */
const PROBES = {
  ladder: { x: 172, y: 52, w: 12, h: 96 },
  railing: { x: 64, y: 129, w: 30, h: 14 },
  boat: { x: 206, y: 112, w: 26, h: 14 },
};

function edgeStats(file, [x0, y0, w, h]) {
  const img = decodePng(readFileSync(file));
  let maxH = 0;
  let maxV = 0;
  let sharpH = 0;
  let sharpV = 0;
  let atH = null;
  let atV = null;
  for (let y = y0 + 2; y < y0 + h - 2; y += 1) {
    for (let x = x0 + 2; x < x0 + w - 2; x += 1) {
      const i = (y * img.width + x) * img.channels;
      const r = (y * img.width + x + 1) * img.channels;
      const d = ((y + 1) * img.width + x) * img.channels;
      let gh = 0;
      let gv = 0;
      for (let c = 0; c < Math.min(3, img.channels); c += 1) {
        const dh = Math.abs(img.data[i + c] - img.data[r + c]);
        const dv = Math.abs(img.data[i + c] - img.data[d + c]);
        if (dh > gh) gh = dh;
        if (dv > gv) gv = dv;
      }
      if (gh >= 40) sharpH += 1;
      if (gv >= 40) sharpV += 1;
      if (gh > maxH) {
        maxH = gh;
        atH = [x, y];
      }
      if (gv > maxV) {
        maxV = gv;
        atV = [x, y];
      }
    }
  }
  return { maxH, maxV, sharpH, sharpV, atH, atV };
}

/**
 * 远带残差：把「≥40 的锐边像素」当掩膜，量它最长的一段连续锐边。
 *
 * 为什么是长度而不是个数：一个被糊平的边只会留下零星梯度（水面 dither、量化噪声），
 * 不会连成一条线；一条**连续 16 world px 以上**的硬边一定来自真实结构。所以判据
 * 用「最长连续段」：
 * - ≤ 8 world px：可接受残差，记账；
 * - 8～16：记账、标「待裁决」，不判红；
 * - ≥ 16：按 S-9 判关路径。
 *
 * 入口是**剥掉 DOM 标签**的那张图（`capture` 里遮掉 overlay 后另拍一张）：地点标签
 * 是 DOM 叠在 canvas 之上，不是世界层，不该进这个数。
 */
function residualStats(file, [x0, y0, w, h], pxPerWorld) {
  const img = decodePng(readFileSync(file));
  const mask = new Uint8Array(w * h);
  let pixels = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // 区域最后一行/列的邻居是**设计上的 1px 硬边**（隔离行、焦点带起点），
      // 不能算进残差：那是裁切窗口，不是没糊到的结构。
      if (x + 1 >= w || y + 1 >= h) continue;
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 1 || sy < 1 || sx >= img.width - 1 || sy >= img.height - 1) continue;
      const i = (sy * img.width + sx) * img.channels;
      const r = (sy * img.width + sx + 1) * img.channels;
      const d = ((sy + 1) * img.width + sx) * img.channels;
      let sharp = false;
      for (let c = 0; c < Math.min(3, img.channels); c += 1) {
        if (Math.abs(img.data[i + c] - img.data[r + c]) >= 40) sharp = true;
        if (Math.abs(img.data[i + c] - img.data[d + c]) >= 40) sharp = true;
      }
      if (sharp) {
        mask[y * w + x] = 1;
        pixels += 1;
      }
    }
  }
  let runH = 0;
  let runV = 0;
  let atH = null;
  let atV = null;
  for (let y = 0; y < h; y += 1) {
    let run = 0;
    for (let x = 0; x < w; x += 1) {
      run = mask[y * w + x] === 1 ? run + 1 : 0;
      if (run > runH) {
        runH = run;
        atH = [x0 + x - run + 1, y0 + y];
      }
    }
  }
  for (let x = 0; x < w; x += 1) {
    let run = 0;
    for (let y = 0; y < h; y += 1) {
      run = mask[y * w + x] === 1 ? run + 1 : 0;
      if (run > runV) {
        runV = run;
        atV = [x0 + x, y0 + y - run + 1];
      }
    }
  }
  // 连通块（4 邻接），按像素数倒序，给世界坐标包围盒。
  const seen = new Uint8Array(w * h);
  const clusters = [];
  const stack = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x] === 0 || seen[y * w + x] === 1) continue;
      stack.length = 0;
      stack.push([x, y]);
      seen[y * w + x] = 1;
      let n = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        n += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const next = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of next) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx] === 0 || seen[ny * w + nx] === 1) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      clusters.push({
        pixels: n,
        world: [
          Number(((x0 + minX) / pxPerWorld).toFixed(1)) + 0,
          Number(((y0 + minY) / pxPerWorld).toFixed(1)) + 0,
          Number(((maxX - minX + 1) / pxPerWorld).toFixed(1)),
          Number(((maxY - minY + 1) / pxPerWorld).toFixed(1)),
        ],
      });
    }
  }
  clusters.sort((a, b) => b.pixels - a.pixels);
  return {
    pixels,
    longestRun: {
      screenH: runH,
      screenV: runV,
      worldH: Number((runH / pxPerWorld).toFixed(1)),
      worldV: Number((runV / pxPerWorld).toFixed(1)),
      atH,
      atV,
    },
    clusters: clusters.slice(0, 6),
    clusterCount: clusters.length,
  };
}

async function freeze(page) {
  await page.evaluate((camera) => {
    const oracle = window.Oracle;
    oracle.debugHoldWorld(true);
    // 两页各自在真实时间里加载，世界时钟会差几百毫秒；船的档期、灯影格数因此
    // 可能差几拍，`totalCommands` 就会凭空多出几条。先把世界时钟推到整分钟边界，
    // 两页的世界时刻才落在同一个刻度上。`debugStepWorld` 是唯一能读到世界时刻的
    // 入口（它返回推进后的 `snapshot.now`），先推 1ms 当作读时钟。
    const now = oracle.debugStepWorld(1);
    let remain = 60000 - (now % 60000);
    while (remain > 0) {
      const step = Math.min(5000, remain);
      oracle.debugStepWorld(step);
      remain -= step;
    }
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

  // 标签是 DOM 叠在 canvas 之上，不是世界层；残差计数必须把它们剥掉再拍一张。
  // 只遮 overlay 根节点，canvas 内容不动，所以这张图和 on.png 只差标签。
  let labelFree = null;
  if (entry.dofOn) {
    await page.evaluate(() => {
      const label = document.querySelector('.setting-region-label');
      const root = label === null ? null : label.parentElement;
      if (root !== null) {
        root.setAttribute('data-dof-hidden', '1');
        root.style.visibility = 'hidden';
      }
    });
    labelFree = join(OUT, 'on-nolabel.png');
    writeFileSync(labelFree, await page.screenshot({ clip: box }));
    await page.evaluate(() => {
      const root = document.querySelector('[data-dof-hidden="1"]');
      if (root !== null) {
        root.style.visibility = '';
        root.removeAttribute('data-dof-hidden');
      }
    });
  }

  const readings = await page.evaluate(() => ({
    camera: window.Oracle.camera(),
    stats: window.Oracle.renderStats(),
    clock: window.__CAPTURE_STATE__.frame,
    dof: typeof window.Oracle.dof === 'function' ? window.Oracle.dof() : null,
  }));
  await page.close();
  if (errors.length > 0) throw new Error(`页面异常：${errors.join('; ')}`);
  return { file, box, readings, hash: shot.hash, labelFree };
}

async function main() {
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
    // 摆件边缘的窗口按世界像素给，换算用**实测**的镜头读数，不抄常量。
    const cam = shotOff.readings.camera;
    const pxPerWorld = cam.zoom * (shotOff.box.width / cam.width);
    const toScreen = (rect) => [
      Math.round((rect.x - cam.worldViewX) * pxPerWorld),
      Math.round((rect.y - cam.worldViewY) * pxPerWorld),
      Math.round(rect.w * pxPerWorld),
      Math.round(rect.h * pxPerWorld),
    ];
    const edges = { off: {}, on: {} };
    for (const [name, rect] of Object.entries(PROBES)) {
      const box = toScreen(rect);
      edges.off[name] = edgeStats(shotOff.file, box);
      edges.on[name] = edgeStats(shotOn.file, box);
    }
    // 整条远带的最大梯度只记账、不设闸：里面还有 ≥1000 的建筑顶与标签（见上）。
    const band = {
      off: edgeStats(shotOff.file, regions.far),
      on: edgeStats(shotOn.file, regions.far),
    };
    // 残差只量剥掉 DOM 标签的 on 图；建筑/道具（≥1000）是唯一来源。
    const residual = residualStats(shotOn.labelFree, regions.far, pxPerWorld);

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

    // C7：三处已知摆件边缘必须在 off 下是硬边、在 on 下被糊平。
    for (const name of Object.keys(PROBES)) {
      const before = Math.max(edges.off[name].maxH, edges.off[name].maxV);
      const after = Math.max(edges.on[name].maxH, edges.on[name].maxV);
      if (!(before > 40)) failures.push(`C7 ${name} 在 off 下不是锐边（最大梯度 ${before}，应 >40）`);
      if (!(after < 20)) failures.push(`C7 ${name} 在糊带内仍有锐边（最大梯度 ${after}，应 <20）`);
    }

    // C8：远带残差（剥掉 DOM 标签后）的最长连续锐边。≤8 world px 记账、
    // 8～16 标待裁决、≥16 按 S-9 判关路径。
    const longest = Math.max(residual.longestRun.worldH, residual.longestRun.worldV);
    if (longest >= 16) {
      failures.push(`C8 远带出现 ${longest} world px 的连续锐边（≥16，按 S-9 关路径）`);
    } else if (longest > 8) {
      console.log(`C8 待裁决：最长连续锐边 ${longest} world px（>8 且 <16）`);
    } else {
      console.log(`C8 可接受残差：最长连续锐边 ${longest} world px（≤8）`);
    }

    const report = {
      base: BASE,
      world: WORLD,
      camera: { ...CAMERA, observed: shotOff.readings.camera },
      zoom,
      hashes: { off: shotOff.hash, on: shotOn.hash },
      diff,
      edges,
      band,
      residual,
      structure: {
        off: { images: sOff.images, drawCalls: sOff.drawCalls, totalCommands: sOff.totalCommands },
        on: { images: sOn.images, drawCalls: sOn.drawCalls, totalCommands: sOn.totalCommands },
      },
      dof: shotOn.readings.dof,
      files: { off: shotOff.file, on: shotOn.file, onNoLabel: shotOn.labelFree },
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
