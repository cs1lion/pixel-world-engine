/**
 * 回溯问答：把「第 N 天发生过什么」变成可断言的结构，而不是一句文案。
 *
 * 口径：答案只允许引用**当天仍在库里的事实**（`eventRefs` 必须逐个命中），
 * 并且明确写出分母（当天可追溯事件条数）。抽不到数据就返回 `answer: ''`，
 * 由测试记为失败项——不许改问法让它变绿。
 */
export interface DayFact {
  readonly eventId: string;
  readonly day: number;
  readonly tick: number;
  readonly kind: string;
  readonly placeId: string;
  readonly actors: readonly string[];
  readonly witnesses: readonly string[];
  readonly what: string;
}

export interface DayRecord {
  readonly day: number;
  readonly weather: string;
  readonly facts: readonly DayFact[];
}

export interface QaAnswer {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly eventRefs: readonly string[];
  readonly derivation: string;
}

const WEATHER: Record<string, string> = {
  clear: '晴',
  rain: '雨',
  storm: '暴雨',
  not_measured: '未记录',
};

const CONFLICT = /dispute|quarrel|argument|fight|conflict/i;

function union(facts: readonly DayFact[]): string[] {
  const people = new Set<string>();
  for (const fact of facts) {
    for (const actor of fact.actors) people.add(actor);
    for (const witness of fact.witnesses) people.add(witness);
  }
  return [...people].sort();
}

function pairs(facts: readonly DayFact[]): { pair: string; eventId: string }[] {
  const output: { pair: string; eventId: string }[] = [];
  for (const fact of facts) {
    const people = [...new Set([...fact.actors, ...fact.witnesses])].sort();
    for (let left = 0; left < people.length; left += 1) {
      for (let right = left + 1; right < people.length; right += 1) {
        output.push({ pair: `${people[left]}↔${people[right]}`, eventId: fact.eventId });
      }
    }
  }
  return output;
}

export function answerDay(record: DayRecord, villagers: readonly string[]): QaAnswer[] {
  const facts = [...record.facts].sort((left, right) => left.tick - right.tick);
  const ids = facts.map((fact) => fact.eventId);
  const refsOfAll = ids;
  if (facts.length === 0) {
    // 抽不到就当失败项，别拿“未记录”充答案。
    return [];
  }

  const first = facts[0] as DayFact;
  const last = facts[facts.length - 1] as DayFact;
    const places = [...new Set(facts.map((fact) => fact.placeId))].sort();
    const present = union(facts);
    const absent = villagers.filter((villager) => !present.includes(villager));
    const conflicts = facts.filter((fact) => CONFLICT.test(fact.kind));
    const meetings = pairs(facts);
    const meetingPairs = [...new Set(meetings.map((item) => item.pair))].sort();

    const busiest = places
      .map((place) => ({ place, count: facts.filter((fact) => fact.placeId === place).length }))
      .sort((left, right) => right.count - left.count || left.place.localeCompare(right.place))[0] ??
      { place: 'unknown', count: 0 };

    const quoted = facts.find((fact) => fact.what.length > 0);

    return [
      {
        id: 'people',
        question: '那天有几个人？',
        answer: `${present.length} 人（${present.join('、')}）；当天可追溯事件 ${facts.length} 条`,
        eventRefs: refsOfAll,
        derivation: 'actors ∪ witnesses，按当天全部事实取并集',
      },
      {
        id: 'first',
        question: '那天第一件事是什么？',
        answer: `${first.what}（${first.placeId}，tick ${first.tick}）`,
        eventRefs: [first.eventId],
        derivation: '在当天仍可追溯的事实里取 tick 最小的一条',
      },
      {
        id: 'last',
        question: '那天最后一件事是什么？',
        answer: `${last.what}（${last.placeId}，tick ${last.tick}）`,
        eventRefs: [last.eventId],
        derivation: '在当天仍可追溯的事实里取 tick 最大的一条',
      },
      {
        id: 'places',
        question: '那天去过哪些地方？',
        answer: `${places.length} 处：${places.join('、')}`,
        eventRefs: places.map((place) => facts.find((fact) => fact.placeId === place)!.eventId),
        derivation: '当天事实的 placeId 去重，每处取最早一条为证',
      },
      {
        id: 'conflict',
        question: '那天有没有争执？',
        answer: conflicts.length === 0
          ? `没有争执（当天 ${facts.length} 条可追溯事件里没有争执类）`
          : `有 ${conflicts.length} 次：${conflicts.map((fact) => fact.what).join('；')}`,
        eventRefs: conflicts.length === 0 ? refsOfAll : conflicts.map((fact) => fact.eventId),
        derivation: 'kind 命中 dispute/quarrel/argument/fight/conflict；无命中时以当天全部事实为分母',
      },
      {
        id: 'met',
        question: '那天和谁见过？',
        answer: meetingPairs.length === 0
          ? `当天 ${facts.length} 条事实里没有两人同场`
          : meetingPairs.join('、'),
        eventRefs: meetings.map((item) => item.eventId),
        derivation: '同一条事实的 actors ∪ witnesses 两两成对',
      },
      {
        id: 'weather',
        question: '那天天气如何？',
        answer: `${WEATHER[record.weather] ?? record.weather}（summary 记录：${record.weather}）`,
        eventRefs: [first.eventId, last.eventId],
        derivation: '天气取自 summary 的 day.weather；事件引用只作当天边界旁证，不冒充天气来源',
      },
      {
        id: 'absent',
        question: '那天谁不在？',
        answer: absent.length === 0 ? '无人缺席' : `${absent.length} 人不在：${absent.join('、')}`,
        eventRefs: refsOfAll,
        derivation: `常驻名单 ${villagers.join('、')} 减去当天 actors ∪ witnesses`,
      },
      {
        id: 'quote',
        question: quoted === undefined ? '那天有人说过话吗？' : `“${quoted.what}”是谁说的？`,
        answer: quoted === undefined ? '' : `${quoted.what} — ${quoted.actors.join('、') || '（无署名）'}`,
        eventRefs: quoted === undefined ? [] : [quoted.eventId],
        derivation: '取当天第一条 what 非空的事实，原句照抄，说话人取 actors',
      },
      {
        id: 'busiest',
        question: '那天最热闹的地方是哪里？',
        answer: `${busiest.place}（${busiest.count} 条事实）`,
        eventRefs: facts.filter((fact) => fact.placeId === busiest.place).map((fact) => fact.eventId),
        derivation: '当天事实按 placeId 计数，取最多者；并列时按地点名排序',
      },
    ];
}

export interface RewindCheck {
  readonly day: number;
  readonly id: string;
  readonly question: string;
  readonly ok: boolean;
  readonly failures: readonly string[];
}

export interface RewindRun {
  readonly schema: 'eval-rewind-qa/1';
  readonly provenance: unknown;
  readonly villagers: readonly string[];
  readonly days: readonly number[];
  readonly checks: readonly RewindCheck[];
  readonly passed: number;
  readonly failed: number;
  readonly answers: readonly { day: number; answers: readonly QaAnswer[] }[];
}

/** 40 条断言：4 天 × 10 问，每条都要求「有答案、有出处、出处属于当天」。 */
export function runRewindQa(fixture: {
  provenance?: unknown;
  days: readonly DayRecord[];
  villagers?: readonly string[];
}): RewindRun {
  const villagers = fixture.villagers === undefined
    ? villagersOf(fixture.days)
    : [...fixture.villagers];
  const checks: RewindCheck[] = [];
  const answers: { day: number; answers: readonly QaAnswer[] }[] = [];

  for (const record of fixture.days) {
    const dayIds = new Set(record.facts.map((fact) => fact.eventId));
    const ordered = [...record.facts].sort((left, right) => left.tick - right.tick);
    const produced = answerDay(record, villagers);
    answers.push({ day: record.day, answers: produced });

    for (const answer of produced) {
      const failures: string[] = [];
      if (answer.answer.trim() === '') failures.push('答案为空');
      if (answer.eventRefs.length === 0) failures.push('没有 eventRefs');
      for (const ref of answer.eventRefs) {
        if (!dayIds.has(ref)) failures.push(`引用了不属于当天的 ${ref}`);
      }

      switch (answer.id) {
        case 'people': {
          const expected = new Set<string>();
          for (const fact of record.facts) {
            for (const actor of fact.actors) expected.add(actor);
            for (const witness of fact.witnesses) expected.add(witness);
          }
          if (!answer.answer.startsWith(`${expected.size} 人`)) {
            failures.push(`人数与并集不符：期望 ${expected.size}`);
          }
          break;
        }
        case 'first':
          if (ordered.length > 0 && answer.eventRefs[0] !== ordered[0]?.eventId) {
            failures.push('首条与 tick 最小事实不符');
          }
          break;
        case 'last':
          if (ordered.length > 0 && answer.eventRefs[0] !== ordered[ordered.length - 1]?.eventId) {
            failures.push('末条与 tick 最大事实不符');
          }
          break;
        case 'places': {
          const places = new Set(record.facts.map((fact) => fact.placeId));
          if (!answer.answer.startsWith(`${places.size} 处`)) {
            failures.push(`地点数与去重不符：期望 ${places.size}`);
          }
          break;
        }
        case 'conflict': {
          const conflicts = record.facts.filter((fact) => CONFLICT.test(fact.kind)).length;
          if (conflicts === 0 && !answer.answer.startsWith('没有争执')) {
            failures.push('没有争执类事实，但答案说发生了争执');
          }
          if (conflicts > 0 && !answer.answer.startsWith(`有 ${conflicts} 次`)) {
            failures.push(`争执次数与事实不符：期望 ${conflicts}`);
          }
          break;
        }
        case 'met': {
          // 见面名单必须从当天 facts 重算：同一条事实的 actors ∪ witnesses 两两成对。
          const expected = new Set<string>();
          for (const fact of record.facts) {
            const people = [...new Set([...fact.actors, ...fact.witnesses])].sort();
            for (let left = 0; left < people.length; left += 1) {
              for (let right = left + 1; right < people.length; right += 1) {
                expected.add(`${people[left]}↔${people[right]}`);
              }
            }
          }
          if (expected.size === 0) {
            if (!answer.answer.startsWith(`当天 ${record.facts.length} 条事实里没有两人同场`)) {
              failures.push(`当天没有两人同场，但答案不是这个口径：${answer.answer}`);
            }
            break;
          }
          const actual = new Set(answer.answer.split('、'));
          const missing = [...expected].filter((pair) => !actual.has(pair));
          const extra = [...actual].filter((pair) => !expected.has(pair));
          if (missing.length > 0 || extra.length > 0) {
            failures.push(
              `见面名单与事实重算不符（应为 ${expected.size} 对）：` +
              `缺 ${missing.join('、') || '无'}；多 ${extra.join('、') || '无'}`,
            );
          }
          break;
        }
        case 'absent': {
          // 缺席名单必须重算：常驻名单 − 当天 actors ∪ witnesses。
          const present = new Set<string>();
          for (const fact of record.facts) {
            for (const actor of fact.actors) present.add(actor);
            for (const witness of fact.witnesses) present.add(witness);
          }
          const outsiders = [...present].filter((person) => !villagers.includes(person));
          if (outsiders.length > 0) {
            failures.push(`事实里出现了非常驻名单的人：${outsiders.join('、')}`);
          }
          const expectedAbsent = villagers.filter((person) => !present.has(person));
          if (expectedAbsent.length === 0) {
            if (!answer.answer.startsWith('无人缺席')) {
              failures.push(`重算无人缺席，但答案不是：${answer.answer}`);
            }
            break;
          }
          const prefix = `${expectedAbsent.length} 人不在：`;
          if (!answer.answer.startsWith(prefix)) {
            failures.push(`缺席人数与重算不符：期望 ${expectedAbsent.length}`);
            break;
          }
          const listed = answer.answer.slice(prefix.length).split('、');
          if (listed.join('、') !== expectedAbsent.join('、')) {
            failures.push(`缺席名单与重算不符：期望 ${expectedAbsent.join('、')}，实际 ${listed.join('、')}`);
          }
          break;
        }
        case 'weather': {
          const label = WEATHER[record.weather] ?? record.weather;
          if (!answer.answer.includes(label)) failures.push(`天气标签缺失：${label}`);
          break;
        }
        case 'quote': {
          const quoted = ordered.find((fact) => fact.what.length > 0);
          if (quoted !== undefined && !answer.answer.includes(quoted.what)) {
            failures.push('引用的原句在当天事实里找不到');
          }
          break;
        }
        case 'busiest': {
          const counts = new Map<string, number>();
          for (const fact of record.facts) {
            counts.set(fact.placeId, (counts.get(fact.placeId) ?? 0) + 1);
          }
          const max = Math.max(...counts.values());
          const refsPlaces = new Set(
            answer.eventRefs.map((ref) => record.facts.find((fact) => fact.eventId === ref)?.placeId),
          );
          if (refsPlaces.size !== 1) failures.push('最热闹地点的引用跨了多个地点');
          if (refsPlaces.size === 1 && !answer.answer.startsWith(`${[...refsPlaces][0]}（${max} 条`)) {
            failures.push('最热闹地点或计数与事实不符');
          }
          break;
        }
        default:
          break;
      }

      checks.push({
        day: record.day,
        id: answer.id,
        question: answer.question,
        ok: failures.length === 0,
        failures,
      });
    }

    if (produced.length !== 10) {
      // 空天数或产出不足：补足到 10 条失败项，保持分母恒为 40。
      for (let missing = produced.length; missing < 10; missing += 1) {
        checks.push({
          day: record.day,
          id: `missing-${missing}`,
          question: '当天 10 问是否齐全',
          ok: false,
          failures: ['没有产出答案（事实库为空或问答器失效）'],
        });
      }
    }
  }

  const failed = checks.filter((check) => !check.ok).length;
  return {
    schema: 'eval-rewind-qa/1',
    provenance: fixture.provenance ?? null,
    villagers,
    days: fixture.days.map((record) => record.day),
    checks,
    passed: checks.length - failed,
    failed,
    answers,
  };
}

export function villagersOf(records: readonly DayRecord[]): string[] {
  const people = new Set<string>();
  for (const record of records) {
    for (const person of union(record.facts)) people.add(person);
  }
  return [...people].sort();
}
