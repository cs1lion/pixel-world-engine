/** 11-11 参考图装饰素材的接线判据。
 *
 * 这里只钉三件能被单测抓住的事：素材路径 / id 映射是纯函数、`?art=0`
 * 一张图都不挂、装饰是附加节点不动已有文字。观感由浏览器截图负责。
 *
 * 动态 import + `typeof` 断言：本模块依赖的 `art-decor.ts` 与
 * `art-assets.ts` 的新导出在 base 上都不存在，red-first 只套 test/ 的
 * diff，必须红在断言上而不是 import 报错（B7）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.ts';

const assets = (await import('../src/render/art-assets.ts')) as unknown as {
  artAssetPath?: (kind: string, id: string) => string;
  activityDecorId?: (activity: string) => string | null;
  villagerBadgeId?: (villagerId: string) => string;
  emoteIdFor?: (index: number) => string;
  artEnabledOf?: (search: string) => boolean;
};
// `art-decor.ts` 是本轮新文件，base 上没有：把 import 失败吞成空对象，
// 让 red-first 在 base 上红在下面的断言，而不是 ERR_MODULE_NOT_FOUND（B7）。
let decor: {
  appendDecor?: (host: HTMLElement, kind: string, id: string | null, className: string) => boolean;
  decorEnabled?: () => boolean;
  decorUrl?: (kind: string, id: string) => string;
} = {};
try {
  decor = (await import('../src/ui/art-decor.ts')) as typeof decor;
} catch {
  // 缺文件本身就是「实现还没落地」，交给断言判。
}

assert.equal(typeof assets.artAssetPath, 'function', 'artAssetPath 必须存在');
assert.equal(typeof assets.activityDecorId, 'function', 'activityDecorId 必须存在');
assert.equal(typeof assets.villagerBadgeId, 'function', 'villagerBadgeId 必须存在');
assert.equal(typeof assets.emoteIdFor, 'function', 'emoteIdFor 必须存在');
assert.equal(typeof decor.appendDecor, 'function', 'appendDecor 必须存在');
assert.equal(typeof decor.decorEnabled, 'function', 'decorEnabled 必须存在');
assert.equal(typeof decor.decorUrl, 'function', 'decorUrl 必须存在');

const path = assets.artAssetPath!;
const activityDecorId = assets.activityDecorId!;
const villagerBadgeId = assets.villagerBadgeId!;
const emoteIdFor = assets.emoteIdFor!;
const appendDecor = decor.appendDecor!;
const decorEnabled = decor.decorEnabled!;
const decorUrl = decor.decorUrl!;

test('素材路径与清单键同形：kind/id.png，不带前导斜杠以外的东西', () => {
  assert.equal(path('state', 'workshop-02'), 'assets/state/workshop-02.png');
  assert.equal(path('icon', 'role-03'), 'assets/icon/role-03.png');
  assert.equal(decorUrl('emote', 'emote-00'), '/assets/emote/emote-00.png');
});

test('楼四态 -> 工坊四态，一一对应；认不得的状态不硬编一张图', () => {
  assert.deepEqual(
    ['idle', 'operating', 'overheating', 'cooling'].map(activityDecorId),
    ['workshop-00', 'workshop-01', 'workshop-02', 'workshop-03'],
  );
  assert.equal(activityDecorId('unknown'), null);
});

test('七个村民共用五张徽记，按序号轮转；坏 id 不抛也不越界', () => {
  assert.deepEqual(
    ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map(villagerBadgeId),
    ['role-00', 'role-01', 'role-02', 'role-03', 'role-04', 'role-00', 'role-01'],
  );
  assert.equal(villagerBadgeId('not-a-villager'), 'role-00');
});

test('表情轮转跳过纯色块那一格（emote-09），负数也落在闭集里', () => {
  const ids = Array.from({ length: 12 }, (_, i) => emoteIdFor(i));
  assert.ok(!ids.includes('emote-09'), 'emote-09 是参考图里的两个色块，不是表情');
  assert.equal(new Set(ids).size, 11, '十一张可用表情各轮到一次');
  assert.equal(emoteIdFor(-1), 'emote-11', '负下标绕到末尾');
  assert.equal(emoteIdFor(11), 'emote-00', '第十一轮回到第一张，不越界');
});

test('装饰是纯附加：不改宿主文字，只追加一个无文本的 img', () => {
  const dom = installFakeDom(['host']);
  try {
    const host = dom.byId('host') as unknown as HTMLElement;
    host.textContent = '此刻有人在里面干活。';
    assert.equal(appendDecor(host, 'state', 'workshop-01', 'art-state-icon'), true);
    assert.equal(host.textContent, '此刻有人在里面干活。');
    assert.equal((host as unknown as { children: unknown[] }).children.length, 1);
    const img = (host as unknown as { children: { tag: string; className: string; attributes: Record<string, string> }[] }).children[0]!;
    assert.equal(img.tag, 'img');
    assert.equal(img.className, 'art-state-icon');
    assert.equal(img.attributes['src'], '/assets/state/workshop-01.png');
  } finally {
    dom.restore();
  }
});

test('id 为 null 或素材关掉时，一个节点都不建', () => {
  const dom = installFakeDom(['host']);
  const previous = (globalThis as { location?: unknown }).location;
  try {
    const host = dom.byId('host') as unknown as HTMLElement;
    assert.equal(appendDecor(host, 'state', null, 'x'), false);
    assert.equal((host as unknown as { children: unknown[] }).children.length, 0);
    (globalThis as { location?: unknown }).location = { search: '?art=0' };
    assert.equal(decorEnabled(), false, 'art=0 是唯一关法');
    assert.equal(appendDecor(host, 'state', 'workshop-01', 'x'), false);
    assert.equal((host as unknown as { children: unknown[] }).children.length, 0);
  } finally {
    if (previous === undefined) delete (globalThis as { location?: unknown }).location;
    else (globalThis as { location?: unknown }).location = previous;
    dom.restore();
  }
});
