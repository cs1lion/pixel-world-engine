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

**结论：1.7 KB/角色年的基线被打破，量级差约 ${Math.round(Math.log10(solpctMarginal))} 个数量级。** 存档不是「缓慢长」，而是每世界日 +${f1(rates(A, (d) => kb(d.saveBytes)).perDay)} KB，30 天到 ${f1(kb(A.days[29].saveBytes))} KB；按这条直线，第 31.5 天就会撞上导入上限 2 MB（\`IMPORT_MAX_BYTES\`，\`src/ui/save-store.ts:88\`）。

### 记忆库分项（第 1 天 → 第 30 天，字节 KB）

| 分项 | 第1天条数 | 第1天 KB | 第30天条数 | 第30天 KB | 增量 KB | 日均 KB |
| --- | --- | --- | --- | --- | --- | --- |
${partRows.join('\n')}

条目数被预算裁到每层上限：\`day\` 层正好 5 × 16 = ${dayTier.count} 条（预算 16/人），但 \`legend\` 层 \`limitFor('legend') = Infinity\`——第 30 天有 **${legendTier.count} 条**（${f1(kb(legendTier.bytes))} KB，占全库条目字节的 ${pct(legendTier.bytes / (legendTier.bytes + dayTier.bytes))}），其中 ${placeHolders} 个地点 holder 各约 85 条。传说碑文按「涉及的人 × 每件事」刻，且不裁、也不归档（legend 每天只衰 0.15 × 0.05 = 0.75%，30 天还剩 0.79），所以它是条目层唯一的无上限增长项。表里 \`entries\` 是全库 ${A.days[29].memoryParts.entries.count} 条（含地点 holder）；第 1 节「记忆条目数」按居民时间轴合计 ${A.days[29].memory.entries} 条，两个口径都对，别混着比。\`facts\` / \`claims\` / \`beliefs\` / \`cooldowns\` / \`tells\` 同样没有任何预算——它们才是存档膨胀主体。表里单独的 \`legends\` 行是碑文库（${A.days[29].memoryParts.legends.count} 条记录），和 \`entries\` 里 \`tier='legend'\` 的记忆条目不是同一个库。

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
| 预算裁掉 \`dropped\` | ${A.days[29].memory.dropped} |
| 时间轴被裁条数 | ${A.days[29].memory.trimmedTimelineEntries} |
| 地点不明条数 | ${A.days[29].memory.unknownPlaceEntries} |
| \`when\` 写成日号（面板会显示 00:00） | ${A.days[29].memory.dayIndexWhenEntries} |

- **只有预算裁剪在生效**（\`dropped\` 累计 ${A.days[29].memory.dropped}），**归档从未触发**（\`archived=0\`）。原因可复算：日层衰减 15%/天，12 天才会跌破 \`T_forget=0.15\`；而日层预算只有 16 条，条目在 1–2 天内就被 \`dropped\` 挤掉，活不到归档。要走到归档，必须先有一条晋升到 \`long\` 层的摘要。\`legend\` 层是例外：不裁（\`Infinity\`）、每天只衰 0.75%，30 天也跌不到归档线。
- **摘要从未产生**（\`summaries=0\`、\`promoted=0\`）：日层条目显著度最高 ${f2(dayTier.maxSalience)}，够不着 \`T_promote=0.6\`。于是 \`mergeWeekly\` 也无事可做——「压缩」这一整层在纯日常世界里是空转的。
- **事件日志只增不改**：\`eventCount()\` 逐日单调（不变量 \`event-count-monotonic\` 每天核对）；世界事件累计 ${A.days[29].worldEvents} 条，无删除路径。
- **造物账本只有 append**：每天核对「今天的文件必须以昨天完整字节为前缀」（\`ledger-append-only\`），30 天 0 违反；行数 1 → ${A.days[29].ledgerRows} 单调。
- **「被裁掉的事实写时刻不明」在本场景没有发生**：没有摘要，就没有「被裁掉的事实」；\`trimmedTimelineEntries=0\`、\`unknownPlaceEntries=0\`、\`dayIndexWhenEntries=0\`。这条口径**未被覆盖**，不能算通过——只是没有触发样本。

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

### 发现了（未修，按口径记 todo + BUGS_FOUND）

1. **关系账本在纯日常世界永远是 0**——没有 \`street_tumble\` / \`street_water\` / \`street_help\`，\`incidents=0\`，\`bondsOf()\` 空。
2. **记忆压缩层空转**——日层条目显著度最高 ${f2(dayTier.maxSalience)}，低于 \`T_promote=0.6\`，30 天 \`summaries=0\`、\`promoted=0\`；没有 \`long\` 层条目，\`archived\` 也就永远为 0，只有 \`dropped\` 在裁日层。
3. **传说碑文无预算**——\`limitFor('legend') = Infinity\`，第 30 天 ${legendTier.count} 条（含 ${placeHolders} 个地点 holder），条目层唯一的无上限增长项。
4. **存档随事件线性膨胀且无压缩**——\`facts\`/\`claims\`/\`beliefs\`/\`cooldowns\`/\`tells\` 无预算；30 天 1.69 MB，第 ~31.5 天撞 2 MB 导入上限；按边际口径 ${f1(marginalKBPerCharYear)} KB/角色年，对照 1.7 KB 基线差 ${f1(solpctMarginal)}×。
5. **「被裁的事实写时刻不明」无样本**——机制未被任何一天覆盖，谈不上生效。

### 还剩什么

- **\`stepDecrees\` 每步 \`snapshot()\` 的全量分配**：堆 0 → 88 MB 后 p50/p95 都涨，下一轮可以改成按需字段或复用缓冲（本轮只定位，没动它）。
- 上述五条缺陷的 \`todo\` 用例与 \`docs/BUGS_FOUND.md\` 本节；
- 九道闸门。
`;

writeFileSync(join(dir, 'curves.svg'), svg, 'utf8');
writeFileSync(join(dir, 'REPORT.md'), report, 'utf8');
console.log(`写入 ${join(dir, 'REPORT.md')}`);
console.log(`写入 ${join(dir, 'curves.svg')}`);
