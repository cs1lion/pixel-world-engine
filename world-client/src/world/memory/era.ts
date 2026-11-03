/** 时代分期：不是另一套记忆，是每日状态的**分段摘要**。
 *
 * 一件事记在谁身上，是人物记忆；一段日子叫什么，是场景记忆。时代这一层
 * 只回答一个问题：**这一段时间里，这块地方变成了什么样**。
 *
 * 切段全按规则，不交给模型，也不看「昨天」：
 *
 * - 每天算一份签名（八个标量，见 `EraSignature`）；
 * - 把今天与**段首**比：越过阈值就关掉上一段、开新段；
 * - 段太短（`eraMinDays`）不切——短于一个月的起伏不该长成一个时代。
 *
 * 只比「今天 vs 段首」而不比「今天 vs 昨天」，是因为后者会让一个缓慢的
 * 长期漂移永远切不开：每天只差一点点，攒一年也够不着阈值。
 */

import type { MemoryConfig } from './config.ts';
import type { Era, EraSignature, WorldVitals } from './types.ts';

/** 算一份日签名要喂的东西。全部来自世界自己的读数，不读墙钟。 */
export interface EraSignatureInput {
  readonly day: number;
  readonly vitals: WorldVitals;
  readonly buildingCount: number;
  readonly ruinCount: number;
  readonly legendReachSum: number;
  readonly population: number;
}

export function signatureOf(input: EraSignatureInput): EraSignature {
  return {
    day: input.day,
    meanValence: input.vitals.meanValence,
    meanArousal: input.vitals.meanArousal,
    infoEntropy: input.vitals.infoEntropy,
    isolatedHolders: input.vitals.isolatedHoldersCount,
    buildingCount: input.buildingCount,
    ruinCount: input.ruinCount,
    legendReachSum: input.legendReachSum,
    population: input.population,
  };
}

/**
 * 今天与段首差得够不够远。返回**怎么差**的几条理由（空数组 = 不切段）。
 *
 * 三个阈值各有出处：
 * - 效价 0.25：晴天 0.1、事故 -0.3，两者之间约 0.4；0.25 是「从平常
 *   掉进阴天」的一半，不至于把一场阵雨读成一个时代；
 * - 孤立人数 30%：三个人里有一个不再跟人说话，就该算一次社会变化；
 * - 楼的数量 20%：七栋楼里少一栋是 14%、少两栋是 28%——20% 让「少两栋」
 *   切开、让「少一栋」留在原来的年代里。
 */
export function eraBreakReasons(
  start: EraSignature,
  now: EraSignature,
  config: MemoryConfig,
): readonly string[] {
  const reasons: string[] = [];
  if (now.day - start.day < config.eraMinDays) return reasons;

  if (Math.abs(now.meanValence - start.meanValence) >= config.eraValenceShift) {
    reasons.push('valence');
  }
  const population = Math.max(1, now.population);
  if (Math.abs(now.isolatedHolders - start.isolatedHolders) >= config.eraIsolationShare * population) {
    reasons.push('isolation');
  }
  const baseBuildings = Math.max(1, start.buildingCount);
  if (Math.abs(now.buildingCount - start.buildingCount) >= config.eraBuildingShare * baseBuildings) {
    reasons.push('buildings');
  }
  // 废墟也在变：一片地被拆掉之后过了很久仍没有重建，那也是一次时代转折——
  // 它不表现在「楼少了多少」上（楼早就少了），而表现在「废墟多了多少」上。
  if (now.ruinCount - start.ruinCount >= Math.max(2, Math.round(config.eraBuildingShare * baseBuildings))) {
    reasons.push('ruins');
  }
  return reasons;
}

/**
 * 这个时代叫什么。**规则表，不是模型起的名字**——同一份存档跑两遍，
 * 时代标签必须一样，否则「回放一致」就没了。
 *
 * 顺序即优先级：先看「重建」，再看「长夜」，最后才是「平常」。
 */
export function eraLabel(now: EraSignature, start: EraSignature): string {
  const population = Math.max(1, now.population);
  const isolatedShare = now.isolatedHolders / population;
  if (now.ruinCount < start.ruinCount && now.buildingCount > start.buildingCount) {
    return '重建年代';
  }
  if (now.meanValence <= -0.2 && isolatedShare >= 0.5) return '长夜';
  if (now.buildingCount >= Math.max(1, start.buildingCount) * (1 + 0.2)) return '立楼年代';
  if (isolatedShare >= 0.5) return '寂静年代';
  if (now.meanValence >= 0.2) return '灯潮初年';
  return '潮平年代';
}

/**
 * 可信度：段有多长。`spanDays / 90`，封顶 1。
 *
 * 90 天是一个季度：一个季度以上的时代才该被当成「一个年代」来讲；
 * 刚开的两三天只是「这一阵」。
 */
export function eraConfidence(fromDay: number, toDay: number): number {
  const span = Math.max(1, toDay - fromDay + 1);
  return Math.min(1, span / 90);
}

/** 开一个新段。`eraId` 由世界发（自增，不用随机数）。 */
export function openEra(eraId: string, signature: EraSignature): Era {
  return {
    eraId,
    fromDay: signature.day,
    toDay: null,
    label: eraLabel(signature, signature),
    startSignature: signature,
    lastSignature: signature,
    definingEventRefs: [],
    confidence: eraConfidence(signature.day, signature.day),
  };
}

/**
 * 把今天记进当前时代。
 *
 * 返回 `{ closed, open }`：`closed` 非 null 表示今天切了段，上一段在这天前一天
 * 结束；`open` 是记完今天之后的当前段（同一段的话 `eraId` 不变）。
 * `definingEventRefs` 只在关段时由调用方填（要扫段内的事实），这里不扫。
 */
export function advanceEra(
  era: Era,
  now: EraSignature,
  config: MemoryConfig,
  nextEraId: () => string,
  definingEventRefsOf: (fromDay: number, toDay: number) => readonly string[],
): { readonly closed: Era | null; readonly open: Era } {
  const reasons = eraBreakReasons(era.startSignature, now, config);
  if (reasons.length === 0) {
    return {
      closed: null,
      open: {
        ...era,
        label: eraLabel(now, era.startSignature),
        lastSignature: now,
        confidence: eraConfidence(era.fromDay, now.day),
      },
    };
  }
  const toDay = now.day - 1;
  const closed: Era = {
    ...era,
    toDay,
    label: eraLabel(era.lastSignature, era.startSignature),
    confidence: eraConfidence(era.fromDay, toDay),
    definingEventRefs: definingEventRefsOf(era.fromDay, toDay),
  };
  return { closed, open: openEra(nextEraId(), now) };
}
