#!/usr/bin/env node
/**
 * 动画表现力线的证据探针（只读，不写世界、不写存档）。
 *
 * 用法：
 *   node scripts/anim-express-probe.ts fingerprints [--steps=400]
 *   node scripts/anim-express-probe.ts frames [--beats=48]
 *
 * `fingerprints`：同一输入跑两遍，打印世界/记忆/造物三枚 sha256 与
 * 「两次是否逐字相同」。这一条是验收里「三枚指纹不变」的读数出口。
 *
 * `frames`：逐拍打印「这一拍用帧集第几帧」。`before` 列来自改造前就存在的
 * `animFrame(now, frameCount)`（那个函数在本次改造里保持原样，所以它仍然
 * 代表旧行为）；`after` 列来自 `villagerMotionPose`。两列逐拍并排，
 * 就是要求的「帧序列前后 diff」。
 */
import { TraceRuntime } from '../src/trace/runtime.ts';
import type { TraceInput } from '../src/trace/format.ts';
import {
  FRAME_MS,
  IDLE_FRAMES,
  MOTION_SEQUENCES,
  MotionTracker,
  WALK_FRAMES,
  animFrame,
  villagerMotionPose,
  villagerPose,
  type VillagerMode,
  type VillagerPose,
} from '../src/render/villager-frames.ts';
import { villagerLayout } from '../src/render/villager-layout.ts';
import { castFramePixels, framePixelDiff } from '../src/render/cast-motion.ts';
import { resolveLook } from '../src/world/villager-look.ts';

const argOf = (name: string, fallback: number): number => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (hit === undefined) return fallback;
  const value = Number(hit.slice(name.length + 3));
  return Number.isFinite(value) ? value : fallback;
};

function traceInput(steps: number): TraceInput {
  return {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description: '动画表现力线：三枚指纹基线',
    worldId: 'default',
    worldSeed: 'default',
    initialNow: 0,
    stepMs: 60_000,
    steps,
    eventRange: { from: 0, to: steps },
    injections: [],
    outer: { memory: true, creator: true },
  };
}

async function fingerprints(): Promise<void> {
  const steps = argOf('steps', 400);
  const runs: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    const runtime = new TraceRuntime(traceInput(steps));
    for (let index = 0; index < steps; index += 1) await runtime.step(60_000);
    runs.push(JSON.stringify(runtime.fingerprints()));
  }
  console.log(`steps=${steps}`);
  console.log(`run1=${runs[0]}`);
  console.log(`run2=${runs[1]}`);
  console.log(`identical=${runs[0] === runs[1]}`);
}

function frames(): void {
  const beats = argOf('beats', 48);
  const look = resolveLook(undefined);
  const rows: string[] = [];
  let walkDiff = 0;
  let workDiff = 0;
  let walkLayoutDiff = 0;
  let workLayoutDiff = 0;
  for (let beat = 0; beat < beats; beat += 1) {
    // 取每一拍中点，避开边界取整；与 `castFramePose` 的口径一致。
    const now = beat * FRAME_MS + FRAME_MS / 2;
    const walkBefore = animFrame(now, WALK_FRAMES);
    const workBefore = animFrame(now, IDLE_FRAMES);
    const walkAfter = villagerMotionPose('idle', true, now, null).frame;
    const workAfter = villagerMotionPose('working', false, now, null).frame;
    const walkOldPixels = castFramePixels(look, 'down', true, walkBefore);
    const walkNewPixels = castFramePixels(look, 'down', true, walkAfter);
    walkDiff += framePixelDiff(walkOldPixels, walkNewPixels);
    const workOldPixels = castFramePixels(look, 'down', false, workBefore);
    const workNewPixels = castFramePixels(look, 'down', false, workAfter);
    workDiff += framePixelDiff(workOldPixels, workNewPixels);
    // 渲染层像素差：把整套矩形按姿态的 offsetY 落到 24×30 网格上再比，
    // 这样「干活的关键姿势只靠 1px 起落」也会被算进去，不会假 0。
    const walkOldRaster = rasterOf(villagerPose('idle', true, now), true, 'idle', now, look);
    const walkNewRaster = rasterOf(villagerMotionPose('idle', true, now, null), true, 'idle', now, look);
    walkLayoutDiff += rasterDiff(walkOldRaster, walkNewRaster);
    const workOldRaster = rasterOf(villagerPose('working', false, now), false, 'working', now, look);
    const workNewRaster = rasterOf(villagerMotionPose('working', false, now, null), false, 'working', now, look);
    workLayoutDiff += rasterDiff(workOldRaster, workNewRaster);
    rows.push(
      JSON.stringify({
        beat,
        walkBefore,
        walkAfter,
        walkHold: walkAfter === (rows.length > 0 ? JSON.parse(rows[rows.length - 1] as string).walkAfter : -1),
        workBefore,
        workAfter,
        workHold: workAfter === (rows.length > 0 ? JSON.parse(rows[rows.length - 1] as string).workAfter : -1),
      }),
    );
  }
  console.log(rows.join('\n'));
  console.error(`# 循环段 hold 占比：walk ${holdRatio(beats, true)} / work ${holdRatio(beats, false)}`);
  console.error(`# 像素差（24×30，每拍累加）：walk ${walkDiff} / work ${workDiff}`);
  console.error(
    `# 渲染层像素差（含 offsetY 起落，24×30）：walk ${walkLayoutDiff} / work ${workLayoutDiff}`,
  );
  console.error(
    `# 关键姿势：walk 帧 ${MOTION_SEQUENCES.walk.keyFrame} 保持 ${MOTION_SEQUENCES.walk.keyHoldBeats} 拍；` +
      `work 帧 ${MOTION_SEQUENCES.work.keyFrame} 保持 ${MOTION_SEQUENCES.work.keyHoldBeats} 拍`,
  );

  // 脚本化一拍不落的过渡段：待机 8 拍 → 走 24 拍 → 待机 8 拍 → 干活 12 拍 → 待机 8 拍。
  // 这一段专门看预备/收招有没有真的出现在序列里。
  const schedule = [
    ...Array.from({ length: 8 }, () => [false, false] as const),
    ...Array.from({ length: 24 }, () => [true, false] as const),
    ...Array.from({ length: 8 }, () => [false, false] as const),
    ...Array.from({ length: 12 }, () => [false, true] as const),
    ...Array.from({ length: 8 }, () => [false, false] as const),
  ];
  const tracker = new MotionTracker();
  console.log('# scripted');
  for (let index = 0; index < schedule.length; index += 1) {
    const [walking, working] = schedule[index] as readonly [boolean, boolean];
    const sample = tracker.sample(working ? 'working' : 'idle', walking, index);
    console.log(
      JSON.stringify({
        beat: index,
        walking,
        working,
        frame: sample.frame,
        kind: sample.kind,
        phase: sample.phaseBeat,
        hold: sample.hold,
        keyPose: sample.keyPose,
      }),
    );
  }
}

function holdRatio(beats: number, walking: boolean): string {
  let holds = 0;
  let previous = -1;
  for (let beat = 0; beat < beats; beat += 1) {
    const now = beat * FRAME_MS + FRAME_MS / 2;
    const frame = walking
      ? villagerMotionPose('idle', true, now, null).frame
      : villagerMotionPose('working', false, now, null).frame;
    if (beat > 0 && frame === previous) holds += 1;
    previous = frame;
  }
  return `${holds}/${beats}`;
}

function rasterOf(
  pose: VillagerPose,
  walking: boolean,
  mode: VillagerMode,
  nowMs: number,
  look: ReturnType<typeof resolveLook>,
): Map<string, string> {
  const grid = new Map<string, string>();
  for (const rect of villagerLayout(look, 'down', pose, walking, mode, nowMs)) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) grid.set(`${x},${y}`, rect.paint);
    }
  }
  return grid;
}

function rasterDiff(a: Map<string, string>, b: Map<string, string>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let diff = 0;
  for (const key of keys) {
    if (a.get(key) !== b.get(key)) diff += 1;
  }
  return diff;
}

const command = process.argv[2];
if (command === 'fingerprints') {
  await fingerprints();
} else if (command === 'frames') {
  frames();
} else {
  console.error('用法：anim-express-probe.ts <fingerprints|frames>');
  process.exit(2);
}
