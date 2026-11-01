/** 地名演变：一个地点什么时候会换名字（协议 §11）。
 *
 * §11 只写了半条：「地名演变保存历史链：`ToponymChanged(place_id, old, new, event_ref)`」。
 * 存储、发出点、接收方都在别处，**「什么里程碑配改名」这条判据没人写过**。
 * 这个文件就是那条判据，而且刻意写成**查表**，不是编故事：
 *
 *   - 事件 kind 决定它**能不能**给一个地点起名字（`EPITHETS`）；
 *   - 那件事有多重决定它**配不配**（`renameImportanceFloor`）。
 *
 * 两样分开是有用的：`conflict`（0.55）在表里，但落在门槛之下——「打架不该
 * 给镇子改名」于是成了一条能验的话，而不是一句没人执行的态度。
 *
 * **表里的字面是本仓原创。** 与 `灯潮界`、`账房先生`、`炉匠铺` 同性质：
 * 本仓只取参考手册的结构、色板与区域语法，不复刻原作的角色、名称或标志性造型。
 * 所以这些称号不是「设定集自带的词」，而是这张表自己起的——改它们不需要
 * 跟任何外部资料对账，只需要改这一个文件。
 */

/**
 * 哪些事能给一个地点起名字。
 *
 * 只有三种。这不是「所有大事都该改名」的清单，而是「这些事**说得出**一个
 * 称号」的清单：一次交付（`task_done`）能立碑，但它给不出一个名字，
 * 硬凑一个就是编。
 */
export const EPITHETS: Readonly<Record<string, string>> = {
  milestone: '立事',
  celebration: '张灯',
  conflict: '争口',
};

/**
 * 这件事该给地点加什么称号。`null` 表示不改名。
 *
 * 两道都要过：kind 在表里，且这件事的重量够得着门槛。
 *
 * 门槛的作用不是「再筛一次大事」——`milestone`（0.6）与 `celebration`（0.8）
 * 本来就都在门槛之上。它的作用是让**表里那条够不着的**（`conflict` 0.55）
 * 真的够不着：那张表说的是「这类事说得出名字」，不是「这类事都配」。
 */
export function epithetFor(kind: string, importance: number, floor: number): string | null {
  const epithet = EPITHETS[kind];
  if (epithet === undefined) return null;
  return importance >= floor ? epithet : null;
}

/** 新名字：原名后面挂一个称号。只挂一次——挂第二次就成了两个称号叠在一起。 */
export function renamed(base: string, epithet: string): string {
  return `${base}·${epithet}`;
}
