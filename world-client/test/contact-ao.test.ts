import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 灯潮界的地形 token（与证据脚本的 TERRAIN_TOKENS 同值）。 */
const MUD = 0x202b35;
const GRASS = 0x30454a;
const STONE = 0x52666a;
const PLAZA = 0x7d8984;
const INK = 0x111821;
const CHARCOAL = 0x2c3439;

// ---------------------------------------------------------------- 动态模块
//
// 走动态 import 而不是静态 import：这条测试在 base 上必须红成「断言失败」，
// 而不是红成「模块不存在」。`contact-ao.ts` 是这次合入才有的模块，静态
// import 会让 `red:first` 把整条测试归成 `module` 错误（exit 2），那样就
// 看不出它到底在不在防某个行为。

interface ContactAoModule {
  readonly contactAoUnknownBaseCount?: () => number;
  readonly lumaOf?: (color: number) => number;
  readonly resetContactAoUnknownBaseCount?: () => void;
  readonly shouldDrawContactAo?: (groundBase: number | undefined, shade: number) => boolean;
}

const CONTACT_AO_MODULE_PATH = '../src/render/contact-ao.ts';

async function contactAo(): Promise<ContactAoModule> {
  try {
    return (await import(CONTACT_AO_MODULE_PATH)) as ContactAoModule;
  } catch {
    return {};
  }
}

const has = (mod: ContactAoModule, name: keyof ContactAoModule): void => {
  assert.equal(typeof mod[name], 'function', `render/contact-ao.ts 必须导出 ${String(name)}`);
};

/** 加载并逐个断言四个导出，返回可直接调用的模块。 */
async function ao(): Promise<Required<ContactAoModule>> {
  const mod = await contactAo();
  has(mod, 'contactAoUnknownBaseCount');
  has(mod, 'lumaOf');
  has(mod, 'resetContactAoUnknownBaseCount');
  has(mod, 'shouldDrawContactAo');
  return mod as Required<ContactAoModule>;
}

test('基底未知不许画，并记一次「取错落点」', async () => {
  const { contactAoUnknownBaseCount, resetContactAoUnknownBaseCount, shouldDrawContactAo } = await ao();
  resetContactAoUnknownBaseCount();
  assert.equal(shouldDrawContactAo(undefined, INK), false, '不知道基底时不能把「不知道」当亮底放行');
  assert.equal(contactAoUnknownBaseCount(), 1);
  assert.equal(shouldDrawContactAo(undefined, INK), false);
  assert.equal(contactAoUnknownBaseCount(), 2);
  resetContactAoUnknownBaseCount();
  assert.equal(contactAoUnknownBaseCount(), 0);
});

test('已知基底时，ink 比所有地形都暗 → 每一档都画', async () => {
  const { contactAoUnknownBaseCount, lumaOf, resetContactAoUnknownBaseCount, shouldDrawContactAo } = await ao();
  resetContactAoUnknownBaseCount();
  for (const base of [MUD, GRASS, STONE, PLAZA]) {
    assert.ok(lumaOf(INK) < lumaOf(base), `ink 应比 ${base.toString(16)} 暗`);
    assert.equal(shouldDrawContactAo(base, INK), true);
  }
  assert.equal(contactAoUnknownBaseCount(), 0, '已知基底不该计入「未知」');
});

test('阴影色比基底亮时不画，但不算「未知基底」', async () => {
  const { contactAoUnknownBaseCount, lumaOf, resetContactAoUnknownBaseCount, shouldDrawContactAo } = await ao();
  resetContactAoUnknownBaseCount();
  assert.ok(lumaOf(CHARCOAL) > lumaOf(MUD));
  assert.equal(shouldDrawContactAo(MUD, CHARCOAL), false, '提亮语义错误：不产出矩形');
  assert.equal(contactAoUnknownBaseCount(), 0, '这是「提亮」分支，不是「取错落点」');
});

test('计数为 0 是默认状态：不调用判定就不涨', async () => {
  const { contactAoUnknownBaseCount, resetContactAoUnknownBaseCount } = await ao();
  resetContactAoUnknownBaseCount();
  assert.equal(contactAoUnknownBaseCount(), 0);
});
