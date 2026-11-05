/**
 * 内景视图状态：**独立键，不进存档**。
 *
 * 人在哪一层、是不是站在屋里，都是「这一台设备上、这一眼看的东西」，
 * 不是世界的自有事实。写进 v5 只会让存档替一个视图状态背书——
 * 于是读档必须回街景：`restoreInteriorViewState` 在启动时**只清不还原**。
 *
 * 与 `clock-align` 的「暂不 / 已对齐」是同一类东西：都是玩家的界面决定。
 */

const STORAGE_KEY = 'pwe.interior.view';

export interface InteriorViewState {
  readonly buildingId: string;
  readonly floor: number;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 读上次的视图状态。**只给调试面板用，恢复流程不读它。** */
export function readInteriorViewState(): InteriorViewState | null {
  const storage = safeStorage();
  if (storage === null) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<InteriorViewState>;
    if (typeof parsed.buildingId !== 'string') return null;
    if (typeof parsed.floor !== 'number' || !Number.isFinite(parsed.floor)) return null;
    return { buildingId: parsed.buildingId, floor: parsed.floor };
  } catch {
    return null;
  }
}

export function writeInteriorViewState(state: InteriorViewState | null): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    if (state === null) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存不下就算了：这是视图状态，丢了不该让世界停一下。
  }
}

/**
 * 启动时调用：**清掉，不还原**。
 *
 * 这条不是「以防万一」，是定义的一部分——读档回街景，不接着站在上一局的屋里。
 */
export function restoreInteriorViewState(): void {
  writeInteriorViewState(null);
}
