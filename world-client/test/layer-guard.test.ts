/**
 * 层边界守卫（2026-11-19 起，chore/unlock-presentation-gates）：
 *
 * 三条边界，两条防火墙一条沙盒：
 *
 * 1. **世界内核的确定性**：`src/world/**` 零 `Date.now` / `performance.now` /
 *    `Math.random` / `new Date(`。存档与 Trajectory 指纹的确定性靠这条兜住。
 *    唯一例外是 `Simulation` 构造时收下注入墙钟的默认值那一行，形态整行钉死
 *    （与 `purity.test.ts` 的 `WALL_CLOCK_DEFAULT` 同一份白名单）。
 * 2. **表现层随机的防火墙**：`src/render/fx-ambient/**` 是纯装饰环境动效
 *    （风摆、飞鸟、涟漪、光晕呼吸、镜头阻尼），豁免视觉时钟与独立视觉 PRNG
 *    ——但它只许读世界、不许写世界：不得 import `src/world/**`，代码里不得出现
 *    `WorldState` 标识符。装饰一旦能碰世界状态，「世界自己跑」就不再成立。
 * 3. **labs 沙盒**：`src/labs/**` 是实验原型区。流程面的豁免（免 red:first、
 *    免 screens-diff、转正移出后补全 EDD）写在 `CLAUDE.md` 与
 *    `scripts/red-first-lib.ts` 的跳过清单里；这条静态扫描守的是它的另一面：
 *    实验代码不得被生产路径接走——`src/` 下除 labs 自己以外的任何文件都不得
 *    import `src/labs/**`（静态 `from` 与动态 `import()` 同罪）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOf } from './source-scan.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const ALL_SRC = walk(SRC);

/** 世界里唯一的合法墙钟读者：注入默认值那一行，整行匹配，挪作他用即红。 */
const WALL_CLOCK_DEFAULT = 'deps.wallClock ?? (() => Date.now())';

test('src/world 全目录：零墙钟、零随机（除注入默认值那一行）', () => {
  // purity.test.ts 管「潮汐不读墙钟」与「§4.6 三个状态位」；这条把范围扩到
  // 整个 src/world：存档与 Trajectory 指纹要逐字节确定性，任何一处问时钟、
  // 摇随机都会让同一份存档回放出两条未来。
  const banned = ['Date.now', 'performance.now', 'Math.random', 'new Date('];
  const offenders: string[] = [];
  for (const file of ALL_SRC) {
    const rel = file.slice(SRC.length + 1).split('\\').join('/');
    if (!rel.startsWith('world/')) continue;
    const code = codeOf(file)
      .split('\n')
      .filter((line) => !line.includes(WALL_CLOCK_DEFAULT))
      .join('\n');
    const hits = banned.filter((pattern) => code.includes(pattern));
    if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], `世界内核必须零墙钟零随机：\n${offenders.join('\n')}`);
});

test('fx-ambient 防火墙：豁免视觉时钟与视觉 PRNG，严禁触碰世界内核', () => {
  const dir = join(SRC, 'render', 'fx-ambient');
  if (!existsSync(dir)) {
    // 目录未建：防火墙是写进 CLAUDE.md 的约定，守卫已就位，建目录即生效。
    // 不是静默跳过——这条断言的对象是约定本身，无目录即无人违反。
    console.log('fx-ambient 未建：防火墙约定已就位（豁免视觉时钟/PRNG、禁写世界）。');
    return;
  }
  const offenders: string[] = [];
  for (const file of walk(dir)) {
    const code = codeOf(file);
    // 写世界的唯一门是世界内核的模块边界：装饰层 import 它就够得着 WorldState。
    if (/from\s+['"](\.\.\/)*world\//.test(code)) offenders.push(`${file}: import src/world`);
    // 类型名也不许出现：碰了类型迟早碰写入。
    if (/\bWorldState\b/.test(code)) offenders.push(`${file}: WorldState 标识符`);
  }
  assert.deepEqual(offenders, [], `fx-ambient 是纯装饰层，不得触碰世界内核：\n${offenders.join('\n')}`);
});

test('labs 沙盒：实验原型不得被生产路径接走', () => {
  const labsDir = join(SRC, 'labs');
  if (!existsSync(labsDir)) {
    console.log('src/labs 未建：沙盒约定已就位（免 red:first / screens-diff，转正补 EDD）。');
    return;
  }
  const offenders: string[] = [];
  for (const file of ALL_SRC) {
    const rel = file.slice(SRC.length + 1).split('\\').join('/');
    if (rel.startsWith('labs/')) continue; // labs 内部互 import 是它自己的事。
    const code = codeOf(file);
    if (/from\s+['"](\.\.\/)*labs\//.test(code)) offenders.push(`${file}: import src/labs`);
    // 动态 import() 与静态 from 同罪：`await import('../labs/probe.ts')` 也是接走。
    if (/import\s*\(\s*['"](\.\.\/)*labs\//.test(code)) offenders.push(`${file}: 动态 import src/labs`);
  }
  assert.deepEqual(offenders, [], `实验原型不得进生产路径：\n${offenders.join('\n')}`);
});
