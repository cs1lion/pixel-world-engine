import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bindCameraBar, type CameraOracle } from '../src/ui/camera-bar.ts';
import type { CameraMode } from '../src/render/camera-controller.ts';
import { installFakeDom } from './fake-dom.ts';

/**
 * 取景三按钮：按下态跟着 `mode()` 走，跟随按钮在没目标时是 disabled。
 *
 * 为什么值得单测：按下态**必须由场景推**，不能轮询——导播是闲置 15 秒后自己
 * 接管的，那一刻没有任何输入。这条契约只写在注释里的话，下次有人改回轮询
 * 也不会有任何东西变红，而症状（按钮停在旧状态）要盯 15 秒才看得见。
 */

function fakeApi(initial: CameraMode = 'free', can = false): {
  api: CameraOracle;
  mode: () => CameraMode;
  setMode: (mode: CameraMode) => void;
  setCanFollow: (value: boolean) => void;
  emit: (mode: CameraMode) => void;
  calls: CameraMode[];
} {
  let mode = initial;
  let canFollow = can;
  const calls: CameraMode[] = [];
  const listeners: ((mode: CameraMode) => void)[] = [];
  return {
    api: {
      cameraMode: () => mode,
      setCameraMode: (next) => {
        calls.push(next);
        mode = next;
      },
      canFollow: () => canFollow,
      onCameraMode: (listener) => {
        listeners.push(listener);
        return () => {};
      },
    },
    mode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    setCanFollow: (value) => {
      canFollow = value;
    },
    emit: (next) => {
      mode = next;
      for (const listener of listeners) listener(next);
    },
    calls,
  };
}

test('三个按钮，名字与顺序固定', () => {
  const dom = installFakeDom(['camera-bar']);
  try {
    bindCameraBar(() => fakeApi().api);
    const host = dom.byId('camera-bar');
    assert.deepEqual(
      host.children.map((button) => button.textContent),
      ['自由', '跟随', '导播'],
    );
    assert.deepEqual(
      host.children.map((button) => button.dataset.mode),
      ['free', 'follow', 'director'],
    );
  } finally {
    dom.restore();
  }
});

test('初始按下态来自 cameraMode()，没跟过谁时「跟随」是 disabled', () => {
  const dom = installFakeDom(['camera-bar']);
  try {
    bindCameraBar(() => fakeApi('director', false).api);
    const host = dom.byId('camera-bar');
    assert.equal(host.children[2]!.getAttribute('aria-pressed'), 'true', '导播此刻按着');
    assert.equal(host.children[0]!.getAttribute('aria-pressed'), 'false');
    assert.equal(host.children[1]!.disabled, true, '按了不动的按钮比没有按钮更糟');
  } finally {
    dom.restore();
  }
});

test('点击调 setCameraMode，不自己改按下态', () => {
  const dom = installFakeDom(['camera-bar']);
  try {
    const harness = fakeApi();
    bindCameraBar(() => harness.api);
    const host = dom.byId('camera-bar');
    host.children[1]!.click();
    assert.deepEqual(harness.calls, ['follow']);
    assert.equal(host.children[1]!.getAttribute('aria-pressed'), 'false', '等场景广播，不抢跑');
  } finally {
    dom.restore();
  }
});

test('场景广播一次，按下态跟着换——导播自己接管也走这条路', () => {
  const dom = installFakeDom(['camera-bar']);
  try {
    const harness = fakeApi();
    bindCameraBar(() => harness.api);
    const host = dom.byId('camera-bar');
    harness.emit('director');
    assert.equal(host.children[2]!.getAttribute('aria-pressed'), 'true');
    assert.equal(host.children[0]!.getAttribute('aria-pressed'), 'false');
    harness.emit('free');
    assert.equal(host.children[0]!.getAttribute('aria-pressed'), 'true');
  } finally {
    dom.restore();
  }
});

test('跟过一次之后「跟随」按钮可用', () => {
  const dom = installFakeDom(['camera-bar']);
  try {
    const harness = fakeApi();
    bindCameraBar(() => harness.api);
    const host = dom.byId('camera-bar');
    assert.equal(host.children[1]!.disabled, true);
    harness.setCanFollow(true);
    harness.emit('follow');
    assert.equal(host.children[1]!.disabled, false);
    assert.equal(host.children[1]!.title, '镜头跟住刚才看的那个人');
  } finally {
    dom.restore();
  }
});

test('重复绑定不长出第二排按钮', () => {
  const dom = installFakeDom(['camera-bar']);
  try {
    const harness = fakeApi();
    bindCameraBar(() => harness.api);
    bindCameraBar(() => harness.api);
    assert.equal(dom.byId('camera-bar').children.length, 3);
  } finally {
    dom.restore();
  }
});
