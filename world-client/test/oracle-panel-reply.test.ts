/**
 * 神谕面板的界面契约：回执那一行，来一次说一次，来晚了也补上。
 *
 * 为什么值得单立一项：`bindOraclePanel` 是这个仓库里唯一一处「世界的结果变成
 * 用户读得到的一句话」的地方，而它从前一行 DOM 测试都没有。`f332df0` 把等待
 * 从帧时钟搬到 `setTimeout`，`00e46bf` 又给它补了回放——两笔都只由 `whenApi`
 * 的单元测试和一道词级闸守着，而**调用点本身**（哪个监听器、往哪个元素写、
 * 什么时候不写）没有任何测试碰过。复核子 agent 专门点了这一条。
 *
 * 这里用一个假 document 驱动真的 `bindOraclePanel`，钉三件用户看得见的事：
 *
 * 1. **结果来了就往回执那一行写**，并且分得出「办了」与「拒了」。
 * 2. **空结果不擦那一行**。上游轮询每次都带一个结果过来，而它绝大多数时候
 *    无话可说——从前景说话它一开口，用户那句「雨落下来了。」就没了。
 * 3. **订阅来晚了，最后那句补给它**。场景挂上与界面订阅之间那段时间里产生的
 *    结果不能整条丢掉（`SandboxScene` 的 `onResult` 现在会补发，这一条钉的是
 *    面板这边真的把它写上屏）。
 *
 * 不做的事：不验那句话说得准不准。那是语义，机器判不了，也不该由测试假装能判。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bindOraclePanel, type OracleApi } from '../src/ui/oracle-panel.ts';

/** 一个够用的假元素：只实现 `bindOraclePanel` 真的会碰的那些面。 */
class FakeElement {
  textContent = '';
  hidden = false;
  className = '';
  type = '';
  value = '';
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Set<() => void>>();
  readonly tag: string;
  readonly id: string;
  constructor(tag: string, id = '') {
    this.tag = tag;
    this.id = id;
  }

  get classList(): { toggle(name: string, on: boolean): void } {
    const self = this;
    return {
      toggle(name: string, on: boolean): void {
        const parts = self.className.split(' ').filter((part) => part !== '' && part !== name);
        if (on) parts.push(name);
        self.className = parts.join(' ');
      },
    };
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    return node;
  }
  remove(): void {
    /* 假 DOM 不管摘除，父节点那一侧反正每次重建 */
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...nodes);
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  addEventListener(type: string, run: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(run);
    this.listeners.set(type, set);
  }
  click(): void {
    for (const run of this.listeners.get('click') ?? []) run();
  }
  submit(): void {
    for (const run of this.listeners.get('submit') ?? []) run();
  }
}

/** 一份能让 `bindOraclePanel` 完整跑起来的假 document。 */
function fakeDocument(): { doc: Document; byId(id: string): FakeElement } {
  const ids = [
    'oracle', 'utterance', 'reply', 'status', 'finish',
    'paper-headline', 'paper-lines', 'paper-date',
    'slab-count', 'slab-lines', 'decree', 'decree-title', 'decree-question',
    'world-state', 'build-row',
  ];
  const made = new Map<string, FakeElement>();
  for (const id of ids) made.set(id, new FakeElement(id === 'oracle' ? 'form' : 'div', id));
  const doc = {
    querySelector: (selector: string): FakeElement | null => {
      const match = /^#([\w-]+)$/.exec(selector);
      if (match === null) return null;
      return made.get(match[1]!) ?? null;
    },
    querySelectorAll: (): FakeElement[] => [],
    createElement: (tag: string): FakeElement => new FakeElement(tag),
  };
  return { doc: doc as unknown as Document, byId: (id) => made.get(id)! };
}

/** 一份最小的 OracleApi：只有面板真的会调的那几样。 */
function fakeApi(): {
  api: OracleApi;
  emitResult(result: { ok: boolean; message: string }): void;
  emitStatus(line: string): void;
  said: string[];
} {
  const resultListeners: ((result: { ok: boolean; message: string }) => void)[] = [];
  const statusListeners: ((line: string) => void)[] = [];
  const said: string[] = [];
  const api: OracleApi = {
    view: () => ({}) as never,
    say: (text: string) => {
      said.push(text);
      return { ok: true, message: '' };
    },
    dispatch: () => {},
    finish: () => {},
    saveNow: () => ({ ok: true, message: '' }),
    loadSave: () => ({ ok: true, message: '' }),
    clearSave: () => ({ ok: true, message: '' }),
    build: () => {},
    miracle: () => {},
    beginCreation: () => ({ ok: true, message: '' }),
    confirmCreation: () => ({ ok: true, message: '' }),
    cancelCreation: () => ({ ok: true, message: '' }),
    creation: () => null,
    injectBlocked: () => {},
    worldState: () => ({ line: '镇内 3 栋', missingWild: [], buildable: [] }),
    decree: () => null,
    renderStats: () => ({ graphicsObjects: 0, totalCommands: 0, largest: [] }),
    centerCameraOn: () => {},
    canPlaceAt: () => true,
    feed: () => ({ ok: true, message: '' }),
    onResult: (listener) => {
      resultListeners.push(listener);
      return () => {};
    },
    onStatus: (listener) => {
      statusListeners.push(listener);
      return () => {};
    },
    setPhase: () => {},
    currentPhase: () => 'noon',
    realPhase: () => 'noon',
    isAutoPhase: () => true,
    setAutoPhase: () => {},
    setNight: () => {},
    toggleNight: () => false,
    nightEnabled: () => false,
    report: () => ({ headline: '天下太平', lines: [], date: '今天' }),
    slab: () => [],
  };
  return {
    api,
    emitResult: (result) => {
      for (const listener of resultListeners) listener(result);
    },
    emitStatus: (line) => {
      for (const listener of statusListeners) listener(line);
    },
    said,
  };
}

test('结果来了就往回执那一行写，分得出办了与拒了', () => {
  const { doc, byId } = fakeDocument();
  const world = fakeApi();
  const realDocument = globalThis.document;
  globalThis.document = doc;
  try {
    bindOraclePanel(() => world.api);
    const reply = byId('reply');

    world.emitResult({ ok: true, message: '雨落下来了。' });
    assert.equal(reply.textContent, '雨落下来了。', '办成了就说办成了');
    assert.equal(reply.className.includes('bad'), false, '办成不是拒绝');

    world.emitResult({ ok: false, message: '世界上还没有接 code 的铺子。' });
    assert.equal(reply.textContent, '世界上还没有接 code 的铺子。', '拒了也说理由');
    assert.equal(reply.className.includes('bad'), true, '拒了要标出来');
  } finally {
    globalThis.document = realDocument;
  }
});

test('空结果不擦回执：上游轮询绝大多数时候无话可说', () => {
  // 这一条钉的是用户看得见的那一半。上游轮询每次都带一个结果过来，而它
  // 绝大多数时候无话可说——从前景说话它一开口，用户那句话就没了。
  const { doc, byId } = fakeDocument();
  const world = fakeApi();
  const realDocument = globalThis.document;
  globalThis.document = doc;
  try {
    bindOraclePanel(() => world.api);
    const reply = byId('reply');

    world.emitResult({ ok: true, message: '雨落下来了。' });
    // 上游轮询失败：世界每次都给一个空结果。
    for (let i = 0; i < 20; i += 1) world.emitResult({ ok: true, message: '' });
    assert.equal(reply.textContent, '雨落下来了。', '空结果不是回执，不许擦掉屏上那一句');
  } finally {
    globalThis.document = realDocument;
  }
});

test('订阅时送来的第一句话也写上屏：迟到的订阅不该拿不到', () => {
  // 场景挂上与界面订阅之间那段时间里产生的结果不能整条丢掉。`SandboxScene`
  // 的 `onResult` 现在会把最后一句有话说的补发给新订阅者（与 `onStatus` 同一个
  // 道理），这一条钉的是**面板这一半**：补发来的那一句，它真的写到屏上。
  //
  // 一个偷懒的 `onResult` 处理器（比如只在「有新事件」时才写）会让这一条红。
  const { doc, byId } = fakeDocument();
  const world = fakeApi();
  const realDocument = globalThis.document;
  globalThis.document = doc;
  try {
    // 让假 API 照场景的样子补发：订阅那一刻先把最后那句送过去。
    const late: OracleApi = {
      ...world.api,
      onResult: (listener) => {
        listener({ ok: true, message: '雨落下来了。' });
        return () => {};
      },
    };
    bindOraclePanel(() => late);
    assert.equal(byId('reply').textContent, '雨落下来了。', '订阅时补发的那句要写上屏');
  } finally {
    globalThis.document = realDocument;
  }
});

test('等不到世界时那句真话：这儿没有缝能触发它，所以不假装测过', () => {
  // 说清楚一件**没测**的事，比留一条永远绿的假测试老实。
  //
  // `bindOraclePanel` 给 `whenApi` 传了 `onGiveUp`，等不到就写「世界没有醒来。
  // 刷新页面再试。」。可触发它要真等 20 秒（`GIVE_UP_AFTER` × `RETRY_MS`），
  // 而 `schedule` 是从模块里头取的，调用点注不进去。为了测它把生产线改出个缝
  // 来不值当，所以 `whenApi` 的认输本身由 `when-api.test.ts` 钉住，面板这边
  // 的三行留给人看。哪天要给调用点做 DOM 测试，该做的是把等待本身变成可注入，
  // 而不是在这儿加一条 sleeps。
  const { doc } = fakeDocument();
  const realDocument = globalThis.document;
  globalThis.document = doc;
  try {
    bindOraclePanel(() => undefined);
    assert.equal(true, true, '能挂上、不抛，就是这一条全部断言');
  } finally {
    globalThis.document = realDocument;
  }
});
