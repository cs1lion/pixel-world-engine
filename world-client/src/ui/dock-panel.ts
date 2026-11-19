/** 镇志抽屉的停靠：贴左 / 贴右 / 还原，拖边调宽，偏好记进 localStorage。
 *
 * 停靠后它占窗口一整列（顶到底），不再是浮在角落上的一块：读编年史是
 * 「边看世界边翻过去」的事，浮动抽屉每次只露出三行，翻两页就累了。
 * 画布容器（`#stage`）跟着让位——`body` 上挂的停靠类把整列的余量挪给
 * 面板，主视野不被遮一分钱。
 *
 * 两条纪律：
 *
 * 1. **偏好只记布局，不记内容**。localStorage 里只有「贴哪边、多宽」两个数；
 *    镇志全文仍每次从服务端读（那本抽屉本来就是只读的）。
 * 2. **坏偏好当没写过**。localStorage 可能被别的标签页、写坏的扩展动过，
 *    解析失败就回到「不停靠 + 默认宽」，不拿半份坏配置把面板摆到奇形怪状。
 *
 * 纯函数（解析 / 夹紧 / 拖拽换算）与 DOM 胶水分开：前者可单测，后者在
 * 假 DOM 上只验「按钮按下后写了什么」。
 */

/** 停在哪边。`off` 是还原成浮动抽屉。 */
export type DockSide = 'left' | 'right' | 'off';

export interface DockPref {
  readonly side: DockSide;
  readonly width: number;
}

/** 拖边调宽的边界：窄于 240 读不动长句，宽于 560 画布让不出来。 */
export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 560;
export const DOCK_DEFAULT_WIDTH = 340;

/** localStorage 的键。值就是 `serializeDockPref` 的输出。 */
export const DOCK_STORAGE_KEY = 'pwe-chronicle-dock';

export const DEFAULT_DOCK_PREF: DockPref = { side: 'off', width: DOCK_DEFAULT_WIDTH };

/** 宽度先四舍五入到整像素，再夹进可调区间。半像素宽在高分屏上会抖。 */
export function clampDockWidth(width: number): number {
  if (!Number.isFinite(width)) return DOCK_DEFAULT_WIDTH;
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
}

/**
 * 解析存下来的偏好。任何一环对不上（坏 JSON、边不在枚举里、宽度不是数）
 * 都回默认值——见文件头第二条纪律。
 */
export function parseDockPref(raw: string | null): DockPref {
  if (raw === null) return DEFAULT_DOCK_PREF;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_DOCK_PREF;
  }
  if (parsed === null || typeof parsed !== 'object') return DEFAULT_DOCK_PREF;
  const record = parsed as Record<string, unknown>;
  const side = record.side === 'left' || record.side === 'right' ? record.side : 'off';
  const width = typeof record.width === 'number' ? clampDockWidth(record.width) : DOCK_DEFAULT_WIDTH;
  return { side, width };
}

export function serializeDockPref(pref: DockPref): string {
  return JSON.stringify({ side: pref.side, width: clampDockWidth(pref.width) });
}

/** 停靠时 `body` 上挂的类名；`off` 没有类，名副其实地返回 `null`。 */
export function dockBodyClass(side: DockSide): 'dock-left' | 'dock-right' | null {
  return side === 'left' ? 'dock-left' : side === 'right' ? 'dock-right' : null;
}

/**
 * 拖边时的宽度换算：左停靠往右拖变宽，右停靠往右拖变窄——手柄都在
 * 「面板与画布之间」那一边，所以两个方向的符号相反。
 */
export function dockWidthAfterDrag(startWidth: number, deltaX: number, side: DockSide): number {
  return clampDockWidth(side === 'left' ? startWidth + deltaX : startWidth - deltaX);
}

/** 布局偏好怎么读写。生产是 localStorage，测试注假的。 */
export interface DockStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

function defaultStorage(): DockStorage | null {
  // Node 单测里没有 localStorage；隐私模式下它也可能抛。两种都当「没偏好」。
  try {
    const storage = typeof localStorage === 'undefined' ? null : localStorage;
    return storage === null ? null : {
      getItem: (key: string) => storage.getItem(key),
      setItem: (key: string, value: string) => storage.setItem(key, value),
    };
  } catch {
    return null;
  }
}

/** 停靠要动的几个 DOM 点。缺了任何一个都不装（装一半的面板比没有更糟）。 */
export interface DockMount {
  readonly host: HTMLElement;
  readonly toLeft: HTMLButtonElement | null;
  readonly toRight: HTMLButtonElement | null;
  readonly restore: HTMLButtonElement | null;
  readonly body: HTMLElement | null;
}

function defaultMount(): DockMount | null {
  const host = document.querySelector<HTMLElement>('#chronicle');
  if (host === null) return null;
  return {
    host,
    toLeft: document.querySelector<HTMLButtonElement>('#chronicle-dock-left'),
    toRight: document.querySelector<HTMLButtonElement>('#chronicle-dock-right'),
    restore: document.querySelector<HTMLButtonElement>('#chronicle-dock-restore'),
    body: typeof document !== 'undefined' ? (document.body ?? null) : null,
  };
}

/**
 * 把手柄造出来：运行时建，不进 index.html——停靠没开时它不该存在，
 * 静态写死就等于每个打开镇志的人都看见一根拖不动的棍子。
 */
function makeResizer(): HTMLDivElement {
  const handle = document.createElement('div');
  handle.className = 'dock-resizer';
  handle.title = '拖边调宽';
  return handle;
}

export function bindDockPanel(options: { readonly storage?: DockStorage | null } = {}): void {
  const mount = defaultMount();
  if (mount === null) return;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  let current: DockPref = DEFAULT_DOCK_PREF;
  // 手柄只有在停靠时才露面：还原（off）后它是一根没有面板的棍子，藏掉。
  const resizer = makeResizer();
  mount.host.append(resizer);

  /**
   * 把偏好落到 DOM 上：面板自己的类、`body` 的让位列、以及那根手柄
   * 只在停靠时存在。CSS 变量挂在 `body` 上，`#stage` 的让位宽度跟着它走。
   */
  const apply = (pref: DockPref): void => {
    current = pref;
    const bodyClass = dockBodyClass(pref.side);
    mount.host.classList.toggle('docked', pref.side !== 'off');
    mount.host.classList.toggle('dock-left', pref.side === 'left');
    mount.host.classList.toggle('dock-right', pref.side === 'right');
    const body = mount.body;
    if (body !== null) {
      body.classList.toggle('dock-left', bodyClass === 'dock-left');
      body.classList.toggle('dock-right', bodyClass === 'dock-right');
      // 假 DOM 的 `style` 是个普通记录，没有 `setProperty`；真浏览器才有。
      const style = body.style as unknown as { setProperty?: (name: string, value: string) => void };
      if (typeof style.setProperty === 'function') {
        style.setProperty('--dock-w', `${pref.width}px`);
      }
    }
    resizer.hidden = pref.side === 'off';
  };

  const save = (): void => {
    if (storage === null) return;
    storage.setItem(DOCK_STORAGE_KEY, serializeDockPref(current));
  };

  const choose = (side: DockSide): void => {
    apply({ side, width: current.width });
    save();
  };

  mount.toLeft?.addEventListener('click', () => choose('left'));
  mount.toRight?.addEventListener('click', () => choose('right'));
  mount.restore?.addEventListener('click', () => choose('off'));

  // 拖边：指针按下记起点，移动时只改宽度不落盘，抬起才写偏好。
  // 拖到一半关掉页面，也不过是下次还是旧宽度——不是坏数据。
  let dragStart: { x: number; width: number } | null = null;
  resizer.addEventListener('pointerdown', (event: Event) => {
    const pointer = event as PointerEvent;
    dragStart = { x: pointer.clientX, width: current.width };
    resizer.hidden = false;
  });
  const onMove = (event: Event): void => {
    const start = dragStart;
    if (start === null || current.side === 'off') return;
    const pointer = event as PointerEvent;
    apply({ side: current.side, width: dockWidthAfterDrag(start.width, pointer.clientX - start.x, current.side) });
  };
  const onUp = (): void => {
    if (dragStart === null) return;
    dragStart = null;
    save();
  };
  // 拖边是浏览器手势；假 DOM（Node 单测）里这两个监听不存在，跳过即可——
  // 宽度换算本身是纯函数，另有单测钉着。
  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // 先读偏好再摆：页面一开就是上一回的样子，而不是闪一下再跳。
  const raw = storage?.getItem(DOCK_STORAGE_KEY) ?? null;
  apply(parseDockPref(raw));
}
