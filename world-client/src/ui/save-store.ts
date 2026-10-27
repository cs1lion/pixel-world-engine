/** 单槽存档 I/O：读/写/清 + 坏档备份 + 配额降级（ADR_SAVE §4 的 `save-store` 那一半，final）。
 *
 * 只碰 localStorage 与本模块的类型；不 import Simulation，方便用假存储测试。
 */

import {
  assertSave,
  CURRENT_SCHEMA_VERSION,
  findOutOfWorldCoordinates,
  migrateSave,
  SAVE_STORAGE_KEY,
  SCHEMA_V1_FINGERPRINT,
  SETTLED_WARN_THRESHOLD,
  saveFingerprint,
  type RawSave,
  type WorldBounds,
  type WorldSave,
} from '../world/save.ts';

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 存档导入/导出要的场景那一面：立刻写一次单槽。
 *
 * 它原来声明在 `main.ts` 里，和 `DebugOracle` 一样只在消费侧有形状、生产侧没人
 * 核对。搬来这里，由场景挂载时赋一次值（`registerOracleApi` 里那几行
 * `const xxx: Xxx = api`）。
 */
export interface SaveOracle {
  saveNow(): { readonly ok: boolean; readonly message: string };
}

export type SaveReadResult =
  | { readonly ok: true; readonly save: WorldSave }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'corrupt' | 'version' | 'storage';
      readonly message: string;
      /** true = 不要写主存档（高版本只读 / 存储读失败）。 */
      readonly paused: boolean;
    };

export interface SaveWriteResult {
  readonly ok: boolean;
  readonly paused: boolean;
  readonly message: string;
}

export interface SaveStoreOptions {
  readonly storage?: StorageLike;
  readonly wallClock?: () => number;
  readonly onWarning?: (message: string) => void;
  /** 每套设定集一个槽；默认值保持旧世界存档键不变。 */
  readonly storageKey?: string;
  /**
   * 世界多大。给了才查「坐标在不在世界里」——存档层不知道，必须由建世界的那一方递进来。
   *
   * 递的是这一套设定集的 `grid`（`pack.grid.width/height`），不是写档时那一套：
   * 一份从别的地图搬过来的存档，坐标在这张图上越界，那也是越界。
   */
  readonly bounds?: WorldBounds;
  /**
   * 试着按这份存档建一次世界，建不成就说为什么。给了才查「落位放不放得进网格」。
   *
   * **为什么不写成存档层自己的一个函数**：落位合法不合法由 `WorldGrid.place()` 定
   * （两栋楼重叠、门落在自家占地里、门到不了镇心……），那套规矩住在 `setup.ts`，
   * 还要蓝图表、`GridSpec`、祭坛三个入参——存档层一个都没有。在这儿照抄一套就是
   * 第二份真相，而两份真相一定漂：将来 `place()` 多一条不放行的路子，抄的那套
   * 不知道，于是照旧放行、照旧白屏。所以反过来，由建世界的那一方把「真建一次」
   * 递进来——检查的代码与开工的代码从此是同一段。
   *
   * 返回 null = 建得起来；返回一句话 = 那句话就是理由（会指名是哪栋楼）。
   */
  readonly tryBuildWorld?: (save: WorldSave) => string | null;
}

export const CORRUPT_PREFIX = `${SAVE_STORAGE_KEY}.corrupt.`;
/** 坏档备份只保留最近 3 份。 */
export const BACKUP_LIMIT = 3;

/** task-22：手动导入的文件大小上限（字节）。超了直接拒，不解析。 */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type SaveImportReason = 'empty' | 'too-large' | 'corrupt' | 'version' | 'storage';

export interface SaveImportResult {
  readonly ok: boolean;
  readonly reason?: SaveImportReason;
  readonly message: string;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

export type SaveParseResult =
  | { readonly ok: true; readonly save: WorldSave }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'corrupt' | 'version' | 'out-of-world' | 'unplaceable';
      /** 高版本时的版本号。 */
      readonly version?: number;
      /** true = JSON 本身就不合法（与「JSON 合法但形状/字段不对」区分，仅用于文案）。 */
      readonly jsonInvalid?: boolean;
      /** `reason: 'out-of-world'` 时：落在世界外面的坐标，一行一条。 */
      readonly outside?: readonly string[];
      /**
       * `reason: 'unplaceable'` 时：放不进网格的理由。**今天恒为一条**——
       * `rebuildGridFromPlacements()` 逐栋落位，第一枚放不下就抛，后面的楼没试过。
       */
      readonly problems?: readonly string[];
    };

/**
 * 唯一的存档校验链（P3）：空白 → JSON/形状 → 高版本只读 → 迁移 → assertSave（含路径集合校验）。
 * `read()` 与 `importText()` 都走这里，避免两条平行实现慢慢漂移。
 * 纯函数：不碰存储、不备份、不改 autoSave——这些由调用方按各自语义处理。
 *
 * `bounds` 给了才查「坐标在不在世界里」（`findOutOfWorldCoordinates`）。存档层自己
 * 不知道世界多大，所以这一步必须由知道的那一方递进来；不递就只做形状校验，
 * 那是**知道有洞而不查**，不是「查过没问题」。
 *
 * `tryBuildWorld` 给了才查「落位放不放得进网格」。同一个道理，反过来递：
 * 那套规矩在 `setup.ts`，存档层没有（见 `SaveStoreOptions.tryBuildWorld` 的说明）。
 *
 * 两道都查，因为它们防的不是同一件事，谁也替不了谁：`bounds` 查的是**坐标这个数**
 * 在不在世界里面；`tryBuildWorld` 查的是**这些坐标合在一起**摆不摆得下一座镇子。
 * 实测：把一栋楼整体搬到另一栋身上，两边坐标全都规规矩矩在界内，`bounds` 放行，
 * 而 `place()` 第二次就返回 false。
 */
export function parseSaveText(
  text: string,
  bounds?: WorldBounds,
  tryBuildWorld?: (save: WorldSave) => string | null,
): SaveParseResult {
  // 纯空白文本统一判 empty（不是 corrupt）：读档与导入都必须给出同一个标签。
  if (text.trim().length === 0) return { ok: false, reason: 'empty' };
  let raw: RawSave;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'corrupt', jsonInvalid: true };
    }
    raw = parsed as RawSave;
  } catch {
    return { ok: false, reason: 'corrupt', jsonInvalid: true };
  }
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) return { ok: false, reason: 'version', version };
  let migrated: WorldSave;
  try {
    const moved = migrateSave(raw);
    assertSave(moved);
    migrated = moved;
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (bounds !== undefined) {
    const outside = findOutOfWorldCoordinates(migrated, bounds);
    if (outside.length > 0) return { ok: false, reason: 'out-of-world', outside };
  }
  if (tryBuildWorld !== undefined) {
    const problem = tryBuildWorld(migrated);
    // 一条就够：`rebuildGridFromPlacements()` 逐栋落位，遇上第一枚放不下就抛，
    // 后面的楼根本没试过。列一堆「可能也放不下」是猜，而猜中的那几条里
    // 说不定有 merely 被前一栋挡住的——那不算它自己放不下。
    if (problem !== null) return { ok: false, reason: 'unplaceable', problems: [problem] };
  }
  return { ok: true, save: migrated };
}

/** 导出文件名：带本地时间戳，便于用户在同一目录里区分多份导出。 */
export function exportFileName(atMs: number): string {
  const date = new Date(atMs);
  const stamp = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('');
  const clock = [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join('');
  return `xiaoxi-pixel-world-save-${stamp}-${clock}.json`;
}

const STORAGE_HINT = '读不到本地存档：可能是来源(origin/端口)变了。';
const CORRUPT_MESSAGE = '存档损坏，已备份原档，用新世界启动。';
const QUOTA_MESSAGE = '本地存储已满：自动存档已暂停，世界继续运行。';
/**
 * 坐标越界的说明。**必须指名越界的是什么**：只说「存档有问题」，
 * 玩家没有办法知道该去改哪儿，而原档已经备份在，他本来是可以去修的。
 */
const OUT_OF_WORLD_MESSAGE =
  '存档里有坐标落在世界外面，已备份原档，用新世界启动。这些坐标留在了原档里：';
const IMPORT_OUT_OF_WORLD_MESSAGE =
  '导入失败：存档里有坐标落在世界外面，原文件已备份。越界的是：';
/**
 * 落位放不下的说明。**必须指名是哪栋楼、为什么放不下**：只说「存档有问题」，
 * 玩家没有办法知道该去改哪儿，而原档已经备份在，他本来是可以去修的。
 */
const UNPLACEABLE_MESSAGE =
  '存档里的建筑放不进这张地图，已备份原档，用新世界启动。放不下的是：';
const IMPORT_UNPLACEABLE_MESSAGE =
  '导入失败：存档里的建筑放不进这张地图，原文件已备份。放不下的是：';

/** 指控最多列几条。 */
const PROBLEM_LIMIT = 5;

/**
 * 一条条指控拼成给人看的一段话。
 *
 * **必须换行，而且收的人必须肯换行。** 一条坐标一行，玩家照着去改原档。
 * 而 `textContent` 不折行——HTML 把 `\n` 折成一个空格，于是
 * 「…这些坐标留在了原档里： world.villagers[0].pos = {x:99999, y:-98765}
 * world.roads[0] = {x:30, y:3} …」挤成一句，指名了个寂寞。
 * 所以 `#status` 与 `#save-io-reply` 都要有 `white-space: pre-wrap`
 * （`index.html`）。这条原来没有，两种坏档的说明全都糊成一行。
 *
 * **也要有上限。** 从一张更大的图搬过来的存档，越界的 road 格子能有一条报一条，
 * 几十上百行——一个两百行的状态栏是另一个 bug。超了只列前几条，总数说清楚，
 * 完整的清单进控制台（那儿没有行长）。
 */
function describeProblems(headline: string, problems: readonly string[]): string {
  const shown = problems.slice(0, PROBLEM_LIMIT);
  const rest = problems.length - shown.length;
  if (rest > 0) console.warn(`${headline}\n${problems.join('\n')}`);
  const tail = rest > 0 ? `\n…还有 ${rest} 处，完整清单在控制台里。` : '';
  return `${headline}\n${shown.join('\n')}${tail}`;
}

export class SaveStore {
  private readonly storageKey: string;
  private readonly storage: StorageLike;
  private readonly corruptPrefix: string;
  private readonly wallClock: () => number;
  private readonly onWarning: (message: string) => void;
  private autoSave = true;
  private readonly warned = new Set<string>();
  private lastSaved: { schemaVersion: number; savedAtWallClock: number } | null = null;
  private readonly bounds: WorldBounds | undefined;
  private readonly tryBuildWorld: ((save: WorldSave) => string | null) | undefined;

  constructor(options: SaveStoreOptions = {}) {
    this.storageKey = options.storageKey ?? SAVE_STORAGE_KEY;
    this.corruptPrefix = `${this.storageKey}.corrupt.`;
    this.storage = options.storage ?? (globalThis.localStorage as StorageLike);
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.onWarning = options.onWarning ?? (() => {});
    this.bounds = options.bounds;
    this.tryBuildWorld = options.tryBuildWorld;
  }

  isAutoSaveEnabled(): boolean {
    return this.autoSave;
  }

  enableAutoSave(): void {
    this.autoSave = true;
  }

  disableAutoSave(): void {
    this.autoSave = false;
  }

  /** 调试面板：最近一次成功读/写的存档元信息（无则 null）。 */
  lastSavedMeta(): { schemaVersion: number; savedAtWallClock: number } | null {
    return this.lastSaved === null ? null : { ...this.lastSaved };
  }

  /** 读档；任何异常都降级为可读结果，不抛。 */
  read(): SaveReadResult {
    let text: string | null;
    try {
      text = this.storage.getItem(this.storageKey);
    } catch {
      this.autoSave = false;
      this.warnOnce('storage', STORAGE_HINT);
      return { ok: false, reason: 'storage', message: STORAGE_HINT, paused: true };
    }
    if (text === null) return { ok: false, reason: 'empty', message: '没有存档。', paused: false };

    const parsed = parseSaveText(text, this.bounds, this.tryBuildWorld);
    if (!parsed.ok) {
      if (parsed.reason === 'empty') {
        // 单槽里只有空白：与「没有存档」一样处理，不备份、不提示损坏。
        return { ok: false, reason: 'empty', message: '没有存档。', paused: false };
      }
      if (parsed.reason === 'version') {
        this.autoSave = false;
        const message = `存档版本 v${parsed.version ?? 0} 高于当前 v${CURRENT_SCHEMA_VERSION}：只读启动，自动存档已暂停。`;
        this.warnOnce('version', message);
        return { ok: false, reason: 'version', message, paused: true };
      }
      if (parsed.reason === 'out-of-world') {
        // 坐标越界按坏档处理：备份原档，用新世界启动，并把越界的坐标一条条说清楚。
        // 不静默修——`nearestWalkable` 一类「搬回来」等于替玩家决定她站在哪儿，
        // 而那是世界自己的事实。原档留着，他看得见、改得动。
        this.backupCorrupt(text);
        const message = describeProblems(OUT_OF_WORLD_MESSAGE, parsed.outside ?? []);
        this.warnOnce('out-of-world', message);
        return { ok: false, reason: 'corrupt', message, paused: false };
      }
      if (parsed.reason === 'unplaceable') {
        // 落位放不下同样按坏档处理：备份原档，用新世界启动，并指名是哪栋楼。
        // **这一道原先不存在**，而它拦的正是白屏：`buildWorldFromSave()` 抛的
        // `WorldSetupError` 在 `main.ts` 顶层没有人接，页面只剩一片空白，
        // 只留一条 console 错误——玩家连「存档有问题」都看不到。
        this.backupCorrupt(text);
        const message = describeProblems(UNPLACEABLE_MESSAGE, parsed.problems ?? []);
        this.warnOnce('unplaceable', message);
        return { ok: false, reason: 'corrupt', message, paused: false };
      }
      this.backupCorrupt(text);
      this.warnOnce('corrupt', CORRUPT_MESSAGE);
      return { ok: false, reason: 'corrupt', message: CORRUPT_MESSAGE, paused: false };
    }
    this.lastSaved = {
      schemaVersion: parsed.save.schemaVersion,
      savedAtWallClock: parsed.save.meta.savedAtWallClock,
    };
    return { ok: true, save: parsed.save };
  }

  /** 写主存档；配额/安全异常 → 关自动存档、提示一次、不抛。 */
  write(save: WorldSave): SaveWriteResult {
    if (!this.autoSave) {
      return { ok: false, paused: true, message: '自动存档已暂停。' };
    }
    if (save.world.settled.length > SETTLED_WARN_THRESHOLD) {
      this.warnOnce(
        'settled',
        `已结算记录超过 ${SETTLED_WARN_THRESHOLD} 条（${save.world.settled.length}），存档可能偏大。`,
      );
    }
    const text = JSON.stringify(save);
    if (!this.writeRaw(text)) {
      // 配额紧张：先删最旧备份，再重试主存档（备份不得拖垮主存档）。
      this.pruneOldestBackup();
      if (!this.writeRaw(text)) {
        this.autoSave = false;
        this.warnOnce('quota', QUOTA_MESSAGE);
        return { ok: false, paused: true, message: QUOTA_MESSAGE };
      }
    }
    this.lastSaved = {
      schemaVersion: save.schemaVersion,
      savedAtWallClock: save.meta.savedAtWallClock,
    };
    return { ok: true, paused: false, message: '存档已写入。' };
  }

  clear(): void {
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      // 清档失败不抛；下次再清。
    }
  }

  /** 导出用：直接取单槽原文（已经是 v1 JSON 文本，不再二次序列化）。 */
  readRawText(): string | null {
    try {
      return this.storage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }

  /**
   * task-22 手动导入：校验 → 写单槽。校验走和 read() 同一条 `parseSaveText`（P3）。
   * 坏档按现有机制先备份再提示；高版本拒绝且不降级写回；写失败按配额降级。
   */
  importText(text: string): SaveImportResult {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > IMPORT_MAX_BYTES) {
      const limit = (IMPORT_MAX_BYTES / (1024 * 1024)).toFixed(0);
      return {
        ok: false,
        reason: 'too-large',
        message: `导入失败：文件 ${(bytes / 1024).toFixed(0)}KB，超过上限 ${limit}MB。`,
      };
    }

    const parsed = parseSaveText(text, this.bounds, this.tryBuildWorld);
    if (!parsed.ok) {
      if (parsed.reason === 'empty') {
        // 空白文件与 read() 用同一个 empty 标签（都走 parseSaveText）。
        return { ok: false, reason: 'empty', message: '导入失败：文件是空的。' };
      }
      if (parsed.reason === 'version') {
        // 高版本只读：拒绝导入、不迁移、不降级、不写槽、不备份（原文件在用户手里）。
        return {
          ok: false,
          reason: 'version',
          message: `导入失败：存档版本 v${parsed.version ?? 0} 高于当前 v${CURRENT_SCHEMA_VERSION}，只读不降级。`,
        };
      }
      this.backupCorrupt(text);
      const message = parsed.jsonInvalid
        ? '导入失败：不是合法 JSON，原文件已备份。'
        : parsed.reason === 'out-of-world'
          ? describeProblems(IMPORT_OUT_OF_WORLD_MESSAGE, parsed.outside ?? [])
          : parsed.reason === 'unplaceable'
            ? describeProblems(IMPORT_UNPLACEABLE_MESSAGE, parsed.problems ?? [])
            : '导入失败：存档内容校验不通过，原文件已备份。';
      this.warnOnce('import-corrupt', message);
      return { ok: false, reason: 'corrupt', message };
    }
    const migrated = parsed.save;

    const serialized = JSON.stringify(migrated);
    if (!this.writeRaw(serialized)) {
      this.pruneOldestBackup();
      if (!this.writeRaw(serialized)) {
        this.autoSave = false;
        this.warnOnce('quota', QUOTA_MESSAGE);
        return {
          ok: false,
          reason: 'storage',
          message: '导入失败：本地存储写不进去（可能已满），自动存档已暂停。',
        };
      }
    }
    // 导入成功 = 用户显式要这份档生效；重新打开自动存档（原档已成功写入）。
    this.autoSave = true;
    this.lastSaved = {
      schemaVersion: migrated.schemaVersion,
      savedAtWallClock: migrated.meta.savedAtWallClock,
    };
    return { ok: true, message: `已导入存档（v${migrated.schemaVersion}，${(bytes / 1024).toFixed(1)}KB）。` };
  }

  /** 坏档原样备份，带时间戳，保留最近 3 份；备份失败不影响主存档。 */
  backupCorrupt(text: string): void {
    const key = `${this.corruptPrefix}${this.wallClock()}`;
    try {
      this.storage.setItem(key, text);
    } catch {
      // 配额紧张：先腾掉最旧备份再试一次。
      this.pruneOldestBackup();
      try {
        this.storage.setItem(key, text);
      } catch {
        return;
      }
    }
    this.pruneBackups();
  }

  listBackups(): string[] {
    const keys: string[] = [];
    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (key !== null && key.startsWith(this.corruptPrefix)) keys.push(key);
      }
    } catch {
      return [];
    }
    return keys.sort(
      (a, b) => Number(a.slice(this.corruptPrefix.length)) - Number(b.slice(this.corruptPrefix.length)),
    );
  }

  private writeRaw(text: string): boolean {
    try {
      this.storage.setItem(this.storageKey, text);
      return true;
    } catch {
      return false;
    }
  }

  private pruneOldestBackup(): void {
    const backups = this.listBackups();
    const oldest = backups[0];
    if (oldest === undefined) return;
    try {
      this.storage.removeItem(oldest);
    } catch {
      // 删不掉就算了，交给上层降级。
    }
  }

  private pruneBackups(): void {
    const backups = this.listBackups();
    while (backups.length > BACKUP_LIMIT) {
      const oldest = backups.shift();
      if (oldest === undefined) return;
      try {
        this.storage.removeItem(oldest);
      } catch {
        return;
      }
    }
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.onWarning(message);
  }
}

export { SAVE_STORAGE_KEY, SCHEMA_V1_FINGERPRINT, saveFingerprint };
