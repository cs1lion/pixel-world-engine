import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraController } from '../src/render/camera-controller.ts';
import { DIRECTOR_DWELL_MS, DIRECTOR_IDLE_MS, viewOriginOf } from '../src/render/camera-math.ts';

/**
 * 控制器：模式切换、跟随的松开，以及「事件打断轮转」。
 *
 * 这一层以前**一条测试都没有**——`camera.test.ts` 只验纯数学，`director.test.ts`
 * 只验时钟，把两者接起来的那一百多行（谁在什么时候平移、什么时候不该）全靠肉眼。
 * 这里用一个二十行的假相机把它拉进 node：真相机要 DOM，而这里要验的是**顺序**，
 * 不是 Phaser 怎么画。
 */

interface FakeCamera {
  scrollX: number;
  scrollY: number;
  readonly width: number;
  readonly height: number;
  zoom: number;
  readonly panEffect: { isRunning: boolean; reset(): void };
  setBounds(): void;
  setZoom(value: number): void;
  pan(x: number, y: number): void;
  centerOn(x: number, y: number): void;
  startFollow(): void;
  stopFollow(): void;
}

function harness(options: { zoomIndex?: number } = {}): {
  ctl: ReturnType<typeof createCameraController>;
  cam: FakeCamera;
  calls: string[];
  pans: () => string[];
} {
  const calls: string[] = [];
  const cam = {
    scrollX: 0,
    scrollY: 0,
    width: 480,
    height: 320,
    zoom: 1,
    panEffect: {
      isRunning: false,
      reset() {
        calls.push('panReset');
        this.isRunning = false;
      },
    },
    setBounds() {
      calls.push('bounds');
    },
    setZoom(value: number) {
      this.zoom = value;
    },
    pan(x: number, y: number) {
      calls.push(`pan:${x},${y}`);
      this.panEffect.isRunning = true;
    },
    centerOn(x: number, y: number) {
      calls.push(`center:${x},${y}`);
    },
    startFollow() {
      calls.push('startFollow');
    },
    stopFollow() {
      calls.push('stopFollow');
    },
  };
  const scene = { cameras: { main: cam } } as unknown as Parameters<typeof createCameraController>[0];
  const ctl = createCameraController(scene, 1280, 960, options);
  return { ctl, cam, calls, pans: () => calls.filter((item) => item.startsWith('pan:')) };
}

// ------------------------------------------------------------------ 初始档位

test('默认档位真的设到相机上，不是只记了个索引', () => {
  // 原来只记 `zoomIndex = 2`，`cam.zoom` 停在 Phaser 的默认 1：索引说 2 倍、
  // 画面是 1 倍，滚轮第一格成了「放大」，2 倍永远到不了。
  assert.equal(harness().cam.zoom, 2);
  assert.equal(harness({ zoomIndex: 0 }).cam.zoom, 1);
});

test('缩放时守住视野原点，而不是守住 scrollX', () => {
  const { ctl, cam } = harness({ zoomIndex: 0 });
  cam.scrollX = 100;
  assert.equal(viewOriginOf(cam.scrollX, cam.width, cam.zoom), 100, '1 倍时 scroll 就是原点');

  ctl.zoomStep(1);
  assert.equal(cam.zoom, 1.5);
  assert.equal(viewOriginOf(cam.scrollX, cam.width, cam.zoom), 100, '放大后原点不该跳');
  assert.notEqual(cam.scrollX, 100, 'scrollX 必须跟着倍率改，否则就是原来那个 bug');
});

// ------------------------------------------------------------------ 模式

test('没跟过任何人时，「跟随」按了也不动', () => {
  const { ctl } = harness();
  assert.equal(ctl.canFollow(), false);
  ctl.setMode('follow');
  assert.equal(ctl.mode(), 'free', '没有目标就不该假装跟上了');
});

test('跟随之后可以松开，但「跟随」按钮仍然可用', () => {
  const { ctl, calls } = harness();
  ctl.follow({} as never);
  assert.equal(ctl.mode(), 'follow');
  ctl.setMode('free');
  assert.equal(ctl.mode(), 'free');
  assert.ok(calls.includes('stopFollow'), 'mode() 说自由了，Phaser 也得真的停下');
  assert.equal(ctl.canFollow(), true, '松开不等于忘掉跟的是谁');
});

test('notifyInput 会取消进行中的平移', () => {
  const { ctl, cam, calls } = harness();
  cam.panEffect.isRunning = true;
  ctl.notifyInput();
  assert.ok(calls.includes('panReset'), '否则拖拽会被 900ms 的导播平移逐帧盖掉');
});

// ------------------------------------------------------------------ 导播

test('显式按下导播：立刻接管，且第一个候选停满一档', () => {
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ]);
  ctl.setMode('director');
  assert.equal(ctl.mode(), 'director', '按了按钮不该还要等 15 秒');

  ctl.update(16);
  assert.deepEqual(pans(), ['pan:10,20'], '优先级最高的候选不能被跳过');

  ctl.update(16);
  assert.deepEqual(pans(), ['pan:10,20'], '同一档不该重复平移');

  ctl.update(DIRECTOR_DWELL_MS);
  assert.deepEqual(pans(), ['pan:10,20', 'pan:30,40'], '停满一档才换下一个');
});

test('离开导播再回来，会重新平移', () => {
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [{ x: 1, y: 1 }]);
  ctl.setMode('director');
  ctl.update(16);
  assert.equal(pans().length, 1);

  ctl.setMode('free');
  ctl.update(16);
  ctl.setMode('director');
  ctl.update(16);
  assert.equal(pans().length, 2, '第二次点导播要立刻动，不是干等一档');
});

test('事件只在导播里抢镜头', () => {
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [{ x: 1, y: 1 }]);
  ctl.setMode('free');
  ctl.notifyEvent({ x: 99, y: 99 });
  ctl.update(16);
  assert.deepEqual(pans(), [], '自由模式下玩家正看着某处，一次潮水不该把画面拽走');
});

test('导播里事件打断轮转，并吃掉这一档', () => {
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);
  ctl.setMode('director');
  ctl.update(16);
  assert.deepEqual(pans(), ['pan:1,1']);

  ctl.notifyEvent({ x: 99, y: 99 });
  ctl.update(16);
  assert.deepEqual(pans(), ['pan:1,1', 'pan:99,99'], '事件比轮转更该被看见');

  ctl.update(16);
  assert.deepEqual(pans(), ['pan:1,1', 'pan:99,99'], '刚落地不该立刻被轮转切走');

  ctl.update(DIRECTOR_DWELL_MS);
  assert.equal(pans().length, 3, '这一档过去了，轮转照常');
});

// ------------------------------------------------------------------ 视野

test('viewportRect 给的是视野原点，不是 scrollX', () => {
  const { ctl, cam } = harness();
  cam.scrollX = 0;
  cam.scrollY = 0;
  assert.deepEqual(ctl.viewportRect(), { x: 120, y: 80, width: 240, height: 160 });
});

// ------------------------------------------------------------------ 跟随与导播

test('跟随中导播不该抢镜头：闲置到点也不平移', () => {
  // 原来 `follow()` 只重置了一次闲置计时，时钟仍登记着：15 秒后导播一边平移、
  // Phaser 一边 startFollow，`mode()` 却还报告 'follow'。跟随是用户自己选的
  // 目标，不能被闲置计时抢走。
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [{ x: 10, y: 20 }]);
  ctl.follow({} as never);
  ctl.update(DIRECTOR_IDLE_MS + 100);
  assert.equal(ctl.mode(), 'follow');
  assert.deepEqual(pans(), []);
});

test('松开跟随后，闲置计时从松开那一刻重新起算', () => {
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [{ x: 10, y: 20 }]);
  ctl.follow({} as never);
  ctl.update(DIRECTOR_IDLE_MS + 100);
  ctl.releaseFollow();
  assert.equal(ctl.mode(), 'free', '松开就是自由，不是立刻导播');
  ctl.update(1000);
  assert.deepEqual(pans(), [], '刚松开不该马上被接管');
  ctl.update(DIRECTOR_IDLE_MS);
  assert.equal(pans().length, 1, '再闲置满一档才归导播');
});

test('用户输入会丢掉还没给镜头看的事件', () => {
  // 否则：导播里来了个事件 → 用户拖了一下镜头（退出导播）→ 再按导播，
  // 镜头会先跳到那个已经过时的落点。
  const { ctl, pans } = harness();
  ctl.enableDirector(() => [{ x: 1, y: 1 }]);
  ctl.setMode('director');
  ctl.update(16);
  ctl.notifyEvent({ x: 99, y: 99 });
  ctl.notifyInput();
  ctl.setMode('director');
  ctl.update(16);
  assert.deepEqual(pans(), ['pan:1,1', 'pan:1,1'], '过时的事件不该再抢一次镜头');
});

test('没有导播目标时按「导播」不把人踢出跟随', () => {
  const { ctl } = harness();
  ctl.follow({} as never);
  ctl.setMode('director');
  assert.equal(ctl.mode(), 'follow', '按了个不动的按钮，不该顺手松开跟随');
});
