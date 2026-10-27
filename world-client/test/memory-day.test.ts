import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAY_MS } from '../src/world/memory/config.ts';
import { LAMP_DAY_MS } from '../src/world/lampoil.ts';

/**
 * 「一天」到底多长：三处各写了一遍，钉住它们一致。
 *
 * 为什么会有三份：记忆层不 import 灯油那一份（灯油自己写着只活在渲染层，
 * 记忆反过来依赖渲染层会把依赖方向弄反），服务端是 Python，import 不过来。
 * 于是同一个数写了三遍——那就得有一处把它们钉在一起，否则迟早有一边
 * 悄悄改了，而症状是「第 3 天」在客户端和服务端指的不是同一天。
 */

const ONE_DAY = 24 * 60 * 60 * 1000;

test('记忆层与渲染层对「一天」的理解一致', () => {
  assert.equal(DAY_MS, LAMP_DAY_MS);
  assert.equal(DAY_MS, ONE_DAY);
});

test('服务端与客户端对「一天」的理解一致', () => {
  // 服务端那份是从源码里读的，不是再抄一个数——抄的话这条测试就只是在
  // 比较两个我刚刚写下的字面量。
  const source = readFileSync(new URL('../../server/memory/snapshot.py', import.meta.url), 'utf8');
  const match = /^DAY_MS\s*=\s*([0-9_*\s]+)$/m.exec(source);
  assert.ok(match !== null, 'server/memory/snapshot.py 里找不到 DAY_MS 的字面量定义');
  // Python 允许 `24 * 60 * 60 * 1000` 这种写法，去掉下划线后按算术求值。
  const expression = match[1]!.replace(/_/g, '').trim();
  const value = expression.split('*').reduce((product, part) => product * Number(part.trim()), 1);
  assert.equal(value, DAY_MS, `服务端一天是 ${value}ms，客户端是 ${DAY_MS}ms`);
});
