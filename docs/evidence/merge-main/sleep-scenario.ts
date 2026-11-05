import { DailyRun, DAY_MS } from '../../../world-client/test/func-daily-support.ts';

/**
 * 受控场景：起点 = 跨阈时刻（把「上次睡醒」拨到 1.6 天前），避开 05:20 的黎明复位。
 * 跑法（在 world-client 下）：
 *   node ../docs/evidence/merge-main/sleep-scenario.ts
 * 两跑输出逐字相同即视为可复现（读数见同目录 fingerprint.txt 第五节）。
 */
const run = new DailyRun({ withMemory: true, worldId: 'func-daily-l2' });
const sim = run.sim as unknown as {
  setLastRestAt(id: string, atMs: number): void;
  sleepReport(): { crossings: number; spans: { startedAtMs: number; fatigueAtStart: number }[] };
  fatigueOf(id: string): { fatigue: number; asleep: boolean; sleepy: boolean } | null;
};
const snapshot = (sim as unknown as { snapshot(): { villagers: { id: string; routine: string | null }[] } });
const id = snapshot.snapshot().villagers[0]!.id;
sim.setLastRestAt(id, -Math.round(1.6 * DAY_MS));

const out: string[] = [];
out.push(`startRoutine=${JSON.stringify(snapshot.snapshot().villagers[0]!.routine)}`);
run.runTo(6_000_000); // 睡中段（约 1.7 世界小时）
const mid = sim.fatigueOf(id)!;
out.push(`midAsleep=${mid.asleep} midFatigue=${mid.fatigue.toFixed(6)}`);
out.push(`midRoutine=${JSON.stringify(snapshot.snapshot().villagers[0]!.routine)}`);
run.runTo(17_400_000);
const justBeforeWake = sim.fatigueOf(id)!;
out.push(`beforeWakeAsleep=${justBeforeWake.asleep} fatigue=${justBeforeWake.fatigue.toFixed(6)}`);
run.runTo(17_500_000);
const after = sim.fatigueOf(id)!;
out.push(`afterWakeAsleep=${after.asleep} fatigue=${after.fatigue.toFixed(6)}`);
out.push(`afterWakeRoutine=${JSON.stringify(snapshot.snapshot().villagers[0]!.routine)}`);
out.push(`report=${JSON.stringify(sim.sleepReport())}`);
console.log(out.join('\n'));
