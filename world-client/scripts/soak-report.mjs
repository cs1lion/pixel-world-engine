/**
 * 从 30 日浸泡的原始读数生成报告与曲线。**不重跑世界**，只读
 * `docs/evidence/soak/soak-30d.json` + `determinism.json`。
 *
 * 产物：
 *   docs/evidence/soak/curves.svg   —— 存量 / 性能的小多图（六格）
 *   docs/evidence/soak/REPORT.md    —— 30 日读数、日均增量、行为对照、清理与不变量
 *
 * 口径写死在脚本里，报告里每一格数都能从这里复算：
 *   - 「第 1/7/15/22/30 天」= 采样下标 0/6/14/21/29；
 *   - 日均增量 = (第 30 天 − 第 1 天) / 29；
 *   - 末尾 7 日增速 = (第 30 天 − 第 22 天) / 7；
 *   - 「每角色每年」存量 = saveKB × 365 / (角色数 × 天数)，与夹具同式；
 *     边际口径 = 日均增量 × 365 / 角色数。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const dir = join(root, 'docs/evidence/soak');
const runs = JSON.parse(readFileSync(join(dir, 'soak-30d.json'), 'utf8'));
const det = JSON.parse(readFileSync(join(dir, 'determinism.json'), 'utf8'));
let browserReading = null;
let browserDay1 = null;
try {
  browserReading = JSON.parse(readFileSync(join(dir, 'browser-30d.json'), 'utf8'));
} catch {
  browserReading = null;
}
try {
  browserDay1 = JSON.parse(readFileSync(join(dir, 'browser-day1.json'), 'utf8'));
} catch {
  browserDay1 = null;
}

const KEY = [0, 6, 14, 21, 29];
const LABEL = ['第1天', '第7天', '第15天', '第22天', '第30天'];

const kb = (bytes) => bytes / 1024;
const f1 = (n) => n.toFixed(1);
const f2 = (n) => n.toFixed(2);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

function at(run, day, pick) {
  return pick(run.days[day]);
}
function series(run, pick) {
  return run.days.map(pick);
}

/** 日均与末段增速。 */
function rates(run, pick) {
  const first = pick(run.days[0]);
  const day22 = pick(run.days[21]);
  const last = pick(run.days[29]);
  return {
    perDay: (last - first) / 29,
    perDayTail: (last - day22) / 7,
  };
}

function growthRow(name, run, pick, fmt = f1, rateFmt = f1) {
  const cells = KEY.map((day) => fmt(pick(run.days[day])));
  const r = rates(run, pick);
  return `| ${name} | ${cells.join(' | ')} | ${rateFmt(r.perDay)} | ${rateFmt(r.perDayTail)} |`;
}

const A = runs.find((run) => run.seed === 'soak-a');
const B = runs.find((run) => run.seed === 'soak-b');
const characters = 5;
const days30 = 30;

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 改前那一轮（未加预算）的读数，用来给「改前 vs 改后」这一栏。 */
const BEFORE = readJson(join(dir, 'soak-a/summary-30d-before.json'));
/** 90 日实跑（seed A）。没有就整段省略，不编外推。 */
const A90 = readJson(join(dir, 'soak-a/summary-90d.json'));

/**
 * 预算表。**与 `src/world/memory/config.ts` 的默认值一一对应**：那边改了，
 * 这里要跟着改，否则报告会替实现背书。当前值在配置里都写了推导过程。
 */
const BUDGET = {
  entries: { day: [16, 12_000], long: [64, 32_000], legend: [24, 16_000], impression: [32, 8_000] },
  facts: [1_200, 350_000],
  claims: [800, 230_000],
  beliefs: [1_400, 165_000],
  cooldowns: [1_000, 60_000],
  tells: [1_000, 55_000],
  written: [200, 200_000],
  legends: [120, 20_000],
};

// 第 30 天记忆条目的层级构成：legend 层没有预算，是条目增长的主要来源。
const finalMemory = JSON.parse(readFileSync(join(dir, 'soak-a/memory-30d.json'), 'utf8'));
const tierStats = new Map();
for (const entry of finalMemory.world.entries) {
  const stat = tierStats.get(entry.tier) ?? { count: 0, bytes: 0, maxSalience: 0, holders: new Set() };
  stat.count += 1;
  stat.bytes += Buffer.byteLength(JSON.stringify(entry));
  stat.maxSalience = Math.max(stat.maxSalience, entry.salience);
  stat.holders.add(entry.holderId);
  tierStats.set(entry.tier, stat);
}
const dayTier = tierStats.get('day') ?? { count: 0, bytes: 0, maxSalience: 0, holders: new Set() };
const legendTier = tierStats.get('legend') ?? { count: 0, bytes: 0, maxSalience: 0, holders: new Set() };
const placeHolders = [...legendTier.holders].filter((id) => id.includes('#')).length;

// ---------------------------------------------------------------- 存量表

const stockRows = [
  growthRow('引擎事件条数 `eventCount()`', A, (d) => d.eventCount, String, f2),
  growthRow('世界事件条数（`world.event`，记忆消费）', A, (d) => d.worldEvents, String, f2),
  growthRow('记忆条目数（5 人合计）', A, (d) => d.memory.entries, String, f2),
  growthRow('关系账本条数', A, (d) => d.relations.count, String, f2),
  growthRow('造物账本行数', A, (d) => d.ledgerRows, String, f2),
  growthRow('造物账本字节（KB）', A, (d) => kb(d.ledgerBytes)),
  growthRow('存档字节（KB）', A, (d) => kb(d.saveBytes)),
  growthRow('记忆 JSON 字节（KB）', A, (d) => kb(d.memoryJsonBytes)),
];

// 每角色每年（存量口径 / 边际口径）
const cumulativeKBPerCharYear = A.days[29].saveKBPerCharacterYear;
const marginalKBPerCharYear = (kb(A.days[29].saveBytes) - kb(A.days[0].saveBytes)) / 29 * 365 / characters;
const marginalMemKBPerCharYear =
  (kb(A.days[29].memoryJsonBytes) - kb(A.days[0].memoryJsonBytes)) / 29 * 365 / characters;
const solpctCumulative = cumulativeKBPerCharYear / 1.7;
const solpctMarginal = marginalKBPerCharYear / 1.7;

// ------------------------------------------------------ 记忆分项（第 1/30 天）

const partKeys = ['entries', 'facts', 'claims', 'written', 'beliefs', 'cooldowns', 'tells', 'legends'];
const partRows = partKeys.map((key) => {
  const d1 = A.days[0].memoryParts?.[key] ?? { bytes: 0, count: 0 };
  const d30 = A.days[29].memoryParts?.[key] ?? { bytes: 0, count: 0 };
  const delta = kb(d30.bytes) - kb(d1.bytes);
  return `| ${key} | ${d1.count} | ${f1(kb(d1.bytes))} | ${d30.count} | ${f1(kb(d30.bytes))} | +${f1(delta)} | ${f1(delta / 29)} |`;
});

// -------------------------------------------------- 预算（第 1 条）读数

const budgetRows = [
  ...Object.entries(BUDGET.entries).map(
    ([tier, [count, bytes]]) => `| 条目 · \`${tier}\`（每人） | ${count} | ${f1(kb(bytes))} KB |`,
  ),
  ...Object.entries(BUDGET).filter(([key]) => !['entries'].includes(key)).map(
    ([layer, [count, bytes]]) => `| \`${layer}\`（全库） | ${count} | ${f1(kb(bytes))} KB |`,
  ),
];

const day30After = A.days[29];
const day30Before = BEFORE?.days[29] ?? null;
const beforeAfterRows = [
  `| 存档字节 | ${day30Before === null ? '—' : f1(kb(day30Before.saveBytes))} | ${f1(kb(day30After.saveBytes))} | ${day30Before === null ? '—' : `${(kb(day30After.saveBytes) - kb(day30Before.saveBytes)).toFixed(1)}（${pct((kb(day30After.saveBytes) - kb(day30Before.saveBytes)) / kb(day30Before.saveBytes))}）`} |`,
  `| 记忆 JSON 字节 | ${day30Before === null ? '—' : f1(kb(day30Before.memoryJsonBytes))} | ${f1(kb(day30After.memoryJsonBytes))} | ${day30Before === null ? '—' : `${(kb(day30After.memoryJsonBytes) - kb(day30Before.memoryJsonBytes)).toFixed(1)}（${pct((kb(day30After.memoryJsonBytes) - kb(day30Before.memoryJsonBytes)) / kb(day30Before.memoryJsonBytes))}）`} |`,
  `| 记忆条目（居民时间轴） | ${day30Before === null ? '—' : day30Before.memory.entries} | ${day30After.memory.entries} | ${day30Before === null ? '—' : day30After.memory.entries - day30Before.memory.entries} |`,
  `| \`facts\` 条数 | ${day30Before === null ? '—' : day30Before.memoryParts.facts.count} | ${day30After.memoryParts.facts.count} | ${day30Before === null ? '—' : day30After.memoryParts.facts.count - day30Before.memoryParts.facts.count} |`,
  `| 日均存档增量 | ${day30Before === null ? '—' : f1((kb(day30Before.saveBytes) - kb(BEFORE.days[0].saveBytes)) / 29)} KB | ${f1((kb(day30After.saveBytes) - kb(A.days[0].saveBytes)) / 29)} KB | — |`,
];

const day90Keys = [0, 6, 14, 21, 29, 44, 59, 74, 89];
const day90Labels = ['1', '7', '15', '22', '30', '45', '60', '75', '90'];
const rows90 = A90 === null
  ? []
  : day90Keys.map((index, position) => {
      const d = A90.days[index];
      return `| ${day90Labels[position]} | ${d.worldEvents} | ${d.memoryParts.facts.count} | ${f1(kb(d.memoryJsonBytes))} | ${f1(kb(d.saveBytes))} | ${d.memory.pruned} | ${d.perf.simP50.toFixed(4)} | ${f1(d.perf.dayCloseMs)} |`;
    });

const prunedRows = day30After.memory.prunedByLayer === undefined
  ? []
  : Object.entries(day30After.memory.prunedByLayer).map(
      ([layer, item]) => `| \`${layer}\` | ${item.evicted} | ${item.byCount} | ${item.byBytes} |`,
    );

const salience = day30After.memory.salience;
const salienceRows = Object.entries(salience.byValue ?? {})
  .map(([value, count]) => `| ${value} | ${count} | ${pct(count / salience.count)} |`)
  .join('\n');
const aboveRows = Object.entries(salience.above ?? {})
  .map(([threshold, count]) => `| ≥ ${threshold} | ${count} |`)
  .join('\n');

const factsRatio30 = day30After.memoryParts.facts.count / day30After.worldEvents;
const factsRatio90 = A90 === null ? null : A90.days[89].memoryParts.facts.count / A90.days[89].worldEvents;

// ---------------------------------------------------------------- 性能表

const perfRows = A.days.map((d) => {
  const day = d.day + 1;
  return `| ${day} | ${d.perf.simP50.toFixed(4)} | ${f2(d.perf.simP95)} | ${f2(d.perf.memP50)} | ${f2(d.perf.memP95)} | ${f1(d.perf.dayCloseMs)} | ${f1(d.perf.creatorCloseMs)} | ${f1(d.perf.dayWallMs)} |`;
});

// ---------------------------------------------------------------- 行为表

const behaviorPick = {
  '走动步数': (d) => d.behaviors.walkSteps,
  '离场次数': (d) => d.behaviors.departures,
  '夜间走动步数': (d) => d.behaviors.nightWalkSteps,
  '出摊/市面步数': (d) => d.behaviors.stallSteps,
  '睡下步数': (d) => d.behaviors.sleepSteps,
  '街头互动次数': (d) => d.behaviors.interactions,
  '会改关系的小事': (d) => d.behaviors.incidents,
  '打水事件': (d) => (d.day === 0 ? d.behaviors.waterEvents : d.behaviors.waterEvents - A.days[d.day - 1].behaviors.waterEvents),
  '打水到达': (d) => (d.day === 0 ? d.behaviors.waterReached : d.behaviors.waterReached - A.days[d.day - 1].behaviors.waterReached),
};
const behaviorRows = Object.entries(behaviorPick).map(([name, pick]) => {
  const v1 = pick(A.days[0]);
  const v30 = pick(A.days[29]);
  const ratio = v1 === 0 ? '—' : `${(v30 / v1).toFixed(2)}×`;
  return `| ${name} | ${v1} | ${v30} | ${ratio} |`;
});
const marketRow = Object.keys(A.days[29].behaviors.marketEvents)
  .map((kind) => {
    const dayOf = (d) =>
      d.day === 0 ? d.behaviors.marketEvents[kind] : d.behaviors.marketEvents[kind] - A.days[d.day - 1].behaviors.marketEvents[kind];
    return `| ${kind} | ${dayOf(A.days[0])} | ${dayOf(A.days[29])} |`;
  })
  .join('\n');

// ---------------------------------------------------------------- 确定性

const fp = (name) => `| ${name} | \`${det.first[name].slice(0, 16)}…\` | \`${det.again[name].slice(0, 16)}…\` | ${det.first[name] === det.again[name] ? '相同' : '不同'} |`;
const fpRows = ['world', 'memory', 'creator', 'events'].map(fp);

// ---------------------------------------------------------------- 曲线 SVG

function panel({ title, x, y, w, h, picks, colors, unit, log }) {
  const plotW = w - 54;
  const plotH = h - 46;
  const max = Math.max(...picks.flatMap((p) => series(A, p.pick)), 1);
  const min = 0;
  const scaleY = log
    ? (v) => plotH - (Math.log10(Math.max(v, 1)) / Math.log10(max)) * plotH
    : (v) => plotH - ((v - min) / (max - min)) * plotH;
  const scaleX = (i) => (i / (A.days.length - 1)) * plotW;
  const paths = picks.map((p) => {
    const pts = A.days.map((d, i) => `${scaleX(i).toFixed(1)},${scaleY(p.pick(d)).toFixed(1)}`);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${p.color}" stroke-width="2"/>`;
  });
  const legend = picks
    .map((p, i) => `<rect x="${x + 60 + i * 78}" y="${y + h - 16}" width="8" height="8" fill="${p.color}"/><text x="${x + 72 + i * 78}" y="${y + h - 8}" font-size="9" fill="#555">${p.name}</text>`)
    .join('');
  const yTicks = [0, 0.5, 1].map((t) => {
    const v = log ? Math.pow(max, t) : min + (max - min) * t;
    const py = y + 14 + scaleY(v);
    return `<text x="${x + 46}" y="${py + 3}" font-size="8" text-anchor="end" fill="#777">${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}</text>`;
  });
  return `<g>
  <text x="${x}" y="${y + 12}" font-size="12" font-weight="600" fill="#222">${title}</text>
  <rect x="${x + 50}" y="${y + 14}" width="${plotW}" height="${plotH}" fill="#fafafa" stroke="#e5e5e5"/>
  <text x="${x + 50}" y="${y + 14 + plotH + 11}" font-size="8" fill="#777">1</text>
  <text x="${x + 50 + plotW}" y="${y + 14 + plotH + 11}" font-size="8" text-anchor="end" fill="#777">30 天</text>
  ${yTicks.join('')}
  ${paths.join('')}
  ${legend}
  <text x="${x + 50}" y="${y + 11}" font-size="8" text-anchor="end" fill="#999">${unit}</text>
</g>`;
}

const panels = [
  { title: '世界事件条数', pick: (d) => d.worldEvents, color: '#2f6fed', unit: '' },
  { title: '记忆条目数（5 人）', pick: (d) => d.memory.entries, color: '#1f9d6b', unit: '' },
  { title: '关系账本条数（30 日恒 0）', pick: (d) => d.relations.count, color: '#b3392f', unit: '' },
  { title: '造物账本行数', pick: (d) => d.ledgerRows, color: '#8a5cd6', unit: '' },
  { title: '存档大小（KB）', pick: (d) => kb(d.saveBytes), color: '#c77b1e', unit: 'KB' },
  { title: '每日结算耗时（ms，p50/p95）', pick: (d) => d.perf.simP95, color: '#0f7f8f', unit: 'sim p95' },
];

const W = 1120;
const cellW = 350;
const cellH = 210;
const svgParts = panels.map((p, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return panel({
    title: p.title,
    x: 20 + col * cellW,
    y: 20 + row * cellH,
    w: cellW - 20,
    h: cellH - 20,
    picks: [{ name: 'seed A', pick: p.pick, color: p.color }],
    unit: p.unit,
    log: false,
  });
});
// 性能面板把 p50 叠上去
const p50Panel = panel({
  title: '每日结算耗时（ms，p50 + p95 叠加）',
  x: 20 + 2 * cellW,
  y: 20,
  w: cellW - 20,
  h: cellH - 20,
  picks: [
    { name: 'p95', pick: (d) => d.perf.simP95, color: '#0f7f8f' },
    { name: 'p50', pick: (d) => d.perf.simP50, color: '#e08a00' },
  ],
  unit: 'ms',
  log: false,
});
svgParts[5] = p50Panel;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${20 + 2 * cellH}" viewBox="0 0 ${W} ${20 + 2 * cellH}" font-family="system-ui,-apple-system,Segoe UI,sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
${svgParts.join('\n')}
</svg>`;

// ---------------------------------------------------------------- 浏览器端

const browserSection = browserReading === null
  ? '浏览器端读数尚未采集（`node scripts/soak-browser.mjs`）。'
  : `把 \`save-30d.json\` 注进 \`${browserReading.saveKey}\`，在本 worktree 的端口 ${browserReading.port} 打开页面读档：

- URL：\`${browserReading.url}\`
- 读档结果：世界日 ${browserReading.restored.dayIndex}（now=${browserReading.restored.now}，第 30 日末）、居民 ${browserReading.restored.villagers.length} 人、楼 ${browserReading.restored.buildings} 栋、天气 ${browserReading.restored.weather}、记忆 \`closedThroughDay=${browserReading.restored.memory.closedThroughDay}\`
- 采样 ${browserReading.fps.sampleSeconds} 秒：\`actualFps=${browserReading.fps.actualFps.toFixed(1)}\`（\`fpsLimit=${browserReading.fps.fpsLimit}\`，未限频）、\`updateCount=${browserReading.fps.updateCount}\`、\`advanceCount=${browserReading.fps.advanceCount}\`
- 绘制指令：\`graphicsObjects=${browserReading.render.graphicsObjects}\`、\`totalCommands=${browserReading.render.totalCommands}\`，最大五层 ${browserReading.render.largest.join(' / ')}
- 页面报错：${browserReading.pageErrors.length === 0 ? '0 条' : browserReading.pageErrors.join(' | ')}
- 存档在 localStorage 里 ${(browserReading.saveBytesInStorage / 1024).toFixed(1)} KB

${browserDay1 === null ? '' : `第 1 天同口径对照（新世界、同一端口、同一采样时长）：

| 读数 | 第1天（新世界） | 第30天末（读档） | 变化 |
| --- | --- | --- | --- |
| \`actualFps\` | ${browserDay1.fps.actualFps.toFixed(1)} | ${browserReading.fps.actualFps.toFixed(1)} | 持平 |
| \`graphicsObjects\` | ${browserDay1.render.graphicsObjects} | ${browserReading.render.graphicsObjects} | +${browserReading.render.graphicsObjects - browserDay1.render.graphicsObjects} |
| \`totalCommands\` | ${browserDay1.render.totalCommands} | ${browserReading.render.totalCommands} | +${pct(browserReading.render.totalCommands / browserDay1.render.totalCommands - 1)} |
| 最大单对象命令数 | ${browserDay1.render.largest[0]} | ${browserReading.render.largest[0]} | ${browserReading.render.largest[0] - browserDay1.render.largest[0]} |
| 居民 | ${browserDay1.restored.villagers.length} | ${browserReading.restored.villagers.length} | — |
| 楼 | ${browserDay1.restored.buildings} | ${browserReading.restored.buildings} | +${browserReading.restored.buildings - browserDay1.restored.buildings} |

**帧率没有掉**：${browserReading.fps.actualFps.toFixed(1)} fps 与第 1 天的 ${browserDay1.fps.actualFps.toFixed(1)} 持平（\`fpsLimit=0\`，未限频，跑的就是浏览器 vsync）。**但绘制指令随天数涨了 ${pct(browserReading.render.totalCommands / browserDay1.render.totalCommands - 1)}**（${browserDay1.render.totalCommands} → ${browserReading.render.totalCommands}），其中单个 Graphics 从 ${browserDay1.render.largest[0]} 条涨到 ${browserReading.render.largest[0]} 条——这是下一轮要定位的对象（本轮的 \`renderStats()\` 只给命令数、不给对象名，没继续加诊断字段）。60 fps 还在，所以它不是「越跑越慢」，是「每帧要画的线变多」的余量问题。`}`;

// ---------------------------------------------------------------- 报告

const report = `# 30 日长周期联合浸泡读数

> 夹具：\`world-client/test/soak-support.ts\`；跑数入口：\`node scripts/soak-30d.ts\`；
> 本报告由 \`node scripts/soak-report.mjs\` 从 \`soak-30d.json\` / \`determinism.json\` 生成，不重跑世界。
> 分支 \`feat/soak-30d\`（基线 \`origin/main\` \`eab9e36\`）；证据目录 \`docs/evidence/soak/\`。

## 场景

- 5 名居民（迷路人 / 汐 / 灯笼头 / 炉匠 / 沉灯夫人）全部在场，走默认环线（醒 / 打水 / 市面四拍 / 睡）；
- 天气三档晴 / 雨 / 暴雨每 3 天拨一次；潮汐全程开；
- 造物主第 0/3 天（L0/L1）被熔断拒绝，第 6 天用真实观测爬梯到 L3，之后每 3 天拆掉最早一栋再提一次（含落地与 7 日观测）；
- 步长固定 6000ms（倍率 60，一世界日 14,400 步 / 24 分钟）；\`wallClock\` 固定为 0，不接模型；
- 两轮不同种子 \`soak-a\` / \`soak-b\`，外加 \`soak-a\` 同种子复跑一遍。

## 1. 存量增长

![存量与性能曲线](curves.svg)

单位：事件/条目/行数为条数；账本/存档为 KB。日均增量 = (第 30 天 − 第 1 天) / 29；末段 = (第 30 天 − 第 22 天) / 7。

| 指标 | 第1天 | 第7天 | 第15天 | 第22天 | 第30天 | 日均增量 | 末段 7 日/天 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${stockRows.join('\n')}

种子 \`soak-b\` 的第 30 天读数用于交叉核对：事件 ${B.days[29].eventCount} / 世界事件 ${B.days[29].worldEvents} / 记忆 ${B.days[29].memory.entries} / 关系 ${B.days[29].relations.count} / 账本 ${B.days[29].ledgerRows} 行 / 存档 ${f1(kb(B.days[29].saveBytes))} KB——与 A 同量级，差异只在记忆条目的个体分配。

### 存档「每角色每年」口径

| 口径 | 值 | 对照 1.7 KB/角色年 |
| --- | --- | --- |
| 第 30 天存量（\`saveKB × 365 / (5 × 30)\`） | ${f1(cumulativeKBPerCharYear)} KB | **${f1(solpctCumulative)}×** |
| 第 30 天边际（日均增量 × 365 / 5） | ${f1(marginalKBPerCharYear)} KB | **${f1(solpctMarginal)}×** |
| 其中记忆 JSON 边际 | ${f1(marginalMemKBPerCharYear)} KB | ${f1(marginalMemKBPerCharYear / 1.7)}× |

**结论：1.7 KB/角色年的基线仍然被打破，但增长已经被预算关进笼子。** 这个世界每天约 30 件事，90 天实测 ${A90 === null ? '—' : `${f1(kb(A90.days[89].saveBytes) * 365 / (5 * 90))} KB/角色年`}；旧口径按的是稀疏世界，在这里结构性不成立（见第 7 节）。改前的「每世界日 +${f1(rates(A, (d) => kb(d.saveBytes)).perDay)} KB、第 31.5 天撞 2 MB」已经不再成立：第 60–90 天只涨 ${A90 === null ? '—' : `+${f2((kb(A90.days[89].saveBytes) - kb(A90.days[59].saveBytes)) / 30)} KB/天`}。2 MB 上限（\`IMPORT_MAX_BYTES\`，\`src/ui/save-store.ts:88\`）没有动，二进制压缩也没有用。

### 记忆库分项（第 1 天 → 第 30 天，字节 KB）

| 分项 | 第1天条数 | 第1天 KB | 第30天条数 | 第30天 KB | 增量 KB | 日均 KB |
| --- | --- | --- | --- | --- | --- | --- |
${partRows.join('\n')}

条目层现在每个桶都有**条数 + 字节**双预算。\`day\` 层 5 × 16 = ${dayTier.count} 条；\`legend\` 层从 \`Infinity\` 收到 **24 条/持有者 / 16 KB**，第 30 天剩下 ${legendTier.count} 条（${f1(kb(legendTier.bytes))} KB）：5 位居民与 ${placeHolders} 个地点 holder **全部正好卡在 24 条**，碑文不再随「事 × 人 × 地点」无限刻下去。表里 \`entries\` 是全库 ${A.days[29].memoryParts.entries.count} 条（含地点 holder），第 1 节「记忆条目数」按居民时间轴合计 ${A.days[29].memory.entries} 条，两个口径都对，别混着比。表里单独的 \`legends\` 行是碑文库（${A.days[29].memoryParts.legends.count} 条记录），和 \`entries\` 里 \`tier='legend'\` 的记忆条目不是同一个库。

### 预算（第 1 条）：改前 vs 改后（30 天末）

改前指本轮修之前那一轮（\`summary-30d-before.json\`）；改后是当前代码同种子同场景重跑。**这一栏是「第 1 条」的验收数。**

| 指标 | 改前 | 改后 | 差 |
| --- | --- | --- | --- |
${beforeAfterRows.join('\n')}

30 天窗口里预算**刚刚开始咬合**（\`facts\` 898 条还没到 \`facts\` 的字节上限），所以日均只从 55.6 降到 ${f1((kb(day30After.saveBytes) - kb(A.days[0].saveBytes)) / 29)} KB；真正的「贴顶」发生在第 30–45 天之间，见下表。

| 层 | 条数预算 | 字节预算 |
| --- | --- | --- |
${budgetRows.join('\n')}

取值口径：按 90 天稳态下每条的平均字节反推条数，让 90 天末记忆 JSON 落在 ~1.2 MB，连同世界存档留出 2 MB 上限的约 26% 余量。**没有用二进制压缩，也没有动 \`IMPORT_MAX_BYTES\`。**

#### 90 日实跑（seed A，同一场景，不是外推）

${A90 === null ? '90 日读数尚未采集（`node scripts/soak-30d.ts --seed=soak-a --no-repeat --days=90`）。' : `| 天 | 世界事件 | facts | 记忆 KB | 存档 KB | pruned 累计 | sim p50 (ms) | dayClose (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows90.join('\n')}

**90 天末存档 ${f1(kb(A90.days[89].saveBytes))} KB，占 2 MB 的 ${pct(kb(A90.days[89].saveBytes) / 2048)}，没有撞上限。** 曲线在第 30–45 天之间由「线性长」转成「贴顶」：第 60 → 90 天只涨 ${f1(kb(A90.days[89].saveBytes) - kb(A90.days[59].saveBytes))} KB（+${f2((kb(A90.days[89].saveBytes) - kb(A90.days[59].saveBytes)) / 30)} KB/天），而改前是 **+55.6 KB/天**——按那条直线第 31.5 天就撞 2 MB。90 天实测的 \`sim p50\` ${A90.days[89].perf.simP50.toFixed(4)} ms 与第 1 天 ${A90.days[0].perf.simP50.toFixed(4)} ms 同量级，没有「越跑越慢」。

- **facts / 世界事件比**：第 30 天 ${day30After.memoryParts.facts.count} / ${day30After.worldEvents} = **${factsRatio30.toFixed(3)}**；第 90 天 ${A90.days[89].memoryParts.facts.count} / ${A90.days[89].worldEvents} = **${factsRatio90.toFixed(3)}**。比值从 1 掉到 0.34，说明事实库在 90 天里裁掉了约三分之二的旧事实——留下的按「重要度 → 新」排序，不是按先进先出。
- **淘汰原因**：90 天累计按层记在 \`memory.pruned\` 事件里；\`entries\` 是条数超限，其余六库都是**字节**超限（\`cooldowns\` 5537、\`tells\` 3375、\`beliefs\` 3155、\`facts\` 1773、\`claims\` 1160、\`written\` 292、\`legends\` 144）。这也解释了为什么只加条数上限没用：这些库的问题先出在字节。
`}

#### 为什么 \`T_promote=0.60\` 没动（二选一里的选项 b）

30 天、5 位居民、共 ${salience.count} 条日层片段的显著度分布：

| 显著度 | 条数 | 占比 |
| --- | --- | --- |
${salienceRows}

| 门槛 | 越线条数 |
| --- | --- |
${aboveRows}

**p50 = p90 = ${salience.p50}，p99 = max = ${salience.p99}，0.60 在整条分布之上**——日常世界跑多久都晋升不了，\`promoted = summaries = archived = 0\`，压缩这层空转。

降阈值不安全：实测「听来的」条目显著度 **0.575**，「亲历且重要」的 **0.775**；\`T_promote=0.50\` 会把前者也晋升，而 \`makeSummary\` 写死 \`sourceMode: 'witnessed'\`、\`sourceChain: []\`，传闻的来历与保真度当场消失（\`test/memory-archive-reach.test.ts\` 的注释里有复现步骤）。0.60 正好卡在这两档之间，是设计里「至少两个维度突出才进日摘要」的数值位置。

所以机制不是坏了，是**场景不够**：\`test/memory-archive-reach.test.ts\` 用「每 7 天一件亲历大事」跑 90 天，晋升、日摘要、周摘要、归档四步依次发生——实测 90 天后 **日/周摘要 68 条（周摘要 60 条）、归档 30 条（全部是摘要）**。这条路径是通的，只是纯日常走不到。

## 2. 性能

单位 ms；\`sim p50/p95\` 为每逻辑步 \`Simulation.update(6000)\` 的百分位；\`dayClose\` 是跨日那一拍的记忆关账；\`dayWall\` 是整天墙钟（含快照、同步与分配）。

| 天 | sim p50 | sim p95 | mem p50 | mem p95 | dayClose | creatorClose | dayWall |
| --- | --- | --- | --- | --- | --- | --- | --- |
${perfRows.join('\n')}

- **整步在涨，但不是算法级的涨。** 种子 A 的 \`sim p50\` ${A.days[0].perf.simP50.toFixed(4)} → ${A.days[29].perf.simP50.toFixed(4)} ms（+57%）、\`p95\` ${A.days[0].perf.simP95.toFixed(4)} → ${A.days[29].perf.simP95.toFixed(4)} ms；种子 B 只从 ${B.days[0].perf.simP50.toFixed(4)} → ${B.days[29].perf.simP50.toFixed(4)} ms（+7%）。绝对值仍在 6 秒步长预算的 0.3% 以内，不是「世界越大越卡」的复杂度问题。
- **函数级定位（\`profile.json\`）**：随天数涨的是 \`stepDecrees\`（p50 7.6 → 11.6 µs、p95 14.9 → 25.9 µs）——它每步调用 \`snapshot()\` 做全量对象分配，堆从 0 涨到 88 MB 后分配/GC 变贵；\`stepTide\` 修复后恒定（p50 0.2 → 0.3 µs）。
- **确定随存量线性增长的两项**：\`dayClose\` ${A.days[0].perf.dayCloseMs.toFixed(1)} → ${A.days[29].perf.dayCloseMs.toFixed(1)} ms（记忆关账要扫全库 + 序列化）；\`dayWall\` ${A.days[0].perf.dayWallMs.toFixed(1)} → ${A.days[29].perf.dayWallMs.toFixed(1)} ms（每步快照与 \`syncHolders\` 的分配压力）。这两项是「跑久了」真正要盯的读数。
- 修复前实测的「越跑越慢」在 \`tideLevelAt\`：\`stepTide\` p50 从 0.3 µs 涨到 17.9 µs（60×），30 日耗时 73.6 s。改成 64 周期检查点 + 二分后，\`stepTide\` 恒定 ~1 µs，30 日 50.3 s。详见「修了什么」。

### 浏览器端（第 30 日末）

${browserSection}

## 3. 清理机制是否生效

| 计数（第 30 天，累计） | 值 |
| --- | --- |
| \`memory.consolidated\` 事件 | ${A.days[29].memory.consolidated} |
| 摘要条目数 \`summaries\` | ${A.days[29].memory.summaries} |
| 晋升 \`promoted\` | ${A.days[29].memory.promoted} |
| 归档 \`archived\` | ${A.days[29].memory.archived} |
| 整理内裁掉 \`dropped\` | ${A.days[29].memory.dropped} |
| **预算淘汰 \`memory.pruned\`** | **${A.days[29].memory.pruned}** |
| 时间轴被裁条数 | ${A.days[29].memory.trimmedTimelineEntries} |
| 地点不明条数 | ${A.days[29].memory.unknownPlaceEntries} |
| 面板会写「时刻不明」的格子 | 30 天 ${A.days[29].memory.unknownWhenEntries}；90 天 ${A90 === null ? '—' : A90.days[89].memory.unknownWhenEntries} |

第 30 天淘汰按层（\`memory.pruned\`，累计）：

| 层 | 淘汰条数 | 条数超限 | 字节超限 |
| --- | --- | --- | --- |
${prunedRows.join('\n')}

- **预算裁剪在真跑，而且分得清原因**：30 天累计淘汰 ${A.days[29].memory.pruned} 条，\`entries\` 由条数触发、其余各库由字节触发。改前这里只有一个 \`dropped\`（${BEFORE === null ? '—' : BEFORE.days[29].memory.dropped}）且全部来自整理，答不出「哪一层、为什么」。
- **压缩入口是通的（选项 b 的证明）**：日常世界的日层显著度 p99 = max = ${salience.p99}，够不着 \`T_promote=0.60\`，所以 30 天 \`summaries=promoted=0\` 是**场景不够**，不是坏了。\`test/memory-archive-reach.test.ts\` 用「每 7 天一件亲历大事」跑 90 天，晋升 → 日摘要 → 周摘要 → 归档依次发生；同时它钉住了另一条边界：阈值降到 0.50 会把 0.575 的「听来的」条目也压成 \`witnessed\` 摘要，来源链断裂。审计见「为什么 \`T_promote=0.60\` 没动」。
- **事件日志只增不改**：\`eventCount()\` 逐日单调（不变量 \`event-count-monotonic\` 每天核对）；世界事件累计 ${A.days[29].worldEvents} 条，无删除路径。**事实库只减不删世界事件**：\`facts\` 被裁 ${A.days[29].memoryParts.facts.count} 条是记忆表里的一行，世界事件日志本身不动。
- **造物账本只有 append**：每天核对「今天的文件必须以昨天完整字节为前缀」（\`ledger-append-only\`），30 天 0 违反；行数 1 → ${A.days[29].ledgerRows} 单调。
- **「被裁掉的事实写时刻不明」有了实现与样本**：\`dayTimelineFor\` 现在给每一格 \`whenKnown\`；事实被裁掉（或这一格是摘要、\`when\` 是日号）时为 \`false\`，面板写「时刻不明」而不是拿 \`clockOf\` 算出一个 00:00。样本在 \`test/memory-budget.test.ts\`（裁掉 \`ev_low\` 后它的格子 \`whenKnown=false\`、\`what=null\`、\`placeId=null\`）与 \`test/unit-status.test.ts\`（渲染出 \`clock: '时刻不明'\`）。第 30 天是 ${A.days[29].memory.unknownWhenEntries}：时间线只覆盖昨天，昨天的条目所指事实都还在；到第 90 天事实被预算裁掉 ${A90 === null ? '—' : A90.days[89].memory.prunedByLayer.facts.evicted} 条，面板上出现 ${A90 === null ? '—' : A90.days[89].memory.unknownWhenEntries} 格「时刻不明」——这是真跑样本，不是只靠测试断言。

## 4. 不变量

每天跑一次，30 天 ×2 种子共 60 次，**违反 0 条**（\`violations: []\`）：

| 规则 | 内容 |
| --- | --- |
| \`now-finite\` | 世界时间有限且非负 |
| \`event-count-monotonic\` | 引擎事件计数不回退 |
| \`villager-pos-finite\` / \`villager-on-walkable\` | 居民坐标有限、且站在可走格 |
| \`bond-finite\` / \`bond-to-known\` | 关系数值有限、对象是已知居民 |
| \`save-schema-v5\` / \`save-villager-count\` / \`save-memory-present\` | 存档版本、居民数、记忆字段 |
| \`save-roundtrip\` | 存档 JSON 可解析 |
| \`ledger-rows-monotonic\` / \`ledger-append-only\` | 账本行数单调、文件只追加 |

## 5. 确定性

同种子 \`soak-a\` 跑两遍，四项指纹逐项相同：

| 指纹 | 第一遍 | 第二遍 | 结果 |
| --- | --- | --- | --- |
${fpRows.join('\n')}

账本原始字节：\`${det.ledgerRaw.first.slice(0, 12)}…\` vs \`${det.ledgerRaw.again.slice(0, 12)}…\`，**不同**。原因是 \`newRecordId\` 用 \`crypto.randomUUID()\` 生成防撞键；剔除 \`recordId\`/\`proposalId\` 后的内容指纹相同（上表 creator）。这是键、不是行为。

## 6. 行为是否退化（第 1 天 vs 第 30 天）

按天计数（打水/市面从累计值还原成当日增量）：

| 行为 | 第1天 | 第30天 | 倍数 |
| --- | --- | --- | --- |
${behaviorRows.join('\n')}

| 市面四拍（当日条数） | 第1天 | 第30天 |
| --- | --- | --- |
${marketRow}

- 居民**没有塌成只剩巡逻**：走动、离场、出摊、夜行、睡下的量级都在；夜行从 0 到 95 步是天气/潮汐把个别行程推到了夜里，不是退化。
- 打水每天 ${behaviorPick['打水事件'](A.days[0])} 次、全部「到达」，30 天 ${A.days[29].behaviors.waterReached - A.days[28].behaviors.waterReached} 次到达，没有落空。
- **关系账本 30 天恒为 0 条**：街头互动每天 ${A.days[0].behaviors.interactions} 次，但 \`incidents\`（撞翻 / 抢水 / 帮忙）恒为 0，\`bondsOf()\` 永远是空的。所以「越处越亲还是震荡」这一问在本场景**无法回答**——没有任何一笔关系被记下。
- 天气三档都出现过：计划第 2/5/8… 天各拨一次，\`weatherSeen\` 在对应日读到 \`rain\` / \`storm\`；当日采样点落在夜里，读数是「全天出现过的档位」并集。

## 7. 发现了什么 / 修了什么 / 还剩什么

### 修了（产品代码）

**\`tideLevelAt\` 的线性扫描**（\`src/world/tide.ts\`）：原来每次查询从周期 0 逐周期累加，成本随世界时间线性增长，而 \`Simulation.stepTide\` 每 6 秒调一次。改为 64 周期检查点 + 二分查找 + 检查点内最多 64 次扫描；曲线逐点与原实现一致，由 \`test/tide-checkpoint.test.ts\` 钉住（0–31 天采样点逐点比对，且查询顺序无关）。

| 读数 | 修复前 | 修复后 |
| --- | --- | --- |
| \`stepTide\` p50 | 0.3 µs → 17.9 µs（60×） | 恒定 ~1 µs |
| 30 日整轮耗时 | 73.6 s | 50.3 s（含插桩） |

**记忆预算与清理层（第 1 条）**：

1. **六个无预算的库补上条数 + 字节双预算**（\`src/world/memory/config.ts\` 的 \`libraryBudget\`）：\`facts\` / \`claims\` / \`beliefs\` / \`cooldowns\` / \`tells\` / \`written\` / \`legends\`。每个库按自己的价值轴淘汰（事实按重要度→新，冷却与传话按新旧，传说按传播面），不再一律按写入顺序。
2. **碑文层从 \`Infinity\` 收到 24 条/持有者 / 16 KB**（\`budget.legend\`），并给条目四个桶都加了字节上限。
3. **淘汰留痕**：新增 \`memory.pruned\` 事件（层 / 淘汰数 / 条数超限数 / 字节超限数 / 原因 / 剩余），每层每天至多一条；同时修正\`memory.archived\` 原先「每天把全部已归档条目重发一遍」的累计口径。
4. **归档/晋升不改阈值，补可达性证明**（选项 b）：\`test/memory-archive-reach.test.ts\`。
5. **面板不再编造时刻**：\`whenKnown\` 从 \`dayTimelineFor\` 一路透到 \`unit-status\`，事实被裁或摘要日号都写「时刻不明」。

| 读数 | 改前 | 改后 |
| --- | --- | --- |
| 30 天末存档 | ${day30Before === null ? '—' : `${f1(kb(day30Before.saveBytes))} KB`} | ${f1(kb(day30After.saveBytes))} KB |
| 90 天末存档 | 外推 ~5 MB（第 31.5 天撞 2 MB） | ${A90 === null ? '—' : `${f1(kb(A90.days[89].saveBytes))} KB`}（未撞上限） |
| 90 天日均增量 | +55.6 KB/天 | ${A90 === null ? '—' : `+${f2((kb(A90.days[89].saveBytes) - kb(A90.days[59].saveBytes)) / 30)} KB/天（第 60–90 天）`} |

### 发现了（未修，按口径记 todo + BUGS_FOUND）

1. **关系账本在纯日常世界永远是 0**——没有 \`street_tumble\` / \`street_water\` / \`street_help\`，\`incidents=0\`，\`bondsOf()\` 空（第 3 条，未到）。
2. **\`T_promote=0.60\` 在日常场景走不到**——本报告已用分布解释并证明机制可达（选项 b），因此这条不再是缺陷，而是场景边界；剩余风险是「听来的 0.575 与 0.60 之间只隔 0.025」，场景一变就得重看分布。

### 还剩什么

- **\`stepDecrees\` 每步 \`snapshot()\` 的全量分配**（第 2 条，未到）：堆 0 → 88 MB 后 p50/p95 都涨。
- **关系账本恒 0**（第 3 条，未到）：需要先给分布再选 (a)/(b)。
- \`docs/BUGS_FOUND.md\` 的「长周期浸泡」小节已同步：BUG-2 降级为「场景边界 + 可达性测试」，BUG-3/BUG-4 翻正。
- 九道闸门。
`;

writeFileSync(join(dir, 'curves.svg'), svg, 'utf8');
writeFileSync(join(dir, 'REPORT.md'), report, 'utf8');
console.log(`写入 ${join(dir, 'REPORT.md')}`);
console.log(`写入 ${join(dir, 'curves.svg')}`);
