/** 取景的三个按钮：自由 / 跟随 / 导播。
 *
 * 为什么要有按钮：世界会自己切镜头（闲置 15 秒后接管），可玩家没有一处能说
 * 「就停在这」。这三个按钮是那个开关，也是唯一能**主动**进入跟随的入口。
 *
 * 按下态由场景推过来（`onCameraMode`），**不在这里轮询**：导播是闲置后自己
 * 接管的，那一刻没有任何输入、也没有别的状态变化——轮询要等到下一次别的什么
 * 发生才跟上，按钮就停在旧的按下态上。
 *
 * 中文全走 DOM（D5-A）：这个文件在 `src/ui/`，不编码任何 canvas 文本。
 */

import type { CameraMode } from '../render/camera-controller.ts';
import { whenApi } from './when-api.ts';

export interface CameraOracle {
  readonly cameraMode: () => CameraMode;
  readonly setCameraMode: (mode: CameraMode) => void;
  readonly canFollow: () => boolean;
  readonly onCameraMode: (listener: (mode: CameraMode) => void) => () => void;
}

const MODES: readonly { readonly mode: CameraMode; readonly label: string }[] = [
  { mode: 'free', label: '自由' },
  { mode: 'follow', label: '跟随' },
  { mode: 'director', label: '导播' },
];

export function bindCameraBar(getApi: () => CameraOracle | undefined): void {
  const host = document.querySelector<HTMLElement>('#camera-bar');
  if (host === null) return;

  // 先清空：重复绑定（热更新、二次挂载）不该长出第二排按钮。
  host.replaceChildren();
  const buttons = new Map<CameraMode, HTMLButtonElement>();
  for (const { mode, label } of MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.mode = mode;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => getApi()?.setCameraMode(mode));
    host.append(button);
    buttons.set(mode, button);
  }

  const paint = (api: CameraOracle, mode: CameraMode): void => {
    for (const [key, button] of buttons) {
      button.setAttribute('aria-pressed', String(key === mode));
    }
    const follow = buttons.get('follow');
    if (follow !== undefined) {
      const can = api.canFollow();
      follow.disabled = !can;
      follow.title = can ? '镜头跟住刚才看的那个人' : '先点一个村民';
    }
  };

  whenApi(getApi, (api) => {
    api.onCameraMode((mode) => paint(api, mode));
    paint(api, api.cameraMode());
  });
}
