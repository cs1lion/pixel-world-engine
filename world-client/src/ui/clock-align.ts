/**
 * 老档日界对齐的界面：一次提示 + 两个按钮，以及设置/调试面板里常驻的
 * 「再次检查」与「撤销对齐」入口。所有动作都转给场景，本文件不改仿真。
 *
 * 提示文案必须说人话：日界在几点、要跳多久、这一天会变多长。玩家点「暂不」
 * 之后本次会话与重启都不再弹（决定由场景持久化）；「再次检查」绕过这个决定。
 */

export interface ClockAlignmentView {
  /** 日界对齐是否属于当前时钟模式。默认的游玩时间驱动下为 false。 */
  readonly available: boolean;
  /** 现在是否该展示提示。 */
  readonly pending: boolean;
  /** 偏移是否真的超过阈值；与 `pending` 分开，因为「暂不」会让 pending=false。 */
  readonly required: boolean;
  /** 世界日界落在本地的时刻，`07:01` 这种写法。 */
  readonly boundaryLabel: string;
  readonly offsetMs: number;
  readonly deltaMs: number;
  /** 人话：`7 小时 0 分`。 */
  readonly jumpLabel: string;
  /** 对齐后当前世界日的长度，人话：`16 小时 59 分`。 */
  readonly dayLengthAfterLabel: string;
  readonly aligned: boolean;
  readonly undoAvailable: boolean;
  readonly notice: string | null;
  /** 对齐当天常驻的一句话；过了这天就不再显示。 */
  readonly dayNote: string | null;
}

export interface ClockAlignOracle {
  clockAlignment(): ClockAlignmentView;
  requestClockAlignmentCheck(): ClockAlignmentView;
  applyClockAlignment(): ClockAlignmentView;
  declineClockAlignment(): ClockAlignmentView;
  undoClockAlignment(): ClockAlignmentView;
}

export interface ClockAlignHandle {
  readonly dispose: () => void;
}

/** 绑定提示与面板按钮；返回句柄便于测试/卸载。 */
export function bindClockAlignPanel(oracle: () => ClockAlignOracle | undefined): ClockAlignHandle {
  const prompt = document.querySelector<HTMLElement>('#clock-align');
  const text = document.querySelector<HTMLElement>('#clock-align-text');
  const yes = document.querySelector<HTMLButtonElement>('#clock-align-yes');
  const no = document.querySelector<HTMLButtonElement>('#clock-align-no');
  const check = document.querySelector<HTMLButtonElement>('#clock-align-check');
  const undo = document.querySelector<HTMLButtonElement>('#clock-align-undo');
  const readout = document.querySelector<HTMLElement>('#clock-align-readout');
  if (!prompt || !text || !yes || !no) return { dispose: () => {} };

  const render = (): void => {
    const view = oracle()?.clockAlignment();
    if (view === undefined) return;
    if (view.pending && view.available) {
      prompt.hidden = false;
      text.textContent =
        `你的档日界在 ${view.boundaryLabel}，不是 00:00，要不要对齐到今天零点？`
        + `对齐会把世界时钟向前跳 ${view.jumpLabel}，本日缩短为 ${view.dayLengthAfterLabel}。`;
    } else {
      prompt.hidden = true;
    }
    // 默认的游玩时间驱动没有墙钟日界：维护入口置灰并说清只在 real 模式可用。
    if (view.available) {
      if (check !== null) check.disabled = false;
      if (readout !== null) {
        const state = view.aligned
          ? `已对齐（可撤销，前跳 ${view.jumpLabel}）`
          : `日界 ${view.boundaryLabel}${view.required ? '，未对齐' : '，已对齐'}`;
        readout.textContent = `${state}${view.notice === null ? '' : ` · ${view.notice}`}`;
      }
    } else {
      if (check !== null) check.disabled = true;
      if (readout !== null) {
        readout.textContent = '日界对齐只在真实时钟模式（?clock=real）下可用';
      }
    }
    if (undo !== null) undo.hidden = !view.undoAvailable;
  };

  const act = (fn: (source: ClockAlignOracle) => unknown): void => {
    const source = oracle();
    if (source === undefined) return;
    fn(source);
    render();
  };

  const onYes = (): void => act((source) => source.applyClockAlignment());
  const onNo = (): void => act((source) => source.declineClockAlignment());
  const onCheck = (): void => act((source) => source.requestClockAlignmentCheck());
  const onUndo = (): void => act((source) => source.undoClockAlignment());
  yes.addEventListener('click', onYes);
  no.addEventListener('click', onNo);
  check?.addEventListener('click', onCheck);
  undo?.addEventListener('click', onUndo);

  render();
  const timer = setInterval(render, 500);
  return {
    dispose: () => {
      clearInterval(timer);
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      check?.removeEventListener('click', onCheck);
      undo?.removeEventListener('click', onUndo);
    },
  };
}
