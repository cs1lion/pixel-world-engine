/**
 * 顶栏世界切换器与「全员大模型」快捷体验条。
 *
 * 纯 UI 视图层：
 * - 列出当前仓库已注册的全部世界（灯潮界 / 莞尔镇 / 空景），点击保留调试/视觉参数一键切换；
 * - 提供「⚡ 全员大模型」快捷按钮，一键向后端 `/api/world/intent` 发起真实大模型驱动请求并实时展示回执。
 */

export interface WorldCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly note: string;
}

export const REGISTERED_WORLDS: readonly WorldCatalogEntry[] = [
  { id: 'dengchao', title: '灯潮界', note: '7 人精绘海港夜景 · 推荐主力世界' },
  { id: 'default', title: '莞尔镇', note: '传统起点小镇 · 经典基线世界' },
  { id: 'empty-map', title: '空景', note: '极简空地 · 感官与布局测试场' },
];

export function currentWorldIdOf(search: string): string {
  const params = new URLSearchParams(search);
  const raw = (params.get('world') ?? '').trim();
  if (!raw) return 'default';
  return REGISTERED_WORLDS.some((w) => w.id === raw) ? raw : raw;
}

export function buildWorldSwitchUrl(currentHref: string, targetWorldId: string): string {
  const url = new URL(currentHref);
  if (targetWorldId === 'default') {
    url.searchParams.delete('world');
  } else {
    url.searchParams.set('world', targetWorldId);
  }
  return url.toString();
}

export function bindWorldSwitcherAndLlmBar(): void {
  const topbar = document.querySelector<HTMLElement>('#topbar');
  if (topbar === null) return;

  const activeId = currentWorldIdOf(window.location.search);

  // 1. 世界列表与切换按钮
  const wrap = document.createElement('div');
  wrap.className = 'world-switch-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = 'world-switch-btn';
  trigger.className = 'world-switch-btn';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = '切换世界 ▾';

  const menu = document.createElement('div');
  menu.id = 'world-switch-menu';
  menu.className = 'world-switch-menu';
  menu.hidden = true;

  for (const world of REGISTERED_WORLDS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = world.id === activeId ? 'world-switch-item is-current' : 'world-switch-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'world-switch-name';
    nameEl.textContent = world.id === activeId ? `${world.title}（当前）` : world.title;
    const noteEl = document.createElement('span');
    noteEl.className = 'world-switch-note';
    noteEl.textContent = world.note;
    item.append(nameEl, noteEl);
    item.addEventListener('click', () => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (world.id === activeId) return;
      window.location.assign(buildWorldSwitchUrl(window.location.href, world.id));
    });
    menu.append(item);
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextOpen = menu.hidden;
    menu.hidden = !nextOpen;
    trigger.setAttribute('aria-expanded', String(nextOpen));
  });

  document.addEventListener('click', (event) => {
    if (menu.hidden) return;
    if (!wrap.contains(event.target as Node)) {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  wrap.append(trigger, menu);

  // 2. 全员大模型快捷体验按钮 + 实时回执条
  const llmBtn = document.createElement('button');
  llmBtn.type = 'button';
  llmBtn.id = 'llm-quick-trigger';
  llmBtn.className = 'llm-quick-btn';
  llmBtn.textContent = '⚡ 全员大模型';

  const toast = document.createElement('div');
  toast.id = 'llm-live-toast';
  toast.className = 'llm-live-toast';
  toast.hidden = true;

  let busy = false;
  llmBtn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    llmBtn.disabled = true;
    llmBtn.textContent = '⚡ 思考中…';
    toast.hidden = false;
    toast.textContent = '正在呼叫大模型驱动全镇居民思考与行动…';

    const startedAt = performance.now();
    const prompt = '请结合当前天气与时辰，让全镇居民各自发表一句贴合性格的感叹并展开行动';
    void fetch('/api/world/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt, world: activeId }),
    })
      .then(async (res) => {
        const ms = Math.round(performance.now() - startedAt);
            let data: Record<string, unknown> | null = null;
        try {
          data = (await res.json()) as Record<string, unknown>;
          } catch {
          data = null;
        }
          if (!res.ok) {
            const detail = typeof data?.['detail'] === 'string' ? data['detail'] : '请检查后端服务日志';
            toast.textContent = `大模型调用返回 ${res.status}（${ms}ms）：${detail.slice(0, 120)}`;
            return;
          }
            const speech = data?.['reply'] ?? data?.['summary'] ?? data?.['intent'] ?? data?.['message'];
        const summary =
            typeof speech === 'string' && speech.trim()
            ? speech.trim()
          : data !== null
            ? JSON.stringify(data).slice(0, 160)
          : '已收到大模型响应';
        toast.textContent = `✓ 大模型已响应（${ms}ms）：${summary}`;
        })
      .catch((err: unknown) => {
        toast.textContent = `无法连接大模型接口（/api/world/intent）：${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(() => {
        busy = false;
        llmBtn.disabled = false;
        llmBtn.textContent = '⚡ 全员大模型';
      });
  });

  const brand = topbar.querySelector('.brand');
  if (brand !== null && brand.parentElement === topbar) {
    brand.after(wrap, llmBtn);
  } else {
    topbar.prepend(wrap, llmBtn);
  }
  topbar.after(toast);
}
