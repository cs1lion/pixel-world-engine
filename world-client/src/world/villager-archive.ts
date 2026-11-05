/** 主要人物的设定档案：面板可读，并且开局会以 `genesis` 来源写进记忆。
 *
 * 档案是**设定数据**，不是世界事件：它只描述「这个人是谁、从哪来」，
 * 不假装有人目击过一段剧情，也不参与传说/传言的形成。
 */

export interface VillagerBondSeed {
  /** 对方的名字；场景在开局把它解析成当前世界的村民 id。 */
  readonly to: string;
  readonly trust: number;
  readonly warmth: number;
  /** 正 = 我欠对方；负 = 对方欠我。 */
  readonly debt: number;
  readonly familiarity: number;
}

export interface VillagerArchive {
  readonly aliases: readonly string[];
  /** 身份与隶属。 */
  readonly identity: string;
  /** 年龄或辈分。 */
  readonly generation: string;
  /** 怎么到这个世界的。 */
  readonly origin: string;
  readonly cares: readonly string[];
  readonly taboos: readonly string[];
  /** 日常动线，带钟点。 */
  readonly routine: string;
  /** 说话风格一句。 */
  readonly voice: string;
  /** 与另外两人的关系初值。 */
  readonly bonds: readonly VillagerBondSeed[];
}

/** 写进记忆的第一人称档案句。只读档案，不编目击。 */
export function archiveMemoryText(name: string, archive: VillagerArchive): string {
  return [
    `档案上写着：我叫${name}，也叫${archive.aliases.join('、')}。`,
    `${archive.identity}，${archive.generation}。`,
    `来历：${archive.origin}`,
    `牵挂：${archive.cares.join('；')}。`,
    `忌讳：${archive.taboos.join('；')}。`,
    `日常：${archive.routine}`,
    `说话：${archive.voice}`,
  ].join('');
}
