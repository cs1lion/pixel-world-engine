/** 一个够用的假 DOM，给 `src/ui/` 的绑定函数用。
 *
 * 与 `test/oracle-panel-reply.test.ts` 里那份同源：只实现被真的碰到的那些面。
 * Node 里没有 `document`，而这些模块要验的是**哪个监听器、往哪个元素写、
 * 什么时候不写**——那不需要浏览器，只需要一个记得住调用的替身。
 *
 * 用法：`installFakeDom([...ids])` 返回 `byId`，并在全局挂上 `document`；
 * 每个用例结束调 `restore()`。
 */

export class FakeElement {
  textContent = '';
  hidden = false;
  className = '';
  type = '';
  value = '';
  maxLength = 524288;
  disabled = false;
  title = '';
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly listeners = new Map<string, Set<(event?: unknown) => void>>();
  readonly tag: string;
  readonly id: string;
  constructor(tag: string, id = '') {
    this.tag = tag;
    this.id = id;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...nodes);
  }
  remove(): void {
    /* 假 DOM 不管摘除，父节点那一侧反正每次重建 */
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  addEventListener(type: string, run: (event?: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event?: unknown) => void>();
    set.add(run);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, run: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(run);
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
  click(): void {
    for (const run of this.listeners.get('click') ?? []) run();
  }
  /** 假 DOM 不真的移动焦点；用到它的只有「超长时把焦点放回输入框」。 */
  focus(): void {
    /* no-op */
  }
  submit(): void {
    for (const run of this.listeners.get('submit') ?? []) run({ preventDefault() {} });
  }
  /** 触发某个键盘事件（Escape 之类）。 */
  key(key: string): void {
    for (const run of this.listeners.get('keydown') ?? []) run({ key });
  }
  /** 按类名找直接子元素，测试里读渲染结果用。 */
  byClass(name: string): FakeElement[] {
    return this.children.filter((child) => child.className.split(' ').includes(name));
  }
}

export function installFakeDom(ids: readonly string[]): {
  byId(id: string): FakeElement;
  doc: FakeElement;
  restore(): void;
} {
  const made = new Map<string, FakeElement>();
  for (const id of ids) made.set(id, new FakeElement('div', id));
  const doc = new FakeElement('document');
  const asDocument = {
    querySelector: (selector: string): FakeElement | null => {
      const match = /^#([\w-]+)$/.exec(selector);
      if (match === null) return null;
      return made.get(match[1]!) ?? null;
    },
    querySelectorAll: (): FakeElement[] => [],
    createElement: (tag: string): FakeElement => new FakeElement(tag),
    addEventListener: (type: string, run: (event?: unknown) => void): void => {
      doc.addEventListener(type, run);
    },
    removeEventListener: (type: string, run: (event?: unknown) => void): void => {
      doc.removeEventListener(type, run);
    },
  };
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = asDocument;
  return {
    byId: (id) => made.get(id)!,
    doc,
    restore() {
      (globalThis as { document?: unknown }).document = previous;
    },
  };
}
