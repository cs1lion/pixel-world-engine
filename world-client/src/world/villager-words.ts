/** 村民嘴上的一句话：屏上与纸上描述她此刻在做什么的那几个字。
 *
 * 单立一个文件，因为它同时供两处说话用，而这两处原先各写各的、各错各的：
 *   - 状态行（`SandboxScene.statusLine`）——每帧刷新的那一行 HUD；
 *   - 《神谕日报》（`report.ts` 的 `idleClauses`）——纸上那句「莞尔在农田边」。
 *
 * 抽出之前，日报那边已经为同一句话栽过一次并修好了（见 `report.ts` 里
 * `NOT_SOMEWHERE` 的来历），状态行这边还是老写法。同一个错误在两处各犯一次，
 * 根子是「她没牌子时她人在哪」没有一个函数能答——答不出来就只好现编一句。
 * 编的就是假话，而这个仓库最不容那一件（`docs/SPEC.md`）。
 */

import type { TaskRecord, VillagerSnapshot, WorldSnapshot } from './types.ts';

/**
 * 说不准她在哪儿时的说法。**不许拿一句地点顶替。**
 *
 * 这里曾经（`report.ts` 与状态行两处）是「在祭坛边坐着」/「在祭坛边闲逛」。
 * 那句话假不假看她这会儿在不在祭坛：走作息时她在农田边、街口、屋檐下。
 *
 * 「那时她**有**牌子，说的就是牌子」也曾是假的另一半球：牌子挂的是**到了
 * 之后**那一句，而多半时候她还在路上——牌子说她站在街口看一会儿，她的坐标
 * 正在动。2026-10-28 起牌子分两半：`routineGoing` 说她正往哪儿去，
 * `routineLabel` 说她到了之后做什么，快照按在不在走挑一个（`simulation.ts`
 * 的 `snapshotVillager`；`test/routine-going-label.test.ts` 钉着「走着的那
 * 些拍不说着到之后的话」，也钉着走路的拍多于站着的拍）。所以到如今，假的
 * 样子只剩清牌子这一条，见下。
 *
 * 清牌子而人不在祭坛的路口有四条（`simulation.ts` 里 `routineLabel = null`
 * 一共 7 处，其中让人回到 idle 的是这四条。`test/labelless-idle.test.ts` 真驱
 * 的只有 `finishInPlace` 与 `abandonActiveTask` 两条，另两条只在那份测试里按
 * 名字点到、没跑过——所以这四条里有两条的退路至今只有源码可依）。剩下三处
 * 都不回 idle：`routeToBuilding` 与 `arriveAtWork` 在路上与工位上，
 * `stepDecrees` 举着急件——三处的说法归 `villagerModeLabel` 管，不读牌子。
 * 那四条是：
 *
 *   - `abandonActiveTask`（上游撤单）与 `removeTask`（读档对账删单）都按
 *     `restoreOutOfBuilding` 把她挪到铺子门口；
 *   - `finishInPlace`（quick 原地办完）**一步都不挪人**——她站在接到活那一刻
 *     的位置，那一格哪儿都可能；
 *   - `arriveAtAltar` 她人就在祭坛，退路恰好是真的。
 *
 * 所以「只有撤单那条路」是假的——原话这么写，读的人会以为另外三条不必防。
 *
 * 退路本身仍然只有一个判据：`atAltar`。人在祭坛格上才说祭坛，不在就说这句。
 */
export const NOT_SOMEWHERE = '这会儿没个准地方';

/** 她这一刻是不是正踩在祭坛那一格上。只有这一处坐标是世界真有的。 */
export function atAltar(villager: VillagerSnapshot, snapshot: WorldSnapshot): boolean {
  return (
    Math.floor(villager.pos.x) === snapshot.altar.x &&
    Math.floor(villager.pos.y) === snapshot.altar.y
  );
}

/** 没牌子时怎么说她在哪儿：人在祭坛才说祭坛，不在就说不准。 */
export function idleLabel(villager: VillagerSnapshot, snapshot: WorldSnapshot): string {
  return villager.routine ?? (atAltar(villager, snapshot) ? '在祭坛边闲逛' : NOT_SOMEWHERE);
}

/**
 * 状态行里她那半句：`名字：在做什么`。
 *
 * `venue` 是活所在的那个铺子的名字（铺子为 null 时传 null）——它由调用方查，
 * 因为查表要的是整份快照，而这里只该管「怎么把 mode 说成一句话」。
 *
 * `idle` 那一支是全部麻烦所在：她没活干，而**没牌子时不编地点**。见
 * `idleLabel`。其余各支都带着世界自己的状态（mode、坐标、活的名字），
 * 没有可编的空档。
 *
 * **赶路的四支必须说得像正在赶路。** `toWork`、`toAltar`、`sheltering`、
 * `bearingDecree` 这四个 mode 的世界状态全是「路还没走完」——`walk()` 只在
 * path 空掉那一刻才翻 mode（`simulation.ts` 的 `toWork`/`toAltar`/`sheltering`
 * 三支都是这个形状），所以这四支的说法得是进行中的。曾经 `toAltar` 说
 * 「回到祭坛」、`sheltering` 说「跑到屋檐下躲雨」，两个都断言人已经到了，
 * 而那一刻她还在半路上——屏上每帧都这么播。同开关里 `toWork` 的「赶往」与
 * `bearingDecree` 的「跑向」本来就是对的写法，照着办。
 */
export function villagerModeLabel(
  villager: VillagerSnapshot,
  snapshot: WorldSnapshot,
  task: TaskRecord | undefined,
  venue: string | null,
): string {
  switch (villager.mode) {
    case 'idle':
      return idleLabel(villager, snapshot);
    case 'saluting':
      return '正向神谕行礼';
    case 'toWork':
      return venue === null ? '赶路' : `赶往 ${venue}`;
    case 'working': {
      // **没有铺子时不提地点。** 这一支曾经说「在祭坛边办「xxx」」——编的：
      // 原地办的那种活（`startInPlace`，`simulation.ts:1615`）只把 mode 翻成
      // 'working'、`path = []`，**根本不挪人**。她站在接到活那一刻的位置，
      // 而那一刻她可以在世界任何一格。实测她绝大多数时候不在祭坛格上。
      //
      // 而这条路比「铺子挑不到」常见得多：`tasks.ts:13` 的 quick 活
      // `venue: 'in_place'`，**每一条 quick 都走它**。两条来路都通到
      // `startInPlace`：神谕派活（`simulation.ts:1874`——「顺手看一眼」那个
      // 按钮 `index.html:628` 发的就是这条命令）与上游事件流
      // （`simulation.ts:1614`）。
      //
      // 世界这一刻只知道她在办这件事，不知道她在哪儿——那就只说这件事。
      // 空summary 也别说成「」：那是两个引号夹一片空白，不是一句话。
      const what = task?.summary;
      if (venue === null) {
        return what === undefined ? '正在干活' : `正在办「${what}」`;
      }
      return what === undefined ? `在 ${venue} 干活` : `在 ${venue} 干活「${what}」`;
    }
    case 'delivering':
      return '正在交付';
    case 'toAltar':
      return '赶回祭坛';
    case 'sheltering':
      return '跑向屋檐下躲雨';
    case 'bearingDecree':
      return '举着急件跑向祭坛';
  }
}
