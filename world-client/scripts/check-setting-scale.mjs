#!/usr/bin/env node
/**
 * 尺度的证据脚本：同一机位、同一冻结帧，拍店面墙、街灯柱与一个人的实际像素，
 * 再把「墙 / 人 / 柱」三把标尺画在图上，并附像素扫描读数。
 *
 * 为什么读数要看像素而不只看常量：常量和画法可能各自都对，但叠在一起读错
 * （例如墙顶抬了 16px、石脚却跟着上移）。扫描直接从截图里量：
 *   - 灰泥连续段的高度（plaster）；
 *   - 石脚连续段的高度（stone）；
 *   - 灯柱在灯体以下那段连续涂装的高度。
 * 常量读数也一并给出，两者能对上才算数。
 *
 * 拍「改前」：先 `git stash` 掉 `src/` 的改动（脚本与单测是未跟踪文件，不受影响），
 * 用 HEAD 的旧尺度拍，再 `git stash pop` 拍「改后」。同一支脚本、同一机位，
 * 两张图只差尺度这一件事。
 *
 * **读数来源必须诚实**：拿不到 `window.Oracle.debugSettingScale` 的实测值时，
 * 「改后」这一跑直接打印 `[判据前提不成立]` 并以非 0 退出，不许退回改前基线常量
 * 继续判定——那样「通过」可能只是基线在和自己比。两种「拿不到」分开报：
 * 环境没这个钩子（`missing`）与钩子在但读数非法（`throw` / 形状不对）。
 * 唯一例外是 `SCALE_LABEL=before`：旧构建本来就没有这个钩子，那一跑只产出
 * 改前基线，常量会大声声明「非本次实测、不参与判定」。
 *
 * 跑法：
 *   cd world-client && npm run dev
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ SCALE_LABEL=before node scripts/check-setting-scale.mjs
 *   # 恢复改动后
 *   SCALE_LABEL=after node scripts/check-setting-scale.mjs
 *
 * 改后那一跑发现 before / after 都在，会额外合成并排图 `setting-scale.png`。
 * 并排图**只供人看**：改前允许是基线常量，但图上必须标注「改前为基线常量、
 * 非实测、未参与判定」、且那份 JSON 不带 `metrics`；改后必须是实测。任何数值
 * 消费（做差、容差、进判据）仍走 `assertMeasuredReading`，这里拿到的数不做差。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';
import { resolveShotDir } from './lib/shot-output.mjs';
import { annotateEquality, judgeSettingScaleProbe, readShotForComposite } from './lib/setting-scale-probe.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = resolveShotDir('check-setting-scale');
const LABEL = process.env.SCALE_LABEL ?? 'after';
mkdirSync(OUT, { recursive: true });

/** 冻结帧：与光池证据同一口径，随机数与时间都锁在帧号上。 */
const FREEZE_AT = 180;
const PIN_AT = 100;

/** 机位：正对 shopfront_mid（576..624）与 lamp_post_7（624），人站在两者前面。 */
const CAMERA = { x: 600, y: 425 };
const ZOOM = 2;
/** 店面：`shopfront_mid` at (36,27)；落地线 = 27*16 + 32 = 464。 */
const SHOP = { x: 576, base: 464, id: 'shopfront_mid' };
/** 街灯：`lamp_post_7` at (39,27)；柱脚 = 27*16 + 16 = 448。 */
const LAMP = { x: 624, base: 448, id: 'lamp_post_7' };
/**
 * 扫描列：店面左木框（`x .. x+2`）。
 *
 * 注意「连续涂装」不等于墙高：`c.timber` 的木纹刺（1×2px，压在 `x+1`，正是这一列）
 * 与板缝会把整段打断。`frameH` 只量第一段连续同色（受美术纹理影响，**不是墙高**）；
 * `wallBandH` 允许 ≤3 世界像素的断点，量到檐口下沿，才是墙高。两者都落盘。
 */
const SCAN_SHOP_X = 577;
/** 扫描列：灯柱本体（`x + 7 .. x + 9`），两个人都不站在这两列上。 */
const SCAN_LAMP_X = 632;
/** 石脚扫描列：色带只有 4px，且不在木框、门、窗、招牌上。 */
const SCAN_STONE_X = 578;

/**
 * 政策常数：`wallBandH` 允许的最大断点（世界像素）。
 *
 * 实测断点是 `2589366` 的 4 颗木纹刺：每颗 1×2px、正落在木框扫描列上，宽 2 世界
 * 像素。「≤3」只容得下这类细刺，容不下真正的结构断裂（8px 以上的错位/缺口）。
 * 将来若要放宽到 6，必须按政策常数记账（理由 + 同帧实测对照 + 谁批的），不许顺手
 * 改——放宽会把「结构断了」也吞成「墙高没变」。
 */
const WALL_BAND_MAX_GAP_WX = 3;

/** 主角钉在店面正前方（第 28 行，脚底与石脚底边同一条线 464）。 */
const HERO = '沉灯夫人';
const HERO_CELL = { x: 37, y: 28 };
/** 第二个人钉在第 27 行（脚底与柱脚同一条线 448），站在灯柱左边一格，不遮灯柱。 */
const UNDER_LAMP_CELL = { x: 38, y: 27 };

/**
 * 改前的尺度（旧构建上没有 `debugSettingScale` 这个口子，这份常量只给
 * `SCALE_LABEL=before` 画改前标尺；「改后」拿不到实测值会直接判红，不退回它）。
 * `lampBodyBottom` 取 24 而不是旧代码注释里的 25：旧画法把灯体底下的 1px `ink`
 * 衬线画在灯体外面，25 量的是衬线的下边、净空其实只有 24；新画法把衬线收进
 * 灯体最后一格，43 就是净空。以扫描为准，两图同一口径。
 */
const BEFORE = { personH: 30, shopfrontH: 32, shopfrontTop: 0, lampPostH: 37, lampBodyBottom: 24 };

function initScript({ freezeAt }) {
  try {
    localStorage.clear();
  } catch {
    /* 忽略 */
  }
  let rng = 20261019;
  Math.random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const state = { frame: 0, frozen: false };
  window.__CAPTURE_STATE__ = state;
  const realRaf = window.requestAnimationFrame.bind(window);
  const frameMs = 1000 / 60;
  performance.now = () => state.frame * frameMs;
  window.requestAnimationFrame = (cb) => {
    if (state.frozen) return 0;
    return realRaf(() => {
      state.frame += 1;
      if (state.frame >= freezeAt) {
        state.frozen = true;
        cb(state.frame * frameMs);
        return;
      }
      cb(state.frame * frameMs);
    });
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(initScript, { freezeAt: FREEZE_AT });
await page.goto(`${BASE}?world=dengchao&time=noon&feed=off&ledger=off`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });

const canvas = page.locator('canvas').first();
await canvas.waitFor();
const box = await canvas.boundingBox();
if (box === null) throw new Error('找不到 canvas');

await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let step = 0; step < 4; step += 1) {
  if ((await page.evaluate(() => window.Oracle.camera().zoom)) >= ZOOM) break;
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(160);
}
await page.evaluate(([x, y]) => window.Oracle.centerCameraOn(x, y), [CAMERA.x, CAMERA.y]);

await page.waitForFunction((n) => window.__CAPTURE_STATE__.frame >= n, PIN_AT, { timeout: 30000 });
/** 摆位：主角在店面正前、第二个在灯柱正下，其余人钉到画面外。 */
const pins = await page.evaluate(({ hero, heroCell, lampCell }) => {
  const villagers = window.Oracle.view().villagers;
  const second = villagers.find((villager) => villager.name !== hero);
  const out = {};
  for (const villager of villagers) {
    const cell = villager.name === hero
      ? heroCell
      : (second !== undefined && villager.id === second.id ? lampCell : { x: 2, y: 2 });
    out[villager.name] = window.Oracle.debugPinVillager(villager.id, cell);
  }
  return { hero: out[hero], underLamp: second === undefined ? null : out[second.name], second: second?.name };
}, { hero: HERO, heroCell: HERO_CELL, lampCell: UNDER_LAMP_CELL });
/**
 * #12：主角脚底是「人」这一列的**数值来源**。`debugPinVillager` 没返回落点就红，
 * 不退回 `HERO_CELL` 常量格、也不拿 `personH` 当这次读数——那是「基线常量冒充实测」。
 * 并排图那一侧另行处理：允许按常量格画，但必须标注清楚（见 `ruler`）。
 */
if (pins.hero === undefined || pins.hero === null || typeof pins.hero.h !== 'number') {
  console.error(
    `\n[判据前提不成立] 未取到主角脚底：debugPinVillager(${HERO}, ${HERO_CELL.x},${HERO_CELL.y}) 没有返回带 h 的落点（pins.hero=${JSON.stringify(pins.hero)}），人的像素读数无来源。\n`,
  );
  await page.close();
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => window.__CAPTURE_STATE__.frozen === true, null, { timeout: 20000 });
await page.waitForTimeout(300);

const cam = await page.evaluate(() => window.Oracle.camera());
const stats = await page.evaluate(() => window.Oracle.renderStats());
/**
 * 读数探针：只负责把「钩子在不在 / 返回了什么」原样带回 node，不在页面里做判定。
 * 判定在 `lib/setting-scale-probe.mjs`，两种「拿不到」在那里分开。
 */
const probe = await page.evaluate(() => {
  const hook = window.Oracle?.debugSettingScale;
  if (typeof hook !== 'function') {
    return { status: 'missing', detail: `window.Oracle.debugSettingScale 不是函数（typeof=${typeof hook}）` };
  }
  try {
    return { status: 'value', value: hook() };
  } catch (error) {
    return { status: 'throw', detail: error instanceof Error ? error.message : String(error) };
  }
});
const verdict = judgeSettingScaleProbe(probe, { label: LABEL });
if (!verdict.ok) {
  console.error(`\n[判据前提不成立] ${verdict.message}`);
  console.error('[判据前提不成立] 没有实测读数就不判定、不落盘；换到支持 debugSettingScale 的构建后重跑。\n');
  await page.close();
  await browser.close();
  process.exit(1);
}
if (verdict.declared) {
  console.log(`[改前基线] ${verdict.message}；常量只用来画改前标尺，不参与判定。`);
}
const metrics = verdict.metrics;

const clip = { x: box.x + box.width / 2 - 240, y: box.y + box.height / 2 - 160, width: 480, height: 320 };
const file = join(OUT, `setting-scale-${LABEL}.png`);
await page.screenshot({ path: file, clip });

/** 把 PNG 还给浏览器解码，取样与扫描都在同一页做，别在 node 里自己解 PNG。 */
const reader = await browser.newPage();
const buf = readFileSync(file);
const b64 = buf.toString('base64');
const scanned = await reader.evaluate(async ({ b64, columns, metricsDriven, wallBandMaxGapPx }) => {
  const image = new Image();
  await new Promise((res, rej) => {
    image.onload = res;
    image.onerror = rej;
    image.src = `data:image/png;base64,${b64}`;
  });
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('没有 2d 上下文');
  ctx.drawImage(image, 0, 0);
  const px = (x, y) => ctx.getImageData(x, y, 1, 1).data;
  const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
  /** 从 `fromRow` 向上数连续等于 `ref` 的像素，返回世界像素（4 图中像素 = 1 世界像素）。 */
  const run = (x, fromRow, ref) => {
    let count = 0;
    for (let y = fromRow; y >= 0; y -= 1) {
      if (near(px(x, y), ref, 6)) count += 1;
      else break;
    }
    return count / 4;
  };
  /**
   * 允许短断点的连续段：从 `fromRow` 向上走，遇到异色只记 gap，gap 不超过
   * `maxGapPx` 就继续；量到**最后一个同色像素**为止。断点只有 2 世界像素
   * （木纹刺 1×2px，8 图中像素），檐口上方的异色带是 7 世界像素（28 图中像素）——
   * `WALL_BAND_MAX_GAP_WX`（3 世界像素）正好跳过细刺、停在檐口下沿。
   */
  const bandRun = (x, fromRow, ref, maxGapPx) => {
    let lastMatch = -1;
    let gap = 0;
    for (let y = fromRow; y >= 0; y -= 1) {
      if (near(px(x, y), ref, 6)) {
        lastMatch = y;
        gap = 0;
      } else {
        gap += 1;
        if (gap > maxGapPx) break;
      }
    }
    return lastMatch < 0 ? 0 : (fromRow - lastMatch + 1) / 4;
  };
  const frameRef = px(columns.frameX, columns.frameRefRow);
  const stoneRef = px(columns.stoneX, columns.stoneRow);
  const postRef = px(columns.lampX, columns.postRow);
  return {
    /** 第一段连续同色——**不是墙高**：木纹刺/板缝会把它截断（旧 PNG 48，新 PNG 13）。 */
    frameH: run(columns.frameX, columns.frameRow, frameRef),
    /** 墙高：允许 ≤3 世界像素断点的连续段，量到檐口下沿（与 `metrics.shopfrontH` 对照）。 */
    wallBandH: bandRun(columns.frameX, columns.frameRow, frameRef, wallBandMaxGapPx),
    stoneH: run(columns.stoneX, columns.stoneRow, stoneRef),
    /** 柱脚到灯体下沿的连续涂装：灯体挂在柱顶，这一段是全高里「人能不能顶到」的那一截。 */
    bodyBottomH: run(columns.lampX, columns.postRow, postRef),
    refs: { frame: [...frameRef].slice(0, 3), stone: [...stoneRef].slice(0, 3), post: [...postRef].slice(0, 3) },
    metricsDriven,
  };
}, {
  b64,
  metricsDriven: metrics !== null,
  /** 政策常数不能直接进页面上下文，按图中像素传进去（1 世界像素 = 4 图中像素）。 */
  wallBandMaxGapPx: WALL_BAND_MAX_GAP_WX * 4,
  /** 世界像素 → 截图中像素：`(wy - worldViewY) * 2 * zoom - 160`；扫描从该像素的底行起。 */
  columns: {
    frameX: Math.round((SCAN_SHOP_X - cam.worldViewX) * 2 * ZOOM - 240),
    frameRow: Math.round((464 - cam.worldViewY) * 2 * ZOOM - 160) - 1,
    frameRefRow: Math.round((454 - cam.worldViewY) * 2 * ZOOM - 160),
    stoneX: Math.round((SCAN_STONE_X - cam.worldViewX) * 2 * ZOOM - 240),
    stoneRow: Math.round((464 - cam.worldViewY) * 2 * ZOOM - 160) - 1,
    lampX: Math.round((SCAN_LAMP_X - cam.worldViewX) * 2 * ZOOM - 240),
    postRow: Math.round((448 - cam.worldViewY) * 2 * ZOOM - 160) - 1,
  },
});
await reader.close();
await page.close();
await browser.close();

/** 只有声明过的改前基线那一跑 metrics 才是 null；其余路径在上面的判定里已经判红退出。 */
const scale = metrics ?? BEFORE;
const result = {
  label: LABEL,
  file,
  cam,
  zoom: ZOOM,
  clip,
  stats,
  metrics,
  metricsSource: verdict.source,
  /** 改前基线那一跑必须显式带这个标记；消费方据此拒绝把它当读数。 */
  metricsFromBaselineConstant: verdict.fromBaselineConstant === true,
  pins,
  scanned,
  errors,
  ancient: BEFORE,
};
writeFileSync(
  join(OUT, `setting-scale-${LABEL}.json`),
  // 落盘时不写本机绝对路径，换成仓库内的相对位置。
  `${JSON.stringify({ ...result, file: `eval/screens/setting-scale-${LABEL}.png` }, null, 2)}\n`,
);

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
console.log(`[${LABEL}] 机位 (${CAMERA.x}, ${CAMERA.y}) zoom ${cam.zoom} view ${cam.worldViewX},${cam.worldViewY}`);
console.log(`  常量（${metrics === null ? '改前基线常量，非本次实测、不参与判定' : 'debugSettingScale 实测'}）：墙 ${scale.shopfrontH}（顶抬 ${scale.shopfrontTop}）/ 人 ${scale.personH} / 柱 ${scale.lampPostH} / 灯体下沿 ${scale.lampBodyBottom}`);
console.log(`  扫描：墙高 ${fmt(scanned.wallBandH)}${annotateEquality(scanned.wallBandH, scale.shopfrontH, '墙高')}；连续段口径 ${fmt(scanned.frameH)}（受木纹刺/板缝影响，不等于墙高）/ 石脚 ${fmt(scanned.stoneH)} / 柱脚→灯体下沿 ${fmt(scanned.bodyBottomH)}`);
if (scanned.wallBandH !== scale.shopfrontH) {
  console.error(`\n[扫描自洽] 判红：墙高扫描 ${fmt(scanned.wallBandH)} ≠ 常量 ${fmt(scale.shopfrontH)}，差 ${fmt(scanned.wallBandH - scale.shopfrontH)}。ADR 要求扫描与渲染常量一致。\n`);
  process.exit(1);
}
console.log(`  指令 ${stats.totalCommands} / Graphics ${stats.graphicsObjects}`);
console.log(`  图 ${file}${errors.length === 0 ? '' : `（页面错误：${errors.join('; ')}）`}`);

// ---------------------------------------------------------------- 合成并排图

const beforeFile = join(OUT, 'setting-scale-before.png');
const afterFile = join(OUT, 'setting-scale-after.png');
if (existsSync(beforeFile) && existsSync(afterFile)) {
  const load = (label) => {
    const json = JSON.parse(readFileSync(join(OUT, `setting-scale-${label}.json`), 'utf8'));
    // 并排图只供人看：改前允许基线常量（图上标注、JSON 不带 metrics），改后必须实测。
    // 数值消费仍走 assertMeasuredReading；这里拿到的 scale 不许做差。
    try {
      const shot = readShotForComposite(json, { label });
      return { ...json, file: join(OUT, `setting-scale-${label}.png`), scale: shot.scale, annotation: shot.annotation };
    } catch (error) {
      console.error(`\n[并排图] 判红：${error instanceof Error ? error.message : String(error)}`);
      console.error('[并排图] 改后必须是 debugSettingScale 实测；改前只允许声明过的基线常量（JSON 不许带 metrics）。\n');
      process.exit(1);
    }
  };
  const shots = { before: load('before'), after: load('after') };

  const c2 = await chromium.launch({ headless: true });
  const compose = await c2.newPage({ viewport: { width: 1440, height: 720 }, deviceScaleFactor: 2 });
  const encode = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  /** 世界像素 → 合成页里的图中像素：原图 480×320 按 1:1 显示，故每世界像素仍是 4 图中像素。 */
  const at = (shot, wx, wy) => ({
    x: (wx - shot.cam.worldViewX) * 2 * ZOOM - 240,
    y: (wy - shot.cam.worldViewY) * 2 * ZOOM - 160,
  });
  /** 显示尺寸：480×320 原图缩到 480×320 的 1:1，标尺与图同尺。 */
  const W = 480;
  const H = 320;
  const bracket = (x, yTop, yBottom, label, color = '#f4d596') => `
    <div class="bracket" style="left:${x}px;top:${yTop}px;height:${Math.max(1, yBottom - yTop)}px;color:${color}">
      <span>${label}</span>
    </div>`;
  const ruler = (shot) => {
    const s = shot.scale;
    const shopTop = at(shot, SHOP.x, SHOP.base - s.shopfrontH).y;
    const shopBase = at(shot, SHOP.x, SHOP.base).y;
    const lampTop = at(shot, LAMP.x + 8, LAMP.base - s.lampPostH).y;
    const lampBase = at(shot, LAMP.x + 8, LAMP.base).y;
    const bodyY = at(shot, LAMP.x + 8, LAMP.base - s.lampBodyBottom).y;
    // #12：并排图这一侧允许缺少 `pins.hero` 时按常量格画（旧改前 JSON 没有 pins 字段），
    // 但标签必须说清「未取到脚底、常量格、非本次实测」，不许只写「人 30」冒充读数。
    const heroPin = shot.pins?.hero;
    const heroMeasured = heroPin !== undefined && heroPin !== null && typeof heroPin.h === 'number';
    const hero = heroMeasured ? heroPin : { x: HERO_CELL.x * 16 + 8, y: (HERO_CELL.y + 1) * 16, h: s.personH };
    const heroLabel = heroMeasured ? `人 ${heroPin.h}` : '人 未取到脚底（常量格）';
    const heroFoot = at(shot, 0, hero.y).y;
    return [
      bracket(at(shot, SHOP.x, 0).x - 10, shopTop, shopBase, `墙 ${s.shopfrontH}`),
      bracket(at(shot, hero.x, 0).x - 14, heroFoot - (heroMeasured ? heroPin.h : s.personH) * 4, heroFoot, heroLabel, heroMeasured ? '#9fd0ff' : '#f0a9a9'),
      bracket(at(shot, LAMP.x + 8, 0).x + 10, lampTop, lampBase, `柱 ${s.lampPostH}`),
      `<div class="hline" style="left:${at(shot, LAMP.x - 4, 0).x}px;top:${bodyY}px;width:26px"></div>`,
    ].join('');
  };
  const card = (shot, title, note) => `
    <figure>
      <div class="frame" style="width:${W}px;height:${H}px">
        <img src="${encode(shot.file)}" style="width:${W}px;height:${H}px" />
        ${ruler(shot)}
        ${shot.annotation === null ? '' : `<div class="annotation">${shot.annotation}</div>`}
        ${
          shot.pins?.hero !== undefined && typeof shot.pins.hero?.h === 'number'
            ? ''
            : '<div class="annotation" style="left:auto;right:0">未取到主角脚底：蓝尺按常量格绘制，非本次实测</div>'
        }
      </div>
      <figcaption><b>${title}</b><br />${note}</figcaption>
    </figure>`;

  const ratio = (s) => (s.shopfrontH / s.personH).toFixed(2);
  const postRatio = (s) => (s.lampPostH / s.personH).toFixed(2);
  /**
   * #12：`pins.hero.h` 一旦要当读数写进表里，就先证它在那儿。缺失 → 判红点名，
   * 不退回 `s.personH`——那正是「基线常量冒充本次读数」，表格里会写成「人 30 px」。
   */
  const requireHeroReading = (shot) => {
    const h = shot.pins?.hero?.h;
    if (typeof h !== 'number' || !Number.isFinite(h)) {
      console.error(
        `\n[判据前提不成立] 未取到主角脚底：${shot.label} 的 pins.hero 缺失或没有数值 h（${JSON.stringify(shot.pins?.hero)}），人的像素读数不能拿常量顶替。\n`,
      );
      process.exit(1);
    }
    return h;
  };
  const readings = (shot) => {
    const s = shot.scale;
    const scan = shot.scanned;
    return `
      <tr><td>店面墙</td><td>${typeof scan.wallBandH === 'number' ? `${fmt(scan.wallBandH)} px（左木框，允许 ≤3px 断点的连续涂装，到石脚底边）${annotateEquality(scan.wallBandH, s.shopfrontH, '墙高')}` : '未测（旧口径 JSON，请重拍）'}；连续段口径 ${fmt(scan.frameH)} px（受木纹刺打断，不等于墙高）</td>
          <td>${s.shopfrontH} px（顶抬 ${s.shopfrontTop}）</td>
          <td>${ratio(shot.scale)}×</td></tr>
      <tr><td>其中石脚</td><td>${fmt(scan.stoneH)} px</td><td>4 px</td><td>落地线 y+32</td></tr>
      <tr><td>人</td><td>${requireHeroReading(shot)} px</td><td>${s.personH} px</td><td>分母</td></tr>
      <tr><td>街灯柱</td><td>全高被灯体遮住，像素量不到；柱脚→灯体下沿见下行</td><td>${s.lampPostH} px</td><td>${postRatio(shot.scale)}×</td></tr>
      <tr><td>灯体下沿</td><td>${fmt(scan.bodyBottomH)} px（柱脚起连续涂装）</td><td>${s.lampBodyBottom} px</td><td>${s.lampBodyBottom - s.personH > 0 ? `+${s.lampBodyBottom - s.personH} vs 头顶` : `${s.lampBodyBottom - s.personH} vs 头顶`}</td></tr>`;
  };

  await compose.setContent(
    `<!doctype html><meta charset="utf-8" />
     <style>
       body { margin: 0; background: #0f1216; color: #d8dad3;
              font: 13px/1.6 "Microsoft YaHei", "Noto Sans SC", sans-serif; }
       h1 { font-size: 15px; margin: 16px 20px 4px; font-weight: 600; }
       p.note { margin: 0 20px 12px; color: #8b9691; }
       main { display: flex; gap: 18px; padding: 0 20px 20px; align-items: flex-start; }
       figure { margin: 0; }
       .frame { position: relative; }
       img { image-rendering: pixelated; border: 1px solid #2a3138; display: block; }
       .bracket { position: absolute; width: 0; border-left: 1px solid currentColor; }
       .bracket::before, .bracket::after { content: ""; position: absolute; left: -4px; width: 9px; height: 1px; background: currentColor; }
       .bracket::before { top: 0; }
       .bracket::after { bottom: 0; }
       .bracket span { position: absolute; left: -10px; top: 50%; transform: translate(-100%, -50%);
                       white-space: nowrap; font-size: 11px; color: #e9ece6;
                       background: rgba(15,18,22,.82); padding: 0 3px; }
       .hline { position: absolute; border-top: 1px dashed #f4d596; }
       .annotation { position: absolute; left: 0; top: 0; padding: 2px 6px; background: #9b2c2c;
                     color: #fff; font-size: 11px; font-weight: 600; letter-spacing: .02em; }
       .warn { color: #f0a9a9; }
       figcaption { padding-top: 6px; color: #c9d1cc; }
       b { color: #f4d596; font-weight: 600; }
       table { border-collapse: collapse; font-size: 12px; }
       td, th { border-bottom: 1px solid #2a3138; padding: 4px 8px; text-align: left; }
       th { color: #8b9691; font-weight: 500; }
       .panel { border: 1px solid #2a3138; padding: 8px 10px; margin-bottom: 12px; }
     </style>
     <h1>灯潮界立面尺度：改前 / 改后，同一机位、同一冻结帧</h1>
     <p class="note">
       机位正对 shopfront_mid 与 lamp_post_7（世界 ${CAMERA.x}, ${CAMERA.y}，zoom ${ZOOM}）。
       标尺读的是渲染常量；表里的「扫描」按「允许 ≤3 世界像素断点的连续涂装」量到檐口下沿，
       与常量一致才写「=」，不一致写「≠」。单列出的「连续段口径」会被木纹刺截断，不等于墙高。
       落地的石脚底边两图都在 y+32，占地与碰撞格没动。
       ${shots.before.annotation === null ? '' : '<span class="warn">改前那一拍是基线常量（图上已标注），只供人看对比，不参与判定。</span>'}
     </p>
     <main>
       ${card(shots.before, shots.before.annotation === null ? '改前' : '改前（基线常量，非实测）', `墙 ${shots.before.scale.shopfrontH} / 柱 ${shots.before.scale.lampPostH} / 灯体下沿 ${shots.before.scale.lampBodyBottom}`)}
       ${card(shots.after, '改后', `墙 ${shots.after.scale.shopfrontH} / 柱 ${shots.after.scale.lampPostH} / 灯体下沿 ${shots.after.scale.lampBodyBottom}`)}
       <div>
         <div class="panel">
           <b>像素读数</b>
           <table>
             <tr><th>构件</th><th>改后（扫描）</th><th>改后（常量）</th><th>比例</th></tr>
             ${readings(shots.after)}
           </table>
         </div>
         <div class="panel">
           <b>改前 vs 改后</b><br />
           ${shots.before.annotation === null ? '' : `<span class="warn">${shots.before.annotation}</span><br />`}
           店面墙 ${shots.before.scale.shopfrontH} → ${shots.after.scale.shopfrontH} px（${ratio(shots.before.scale)}× → ${ratio(shots.after.scale)}×）<br />
           街灯柱 ${shots.before.scale.lampPostH} → ${shots.after.scale.lampPostH} px（${postRatio(shots.before.scale)}× → ${postRatio(shots.after.scale)}×）<br />
           灯体下沿 ${shots.before.scale.lampBodyBottom} → ${shots.after.scale.lampBodyBottom} px（净空）
           （头顶 ${shots.after.scale.personH}，${shots.before.scale.lampBodyBottom - shots.before.scale.personH < 0 ? `改前压头 ${shots.before.scale.personH - shots.before.scale.lampBodyBottom}px` : '改前不压头'}）<br />
           指令 ${shots.before.stats.totalCommands} → ${shots.after.stats.totalCommands}
         </div>
         <div class="panel" style="color:#8b9691">
           尺子：世界像素 × 4 = 图中像素（zoom ${ZOOM}），合成页按 1:1 显示。<br />
           蓝尺 = 人 ${shots.after.scale.personH}px，黄尺 = 墙 / 柱，虚线 = 灯体下沿。
         </div>
       </div>
     </main>`,
  );
  await compose.screenshot({ path: join(OUT, 'setting-scale.png'), fullPage: true });
  await compose.close();
  await c2.close();
  console.log(`并排图：${join(OUT, 'setting-scale.png')}`);
  console.log(
    shots.before.annotation === null
      ? '并排图两拍均为实测。'
      : `并排图标注：${shots.before.annotation}（改前 JSON 不带 metrics，只供人看）`,
  );
}
