import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';

/**
 * 参数表里每一个旋钮都得真的接在线上。
 *
 * `config.ts` 的抬头写着「调参的前提是能一眼看到全部旋钮。散开之后，改一个
 * 阈值要先 grep 半个仓库，调参就退化成碰运气」。那句话守的是**散开**这个病，
 * 它守不住另一个更安静的：旋钮在表里，但没有任何代码读它。
 *
 * 那种旋钮比没有更坏。改它的人会以为世界变了——而世界一个字节都没变，
 * 也没有任何地方会报错。第一版落地时就是这样：47 个旋钮里有 7 个从没被
 * 读过（`indoorSameRoom`、`weekLength`、`dialogueTopK`、`talkTopicsPerChat`、
 * `letterClaims`、`diaryClaimsPerDay`、`traceRadius`），而注释里还写着
 * 「书面（信件/日记）走 `written.ts`」——那个文件根本不存在。
 *
 * 这条测试不检查「接得对不对」（那是各模块自己的测试的事），只检查
 * **接没接**。它允许两种正当的沉默，都必须在下面这两个名单里写明理由：
 *
 * - `NOT_YET`：本组范围内确实还没到，并写清由谁、在哪一步接上；
 * - `NOT_A_KNOB`：根本不是旋钮（比如 `dayMs` 是量纲，不是可调参数）。
 *
 * 名单只许变短或换理由。想加一项，先回答「它为什么可以是个死数」。
 */

const MEMORY_DIR = new URL('../src/world/memory/', import.meta.url);

/**
 * 本组范围内还没接线，且**有明确归属**的旋钮。
 *
 * 目前为空：七个死旋钮已全部接线（见 `written.ts`、`traces.ts`、`propagate.ts`、
 * `consolidate.ts`）。加一项之前先问：是不是只是漏了一行调用？
 */
const NOT_YET: ReadonlyMap<string, string> = new Map();

/** 不是旋钮的东西。 */
const NOT_A_KNOB: ReadonlyMap<string, string> = new Map([
  ['dayMs', '量纲，不是可调参数：一天多长是 ADR 定的，不在这里调'],
]);

/** 表里所有旋钮的名字。从 `DEFAULT_MEMORY_CONFIG` 的键里取，不从接口里取—— */
/** 接口可以声明一个键而默认值忘了给，那种情况该在别处红，不该在这里被当成「有旋钮」。 */
function knobNames(): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(DEFAULT_MEMORY_CONFIG)) {
    names.push(key);
    // 一层嵌套：`salienceWeights.emotion` 这类子旋钮同样要接线。
    if (value !== null && typeof value === 'object') {
      for (const sub of Object.keys(value)) names.push(sub);
    }
  }
  return names.sort();
}

/** `src/world/memory/` 下每个文件去掉注释之后的正文。 */
function sources(): { readonly file: string; readonly code: string }[] {
  const dir = MEMORY_DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && name !== 'config.ts')
    .map((name) => {
      const text = readFileSync(join(dir, name), 'utf8');
      // 注释里提到一个旋钮名不算接线——那正是这次要抓的病。
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
      return { file: name, code };
    });
}

test('config 里每一个旋钮都至少被读一次', () => {
  const code = sources();
  const dead: string[] = [];
  for (const name of knobNames()) {
    if (NOT_YET.has(name) || NOT_A_KNOB.has(name)) continue;
    const read = code.some((source) => new RegExp(`\\b${name}\\b`).test(source.code));
    if (!read) dead.push(name);
  }
  assert.deepEqual(
    dead,
    [],
    `这些旋钮从没被读过，改它们世界不会有任何变化：\n  ${dead.join('\n  ')}\n` +
      '接线，或者写进 NOT_YET / NOT_A_KNOB 并说明为什么可以是个死数。',
  );
});

test('豁免名单只许变短：每一项都得说清为什么', () => {
  for (const [name, reason] of [...NOT_YET, ...NOT_A_KNOB]) {
    assert.ok(knobNames().includes(name), `${name} 已经不是旋钮了，从豁免名单里删掉`);
    assert.ok(reason.trim().length >= 8, `${name} 的豁免理由太短，等于没说`);
  }
});

test('config 的接口与默认值一一对应，没有只声明不给值的键', () => {
  // 这条防的是另一种沉默：接口里加了 `readonly foo: number`，默认值忘了给，
  // 于是 `config.foo` 是 `undefined`，所有比较都静默变成 false。
  const source = readFileSync(new URL('../src/world/memory/config.ts', import.meta.url), 'utf8');
  const iface = /export interface MemoryConfig \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(iface !== null, '找不到 MemoryConfig 接口');
  const declared = [...iface[1]!.matchAll(/^\s*readonly\s+(\w+)\s*:/gm)].map((m) => m[1]!);
  const given = Object.keys(DEFAULT_MEMORY_CONFIG);
  const missing = declared.filter((name) => !given.includes(name));
  assert.deepEqual(missing, [], `接口声明了但没有默认值：${missing.join('、')}`);
});
