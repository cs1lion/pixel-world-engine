/**
 * `check-setting-scale.mjs` 读数来源的可复现反例（端到端，手动跑）：
 *
 *   node test/fixtures/setting-scale-hook-probe.mjs
 *
 * 用桩页冒充一个「只提供取数所需 Oracle 面」的构建，分别跑三种情况：
 *   1. MODE=missing —— 没有 debugSettingScale（旧构建）：改后必须红、退出码非 0；
 *   2. MODE=invalid —— 钩子在但返回值非法：必须红、退出码非 0，并带实际值；
 *   3. MODE=ok      —— 合法读数：必须绿、退出码 0，落盘 metrics 来自实测。
 * 另加三条：
 *   4. MODE=missing + SCALE_LABEL=before：声明为改前基线、退出 0（旧构建的
 *      唯一例外，控制台会大声说明常量不参与判定）；
 *   5. 改前是基线常量 + 改后实测：并排图**允许合成**，但必须 exit 0 且图上带
 *      标注「改前为基线常量、非实测、未参与判定」。「基线常量不许做差」这条由
 *      `test/check-setting-scale-probe.test.ts` 的数值消费用例钉住；
 *   6. MODE=mismatch —— 钩子报 48、桩页却画 56px 墙：`[扫描自洽]` 必须判红并
 *      exit 1。这是判据本身跑红的证据，不是 `annotateEquality` 的单测反例。
 *
 * 为什么不进 `npm test`：本仓 `npm test` 不依赖浏览器，浏览器类闸门走
 * `test:*` 脚本。这条只作为可复现证据。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(FIXTURE_DIR, '..', '..');
const SCRIPT = join(CLIENT_ROOT, 'scripts', 'check-setting-scale.mjs');

const HOOKS = {
  missing: '',
  invalid: `debugSettingScale: () => ({ personH: 30, shopfrontH: '四十八', shopfrontTop: 16, lampPostH: 58, lampBodyBottom: 43 }),`,
  ok: `debugSettingScale: () => ({ personH: 30, shopfrontH: 48, shopfrontTop: 16, lampPostH: 58, lampBodyBottom: 43 }),`,
  // 常量仍是 48，但桩页把墙画成 56：模拟「画面与常量对不上」，用来跑红自洽判据。
  mismatch: `debugSettingScale: () => ({ personH: 30, shopfrontH: 48, shopfrontTop: 16, lampPostH: 58, lampBodyBottom: 43 }),`,
};

function stubHtml(mode) {
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>html,body{margin:0;background:#111}canvas{display:block}</style></head><body>
<canvas width="1010" height="700"></canvas>
<script>
const canvas = document.querySelector('canvas');
const g = canvas.getContext('2d');
g.fillStyle = '#111';
g.fillRect(0, 0, 1010, 700);
function tick() {
  if (window.__CAPTURE_STATE__.frozen) return;
  window.requestAnimationFrame(tick);
}
window.requestAnimationFrame(tick);
const villagers = [{ id: 'v1', name: '沉灯夫人' }, { id: 'v2', name: '阿石' }];
const cam = { zoom: 2, worldViewX: 460, worldViewY: 400, mode: 'free', width: 480, height: 320, scrollX: 360, scrollY: 265 };
window.Oracle = {
  view: () => ({ villagers }),
  camera: () => ({ ...cam }),
  centerCameraOn: (x, y) => { cam.worldViewX = x - 120; cam.worldViewY = y - 80; drawScene(); },
  debugPinVillager: (id, cell) => ({ x: cell.x * 16 + 8, y: (cell.y + 1) * 16, h: 30 }),
  renderStats: () => ({ totalCommands: 0, graphicsObjects: 0, largest: [0, 0, 0, 0, 0] }),
  ${HOOKS[mode]}
};
// 桩页也要有可量的几何：没有钩子的旧构建画 32px 墙，有钩子的画 48px；
// mismatch 模式故意画 56px，用来跑红自洽判据。机位变了要重画。
function drawScene() {
  const wallH = ${mode === 'missing' ? 32 : mode === 'mismatch' ? 56 : 48};
  // 截图裁的是画布中心 480x320；扫描列给的是截图内坐标，画布坐标要加裁切原点。
  const CLIP_X = Math.round(1010 / 2 - 240);
  const CLIP_Y = Math.round(700 / 2 - 160);
  const sx = (wx) => Math.round((wx - cam.worldViewX) * 4 - 240) + CLIP_X;
  const sy = (wy) => Math.round((wy - cam.worldViewY) * 4 - 160) + CLIP_Y;
  const base = sy(464) - 1;
  g.fillStyle = '#111';
  g.fillRect(0, 0, 1010, 700);
  g.fillStyle = '#412d32';
  g.fillRect(sx(577), base - wallH * 4 + 1, 3, wallH * 4);
  g.fillStyle = '#a4483d';
  g.fillRect(sx(577), base - wallH * 4 - 27, 3, 28);
  g.fillStyle = '#5a6b73';
  g.fillRect(sx(578), base - 15, 1, 16);
  g.fillStyle = '#6b4a3f';
  g.fillRect(sx(632), sy(448) - 1 - 171, 1, 172);
}
drawScene();
</script></body></html>`;
}

async function withStub(mode, fn) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(stubHtml(mode));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

function runScript({ base, label, outDir }) {
  const env = {
    ...process.env,
    PIXEL_WORLD_URL: base,
    PIXEL_WORLD_SKIP_TREE_IDENTITY: '1',
    EVAL_OUT: outDir,
  };
  if (label === undefined) delete env.SCALE_LABEL;
  else env.SCALE_LABEL = label;
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT], { cwd: CLIENT_ROOT, env });
    const chunks = { stdout: '', stderr: '' };
    child.stdout.on('data', (chunk) => { chunks.stdout += chunk; });
    child.stderr.on('data', (chunk) => { chunks.stderr += chunk; });
    child.on('close', (code) => done({ code, ...chunks }));
  });
}

const cases = [];
async function run(name, { mode, label, outName, prepare, check }) {
  const outDir = mkdtempSync(join(tmpdir(), `setting-scale-probe-${outName}-`));
  let result;
  try {
    if (prepare !== undefined) prepare(outDir);
    result = await withStub(mode, (base) => runScript({ base, label, outDir }));
    await check(result, outDir);
    cases.push(`PASS ${name}：exit=${result.code}`);
    console.log(`\n===== ${name} =====`);
    console.log(result.stdout.trim());
    if (result.stderr.trim() !== '') console.log(result.stderr.trim());
    console.log(`exit=${result.code}`);
  } catch (error) {
    cases.push(`FAIL ${name}：${error instanceof Error ? error.message : String(error)}`);
    console.error(`\n===== ${name} =====`);
    // 失败时把子进程原始输出带出来，否则只剩断言差异、看不到判据到底说了什么。
    if (result !== undefined) {
      if (result.stdout.trim() !== '') console.error(result.stdout.trim());
      if (result.stderr.trim() !== '') console.error(result.stderr.trim());
      console.error(`exit=${result.code}`);
    }
    throw error;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const jsonPath = (outDir) => join(outDir, 'setting-scale-after.json');

try {
  await run('无钩子 + 改后：必须红', {
    mode: 'missing',
    outName: 'missing',
    async check(result, outDir) {
      assert.equal(result.code, 1, '无钩子的改后跑必须非 0 退出');
      assert.match(result.stderr, /\[判据前提不成立\] 环境不支持 debugSettingScale/);
      assert.doesNotMatch(result.stdout, /debugSettingScale 实测/);
      assert.equal(existsSync(jsonPath(outDir)), false, '判红时不应落盘读数 JSON');
    },
  });

  await run('钩子返回非法值：必须红并给出实际值', {
    mode: 'invalid',
    outName: 'invalid',
    async check(result, outDir) {
      assert.equal(result.code, 1, '读数非法的改后跑必须非 0 退出');
      assert.match(result.stderr, /\[判据前提不成立\] 读数非法/);
      assert.match(result.stderr, /"四十八"/, '错误信息要带上实际返回值');
      assert.equal(existsSync(jsonPath(outDir)), false, '判红时不应落盘读数 JSON');
    },
  });

  await run('合法读数 + 改后：必须绿且落盘实测', {
    mode: 'ok',
    outName: 'ok',
    async check(result, outDir) {
      assert.equal(result.code, 0, '正常路径必须绿');
      assert.match(result.stdout, /常量（debugSettingScale 实测）：墙 48/);
      const json = JSON.parse(readFileSync(jsonPath(outDir), 'utf8'));
      assert.equal(json.metrics.shopfrontH, 48);
      assert.match(json.metricsSource, /debugSettingScale 实测/);
    },
  });

  await run('墙高与常量不符：自洽判据必须红并 exit 1', {
    mode: 'mismatch',
    outName: 'mismatch',
    async check(result, outDir) {
      assert.equal(result.code, 1, '画面与常量不符必须非 0 退出');
      assert.match(result.stdout, /扫描：墙高 56（≠ 墙高：读数 56，期望 48，差 8）/);
      assert.match(result.stderr, /\[扫描自洽\] 判红：墙高扫描 56 ≠ 常量 48，差 8/);
      assert.equal(existsSync(jsonPath(outDir)), true, '判红前读数已落盘；exit 1 说明它不构成通过');
    },
  });

  await run('无钩子 + 改前：声明为改前基线，不参与判定', {
    mode: 'missing',
    label: 'before',
    outName: 'before',
    async check(result, outDir) {
      assert.equal(result.code, 0, '改前基线那一跑允许无钩子');
      assert.match(result.stdout, /\[改前基线\] 环境不支持 debugSettingScale/);
      assert.match(result.stdout, /改前基线常量，非本次实测、不参与判定/);
      const json = JSON.parse(readFileSync(join(outDir, 'setting-scale-before.json'), 'utf8'));
      assert.equal(json.metrics, null);
      assert.equal(json.metricsSource, '改前基线常量（非实测）');
      assert.equal(json.metricsFromBaselineConstant, true);
    },
  });

  await run('改前基线常量 + 并排图：允许合成，但必须带标注', {
    mode: 'ok',
    outName: 'compare',
    /** 一份「改前」确实是基线常量的 JSON（含画标尺要用的 cam / pins / ancient）+ 占位 PNG。 */
    prepare(outDir) {
      writeFileSync(
        join(outDir, 'setting-scale-before.json'),
        `${JSON.stringify({
          label: 'before',
          file: 'eval/screens/setting-scale-before.png',
          cam: { zoom: 2, worldViewX: 480, worldViewY: 345, width: 480, height: 320 },
          stats: { totalCommands: 12363, graphicsObjects: 46 },
          metrics: null,
          metricsSource: '改前基线常量（非实测）',
          metricsFromBaselineConstant: true,
          pins: { hero: { x: 600, y: 464, h: 30 } },
          scanned: { frameH: 32, stoneH: 4, bodyBottomH: 24 },
          ancient: { personH: 30, shopfrontH: 32, shopfrontTop: 0, lampPostH: 37, lampBodyBottom: 24 },
        })}\n`,
      );
      writeFileSync(
        join(outDir, 'setting-scale-before.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      );
    },
    async check(result, outDir) {
      assert.equal(result.code, 0, '改前基线常量允许进并排图，必须绿');
      assert.doesNotMatch(result.stderr, /\[并排图\] 判红/);
      assert.match(result.stdout, /并排图标注：改前为基线常量、非实测、未参与判定/);
      assert.equal(existsSync(join(outDir, 'setting-scale.png')), true, '并排图必须落盘');
      // 改前那份 JSON 仍然不带 metrics：人能看对比，机器拿不到可做差的数。
      const beforeJson = JSON.parse(readFileSync(join(outDir, 'setting-scale-before.json'), 'utf8'));
      assert.equal(beforeJson.metrics, null);
    },
  });

  console.log('\n全部通过：');
  for (const line of cases) console.log(`  ${line}`);
} catch (error) {
  console.error('\n存在失败：');
  for (const line of cases) console.error(`  ${line}`);
  process.exitCode = 1;
}
