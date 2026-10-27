/** 神谕面板：把 DOM 上的输入接到场景暴露的同一条通道。
 *
 * 「打字」和「点按钮」不是两条路径：按钮也拼一句话交给 Oracle.say，
 * 免得上层要维护两套意图解析。
 */

import { TASK_PROFILES } from '../world/tasks.ts';
import type { DailyReport } from '../world/report.ts';
import { WILD_PREFAB_OF, fillableGaps } from '../world/world-state.ts';
import { whenApi } from './when-api.ts';
import type { TaskKind, WorldSnapshot } from '../world/types.ts';

export interface OracleApi {
  /** 世界快照只读视图。HUD 与浏览器回归都从这里读，不另开接口。 */
  readonly view: () => WorldSnapshot;
  /** 只表示这句话认没认出。世界是否照办在下一个逻辑拍结算，结果走 onResult。 */
  readonly say: (text: string) => { readonly ok: boolean; readonly message: string };
  readonly dispatch: (kind: 'code' | 'research' | 'writing' | 'quick', summary: string) => void;
  /** 人工交付；target 可选（角色 id 或名字），省略时收第一个在干活的人的单。 */
  readonly finish: (target?: string) => void;
  /** 存档：立即写单槽。 */
  readonly saveNow: () => { readonly ok: boolean; readonly message: string };
  /** 读档：刷新页面，由启动流程从单槽恢复。 */
  readonly loadSave: () => { readonly ok: boolean; readonly message: string };
  /** 清档：删除单槽。 */
  readonly clearSave: () => { readonly ok: boolean; readonly message: string };
  readonly build: (prefabId: string) => void;
  /** 神迹：点灯 / 种树 / 召唤猫。不是神谕，不刻石板。 */
  readonly miracle: (kind: 'light' | 'tree' | 'cat') => void;
  /** 造物模式：进入后世界暂停，选位置、回车确认、Esc 取消。 */
  readonly beginCreation: (prefabId: string) => { readonly ok: boolean; readonly message: string };
  readonly confirmCreation: () => { readonly ok: boolean; readonly message: string };
  readonly cancelCreation: () => { readonly ok: boolean; readonly message: string };
  readonly creation: () => { readonly prefabId: string; readonly ghostAt: unknown } | null;
  /** 调试注入：造一条 blocked 单验证急件流程。 */
  readonly injectBlocked: (id: string, title: string, question: string) => void;
  /** 世界状态摘要：镇内郊野、空地、缺口。 */
  readonly worldState: () => {
    readonly line: string;
    readonly missingWild: readonly TaskKind[];
    /** 这座世界认得的蓝图 id。缺口按钮只在这些里面挑。 */
    readonly buildable: readonly string[];
  };
  /** 当前急件：上游 blocked 单的完整问题。 */
  readonly decree: () => { readonly taskId: string; readonly question: string; readonly title: string } | null;
  /** 渲染统计：绘制对象数与指令总量。 */
  readonly renderStats: () => {
    readonly graphicsObjects: number;
    readonly totalCommands: number;
    readonly largest: readonly number[];
  };
  /** 立刻把镜头中心对准世界坐标。 */
  readonly centerCameraOn: (x: number, y: number) => void;
  /** 只查询某格能不能建，不改变状态。 */
  readonly canPlaceAt: (cell: { readonly x: number; readonly y: number }) => boolean;
  readonly feed: (message: {
    readonly type: 'task.assigned';
    readonly taskId: string;
    readonly taskKind: 'code' | 'research' | 'writing' | 'quick';
    readonly summary: string;
  }) => { readonly ok: boolean; readonly message: string };
  /** 命令结算结果。返回取消订阅函数。 */
  readonly onResult: (listener: (result: { ok: boolean; message: string }) => void) => () => void;
  /** 世界状态一行字。像素画面不画中文，这行归纸面。 */
  readonly onStatus: (listener: (line: string) => void) => () => void;
  /** 时相：显式指定某一刻（截图/调试），会停止自动推进。 */
  readonly setPhase: (phase: 'dawn' | 'noon' | 'dusk' | 'night') => void;
  readonly currentPhase: () => 'dawn' | 'noon' | 'dusk' | 'night';
  /** 真实时间此刻对应的刻。 */
  readonly realPhase: () => 'dawn' | 'noon' | 'dusk' | 'night';
  /** 是否按真实时间自动推进。 */
  readonly isAutoPhase: () => boolean;
  /** 恢复按真实本地时间推进。 */
  readonly setAutoPhase: () => void;
  /** 旧入口：setNight(true) 等于跳到夜，false 等于回到真实时间。 */
  readonly setNight: (enabled: boolean) => void;
  readonly toggleNight: () => boolean;
  readonly nightEnabled: () => boolean;
  readonly report: () => ReportApi;
  /** 神谕石板：只含真正改变过世界的话，旧在前。 */
  readonly slab: () => readonly { readonly raw: string; readonly receipt: string; readonly at: number }[];
}

/**
 * 报纸那一块的形状。**不是手抄的一份**，是从 `DailyReport` 上摘的。
 *
 * 原来这里是手写三个 `readonly` 字段，2026-10-27 把 `date` 改名 `clock` 时只改了
 * 世界那一边，漏了这边——于是面板读 `report.clock` 读到一个没有这个字段的类型上。
 * 而这一次**编译器没响**：`src/world/creator/fuse.ts` 里一个语法错误
 * （`${x.toFixed(2%)}`，少一层引号）把整个项目的语义诊断全部压掉了，`tsc --noEmit`
 * 只报那一处语法错误就走了。手抄的形状会漂，而漂了不一定有人红——所以这里改成
 * `Pick`，让世界那头改名时这边跟着改，没有第二份可以漂的清单。
 */
export type ReportApi = Pick<DailyReport, 'headline' | 'lines' | 'clock'>;

const BUTTON_TEXT: Record<string, string> = {
  code: '帮我写一段代码',
  research: '帮我查一下资料',
  writing: '帮我整理一下便笺',
  quick: '顺手看一眼',
};

export function bindOraclePanel(getApi: () => OracleApi | undefined): void {
  const form = document.querySelector<HTMLFormElement>('#oracle');
  const input = document.querySelector<HTMLInputElement>('#utterance');
  const reply = document.querySelector<HTMLDivElement>('#reply');
  const status = document.querySelector<HTMLDivElement>('#status');
  const finish = document.querySelector<HTMLButtonElement>('#finish');
  const paperHeadline = document.querySelector<HTMLHeadingElement>('#paper-headline');
  const paperLines = document.querySelector<HTMLUListElement>('#paper-lines');
  const paperClock = document.querySelector<HTMLSpanElement>('#paper-clock');
  const slabCount = document.querySelector<HTMLSpanElement>('#slab-count');
  const slabLines = document.querySelector<HTMLOListElement>('#slab-lines');
  const decreePanel = document.querySelector<HTMLElement>('#decree');
  const decreeTitle = document.querySelector<HTMLSpanElement>('#decree-title');
  const decreeQuestion = document.querySelector<HTMLElement>('#decree-question');
  const worldStateLine = document.querySelector<HTMLDivElement>('#world-state');
  const buildRow = document.querySelector<HTMLDivElement>('#build-row');
  if (
    form === null ||
    input === null ||
    reply === null ||
    status === null ||
    finish === null ||
    paperHeadline === null ||
    paperLines === null ||
    paperClock === null ||
    slabCount === null ||
    slabLines === null ||
    decreePanel === null ||
    decreeTitle === null ||
    decreeQuestion === null ||
    worldStateLine === null ||
    buildRow === null
  ) {
    return;
  }

  const paintPaper = (api: OracleApi): void => {
    const report = api.report();
    paperHeadline.textContent = report.headline;
    paperClock.textContent = report.clock;
    paperLines.replaceChildren(
      ...report.lines.map((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }),
    );
  };

  /** 石板：最新的一条最显眼（放最上面），旧的往下压。 */
  const paintSlab = (api: OracleApi): void => {
    const records = [...api.slab()].reverse();
    slabCount.textContent = records.length === 0 ? '' : `${records.length} 条`;
    if (records.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '还没有刻过。说一句会让世界动的话。';
      slabLines.replaceChildren(empty);
      return;
    }
    slabLines.replaceChildren(
      ...records.map((record) => {
        const item = document.createElement('li');
        item.textContent = record.raw;
        const receipt = document.createElement('span');
        receipt.className = 'receipt';
        receipt.textContent = `　→ ${record.receipt}`;
        item.appendChild(receipt);
        return item;
      }),
    );
  };

  /**
   * 急件：把上游 blocked 单的完整问题呈出来。
   *
   * 这里**只展示**，不给「准奏/驳回」按钮：世界是纯投影，改上游状态是主产品的事。
   * 放一对按不动的印章比不放更糟——用户会以为点了就该有反应。
   */
  const paintDecree = (api: OracleApi): void => {
    const decree = api.decree();
    if (decree === null) {
      decreePanel.hidden = true;
      return;
    }
    decreePanel.hidden = false;
    decreeTitle.textContent = decree.title;
    decreeQuestion.textContent = decree.question;
  };

  /**
   * 世界状态行 + 按缺口生成的造物按钮。
   *
   * 缺口按钮只在真有缺口时出现：世界不缺东西的时候，多一排按钮只是噪音。
   */
  const paintWorldState = (api: OracleApi): void => {
    const state = api.worldState();
    worldStateLine.textContent = state.line;

    // 清掉上一次按缺口生成的按钮，保留固定的那几个。
    for (const button of [...buildRow.querySelectorAll('button[data-gap]')]) {
      button.remove();
    }
    // 建不出来的铺子，按钮也不该在。见 `fillableGaps`：灯潮界七栋楼里没有
    // gear_tower / crawler_mine / ink_mill，而三类活它全「缺」。原来这里并排
    // 三个「补缺」按钮，点下去个个撞一句「没有这份蓝图。」——那是一句屏上的
    // 空头承诺，而用户照着它点了。
    for (const kind of fillableGaps(state.missingWild, state.buildable)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.gap = kind;
      button.textContent = `补缺：建${TASK_PROFILES[kind as TaskKind]?.label ?? kind}铺子`;
      button.addEventListener('click', () => {
        const current = getApi();
        if (current === undefined) return;
        const prefabId = WILD_PREFAB_OF[kind as TaskKind];
        if (prefabId === undefined) return;
        show(true, current.beginCreation(prefabId).message);
      });
      buildRow.appendChild(button);
    }
    // 静态那两个造房按钮同一个道理：index.html 是几张图共用的，它写的
    // workshop_plot 在灯潮界没有蓝图。收起来，而不是留着一个点了必然失败的按钮。
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      'button[data-build], button[data-create]',
    )) {
      const prefabId = button.dataset.build ?? button.dataset.create;
      if (prefabId === undefined) continue;
      button.hidden = !state.buildable.includes(prefabId);
    }
  };

  const show = (ok: boolean, message: string): void => {
    reply.textContent = message;
    reply.classList.toggle('bad', !ok);
  };

  // 场景在 create() 里才挂上 window.Oracle。等它出现再订阅一次结果流。
  // 等它用的是 setTimeout 不是 requestAnimationFrame：见 `when-api.ts`。
  whenApi(getApi, (api) => {
    api.onResult((result) => {
      // 空结果不是回执，别把屏上那一句擦了。上游轮询每次都带一个结果过来，
      // 而它绝大多数时候无话可说（见 `simulation.ts` 的 syncEvents）——
      // 从前景说话它一开口，用户那句「雨落下来了。」就没了。
      if (result.message !== '') show(result.ok, result.message);
      paintPaper(api);
    });
    api.onStatus((line) => {
      status.textContent = line;
      paintPaper(api);
      paintSlab(api);
      paintDecree(api);
      paintWorldState(api);
    });
    paintPaper(api);
    paintSlab(api);
    paintDecree(api);
    paintWorldState(api);
  }, {
    // 等不到就换一句真话。场景自己也跑在 rAF 上，一帧都不合成时它压根不会
    // create()——屏上那句「世界正在醒来…」会挂一辈子，那是一句没人来兑的承诺。
    onGiveUp: () => show(false, '世界没有醒来。刷新页面再试。'),
  });

  const submit = (text: string): boolean => {
    const api = getApi();
    if (api === undefined) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const parsed = api.say(trimmed);
    if (!parsed.ok) show(false, parsed.message);
    return parsed.ok;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit(input.value)) input.value = '';
  });

  // 维护条的按钮不在 <form> 里（产品页默认不渲染它），按文档查，搬位置不用改绑定。
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-kind]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset.kind;
      const text = kind === undefined ? undefined : BUTTON_TEXT[kind];
      if (text === undefined) return;
      submit(text);
    });
  }

  finish.addEventListener('click', () => submit('交付'));

  document.querySelector<HTMLButtonElement>('#save-now')?.addEventListener('click', () => {
    const api = getApi();
    if (api === undefined) return;
    const result = api.saveNow();
    show(result.ok, result.message);
  });
  document.querySelector<HTMLButtonElement>('#load-save')?.addEventListener('click', () => {
    getApi()?.loadSave();
  });
  document.querySelector<HTMLButtonElement>('#clear-save')?.addEventListener('click', () => {
    const api = getApi();
    if (api === undefined) return;
    const result = api.clearSave();
    show(result.ok, result.message);
  });

  const rain = document.querySelector<HTMLButtonElement>('#rain');
  const clear = document.querySelector<HTMLButtonElement>('#clear');
  rain?.addEventListener('click', () => submit('下雨了'));
  clear?.addEventListener('click', () => submit('放晴吧'));

  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-create]')) {
    button.addEventListener('click', () => {
      const api = getApi();
      const prefabId = button.dataset.create;
      if (api === undefined || prefabId === undefined) return;
      show(true, api.beginCreation(prefabId).message);
    });
  }

  // 时相：按 N 或 ?time= 会停掉自动推进，这个按钮把它交还给真实时间。
  // 没有它的话，世界会永远停在某一刻——用户只能刷新页面才能恢复。
  const phaseAuto = document.querySelector<HTMLButtonElement>('#phase-auto');
  phaseAuto?.addEventListener('click', () => {
    const api = getApi();
    if (api === undefined) return;
    api.setAutoPhase();
    show(true, '时辰跟着真实时间走了。');
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-miracle]')) {
    button.addEventListener('click', () => {
      const api = getApi();
      const kind = button.dataset.miracle;
      if (api === undefined || kind === undefined) return;
      api.miracle(kind as 'light' | 'tree' | 'cat');
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-build]')) {
    button.addEventListener('click', () => {
      const api = getApi();
      const prefabId = button.dataset.build;
      if (api === undefined || prefabId === undefined) return;
      api.build(prefabId);
    });
  }
}
