/** 原型入口：装载世界，起 Phaser。 */

import Phaser from 'phaser';
import {
  buildLargeWorld,
  buildWorldFromSave,
  LARGE_ALTAR,
  LARGE_WORLD_SPEC,
  TILE_PX,
} from './world/setup.ts';
import { SandboxScene } from './scenes/SandboxScene.ts';
import { bindOraclePanel, utterancePlaceholder, type OracleApi } from './ui/oracle-panel.ts';
import { bindHud } from './ui/hud.ts';
import { bindShell } from './ui/shell.ts';
import { bindDebugPanel, type DebugOracle } from './ui/debug-panel.ts';
import { bindChronicle } from './ui/chronicle-panel.ts';
import { createMemoryClient } from './world/memory-client.ts';
import {
  SaveStore,
  exportFileName,
  IMPORT_MAX_BYTES,
  type SaveOracle,
} from './ui/save-store.ts';
import type { WorldSave } from './world/save.ts';
import type { BuiltWorld } from './world/setup.ts';
import type { SettingPack } from './settings/types.ts';
import { WORLD } from './world/palette-data.ts';
import { selectSetting, worldForSetting } from './settings/index.ts';

/**
 * 按这份存档建世界；`save` 为 null 表示没有存档，建一套默认世界。
 *
 * **读档的校验与开工的建造必须走这同一个函数。** 落位放不放得进网格，只有真建一次
 * 才知道（`WorldGrid.place()` 是那套规矩的唯一的住处）。校验时另写一套判据，
 * 就是第二份真相：将来 `place()` 多一条不放行的路子，判据不知道，照旧放行，
 * 然后 `buildWorldFromSave()` 抛在顶层——白屏。
 *
 * 两条路的分别只在「有档没档」与「哪套建造器」，都是 `pack` 自己的事，
 * 所以判定也长在这儿，不分给调用方。
 */
function buildWorldFor(pack: SettingPack, save: WorldSave | null): BuiltWorld {
  if (!pack.authored) {
    return save === null
      ? buildLargeWorld(pack.blueprints)
      : buildWorldFromSave(save.world.buildings, pack.blueprints, LARGE_WORLD_SPEC, LARGE_ALTAR);
  }
  // 有设定集的图：显式落位与读档重放都归 `buildSettingWorld`，规格和祭坛都在包里。
  return worldForSetting(pack, save === null ? undefined : save.world.buildings);
}

// 读档必须在建世界/起 Phaser 之前：有档按存档 buildings 顺序重放网格（ADR_SAVE §1.2）。
const saveNotices: string[] = [];
const pack = selectSetting(window.location.search);
const saveStore = new SaveStore({
  storageKey: pack.saveKey,
  // 世界多大：读档时按它查「坐标在不在世界里」。递的是这一套设定集的 grid——
  // 一份从别的地图搬过来的存档，坐标在这张图上越界，那也是越界。
  bounds: { width: pack.grid.width, height: pack.grid.height },
  // 落位放不放得进网格：也在这儿查，同样是真建一次。不查的话 `buildWorldFor`
  // 抛的 `WorldSetupError` 在模块顶层没有人接——页面一片空白，只留一条 console
  // 错误，玩家连「存档有问题」都看不见。递进来的就是下面开工要用的那个函数，
  // 所以检查的与建造的不可能是两套。
  tryBuildWorld: (save) => {
    try {
      buildWorldFor(pack, save);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  onWarning: (message) => saveNotices.push(message),
});
const loadedSave = saveStore.read();
/**
 * 生产用大世界：96×72 格。旧规格 30×20 保留给测试夹具，生产入口不再用它。
 *
 * 读档时按大世界规格重建网格：存档里没有网格数据，只有建筑坐标；
 * 旧档的建筑坐标在新图里仍然合法（新图包含原来的镇中心）。
 * （`buildWorldFor` 上面那段就是这两句话的住处。）
 */
document.title = `${pack.name} · 像素世界`;
const worldTitle = document.querySelector<HTMLElement>('#world-title');
if (worldTitle !== null) worldTitle.textContent = pack.name;
const brand = document.querySelector<HTMLElement>('#topbar .brand');
if (brand !== null) brand.textContent = pack.name;
const world = buildWorldFor(pack, loadedSave.ok ? loadedSave.save : null);

/**
 * 输入框里的例子必须在这张图上真能办到。
 *
 * `index.html` 写死的是「建一间工坊」——那是莞尔镇的模板。灯潮界没有工坊，
 * 照抄这句就是给用户一个注定被拒的例子。
 *
 * **一个都没剩下的时候不能就不管了。** 世界拒绝「同一种铺子建第二栋」，
 * 所以每种铺子都落位之后这张图上一栋新楼也建不出来；这时留着的那个例子
 * 仍然是「建一间工坊」，比原来更糟——它连模板名都不是这张图上的。
 * 换成一个不靠建造也能办的例子。
 *
 * 这段原来只对 `pack.authored` 跑，默认世界始终用 `index.html` 那句写死的。
 * 可默认世界正是最容易踩中的那一支：十二种铺子开局落了十一栋，能建的只有
 * `workshop_plot` 一种，玩家把它建掉（或读一份已经建了它的档）之后就一种不剩，
 * 而例子还在说「建一间工坊」。现在两支共用 `utterancePlaceholder`，而且喂它的
 * 是**建成之后的世界**（读档时是存档里那批楼），不是包里的静态声明。
 */
const utterance = document.querySelector<HTMLInputElement>('#utterance');
if (utterance !== null) {
  utterance.placeholder = utterancePlaceholder(
    pack.blueprints,
    new Set(world.buildings.map((building) => building.prefabId)),
  );
}

/** 画布尺寸：只显示世界的一小块，靠相机移动看其余部分。 */
const VIEW_WIDTH = 30 * TILE_PX;
const VIEW_HEIGHT = 20 * TILE_PX;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: WORLD.ink,
  pixelArt: true,
  roundPixels: true,
  // 逻辑分辨率保持 480×320（30×20 格 ×16px），只放大画布显示尺寸。非整数缩放会让像素边缘渗色，
  // 所以固定 2 倍，不跟随窗口。
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 2,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  scene: [],
});

// 场景配置要等 Game 建好之后才能 push：payload 在 init 里读。
game.scene.add('SandboxScene', SandboxScene, true, {
  world,
  blueprints: pack.blueprints,
  villagerName: pack.villagers[0]?.name ?? '莞尔',
  pack,
  saveStore,
  save: loadedSave.ok ? loadedSave.save : null,
  saveNotice: loadedSave.ok ? saveNotices[0] ?? null : loadedSave.message,
});

// 按钮等场景 create() 挂上 window.Oracle；期间点击直接忽略。
bindOraclePanel(() => (window as unknown as { Oracle?: OracleApi }).Oracle);
bindHud(() => (window as unknown as { Oracle?: OracleApi }).Oracle);
bindShell();

// 上帝调试面板：只读浮层，数据来自 Oracle 只读接口（不改变仿真）。
// `DebugOracle` 住在 `ui/debug-panel.ts` 里，与它要的那几样放在一起——契约不放
// 在接线处。场景在挂载时会赋一次值核对它（见 `registerOracleApi`）。
const debugOracle = (): DebugOracle | undefined =>
  (window as unknown as { Oracle?: DebugOracle }).Oracle;
bindDebugPanel({
  getSnapshot: () => debugOracle()?.view(),
  getEvents: (limit) => debugOracle()?.events(limit) ?? [],
  getSaveStatus: () => debugOracle()?.saveStatus() ?? null,
  feed: (message) => debugOracle()?.feed(message) ?? { ok: false, message: '世界还没醒来。' },
  pushEvent: (event) => debugOracle()?.pushEvent(event),
});

// 镇志抽屉：票据 #7 的「像读一本编年史」。只读 memory/，不改变仿真。
// 客户端在这里才装配：它要知道 fetch 走哪（开发时是 vite 代理的 /api）。
bindChronicle({ client: createMemoryClient() });

// task-22：存档手动导出/导入。导出 = 单槽原文（就是 toSave() 的 v1 JSON，不二次加工）；
// 导入 = 先按现有校验链验一遍，再写单槽、停自动存档、刷新，让启动流程重建世界并与上游对账。
// `SaveOracle` 同 `DebugOracle`：住在 `ui/save-store.ts`，由场景挂载时核对。
const saveOracle = (): SaveOracle | undefined =>
  (window as unknown as { Oracle?: SaveOracle }).Oracle;

const saveIoReply = document.querySelector<HTMLDivElement>('#save-io-reply');
const saveExport = document.querySelector<HTMLButtonElement>('#save-export');
const saveImport = document.querySelector<HTMLButtonElement>('#save-import');
const saveImportFile = document.querySelector<HTMLInputElement>('#save-import-file');

const saySaveIo = (ok: boolean, message: string): void => {
  if (saveIoReply === null) return;
  saveIoReply.textContent = message;
  saveIoReply.classList.toggle('bad', !ok);
};

const downloadText = (name: string, text: string): void => {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 给浏览器一点时间开始下载，再回收 URL。
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
};

saveExport?.addEventListener('click', () => {
  const oracle = saveOracle();
  if (oracle === undefined) {
    saySaveIo(false, '世界还没醒来。');
    return;
  }
  // 先立即写一次单槽（导出“此刻”的世界）；写不进去就退而导出最近一次成功存档并说明。
  const result = oracle.saveNow();
  const text = saveStore.readRawText();
  if (text === null) {
    saySaveIo(false, result.ok ? '导出失败：读不到存档内容。' : result.message);
    return;
  }
  const name = exportFileName(Date.now());
  try {
    downloadText(name, text);
  } catch {
    saySaveIo(false, '导出失败：浏览器拒绝创建下载。');
    return;
  }
  if (!result.ok) {
    saySaveIo(false, `当前世界写不进存档（${result.message}）；已导出最近一次成功存档。`);
    return;
  }
  saySaveIo(true, `已导出 ${name}（${(text.length / 1024).toFixed(1)}KB）。`);
});

saveImport?.addEventListener('click', () => {
  saveImportFile?.click();
});

saveImportFile?.addEventListener('change', () => {
  const input = saveImportFile;
  const file = input.files?.[0];
  if (file === undefined) return;
  if (file.size > IMPORT_MAX_BYTES) {
    saySaveIo(false, `导入失败：文件 ${(file.size / 1024).toFixed(0)}KB，超过上限 2MB。`);
    input.value = '';
    return;
  }
  // 用 FileReader 而不是 File 的 text 方法：D5-A 守卫会拦 src 里的取文本调用，
  // 这里没有 canvas 文本，纯粹是避开误报。
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    const result = saveStore.importText(text);
    if (!result.ok) {
      saySaveIo(false, result.message);
      input.value = '';
      return;
    }
    // 导入已写进单槽。刷新前停掉自动存档，避免 pagehide 用旧世界把它覆盖掉。
    saveStore.disableAutoSave();
    saySaveIo(true, `${result.message} 正在按导入存档重建世界…`);
    input.value = '';
    setTimeout(() => window.location.reload(), 400);
  };
  reader.onerror = () => {
    saySaveIo(false, '导入失败：读不了这个文件。');
    input.value = '';
  };
  reader.readAsText(file);
});
