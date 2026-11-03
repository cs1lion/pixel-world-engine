import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAMP_STREET_LAMP_COUNT } from '../src/settings/dengchao/lamp-street.ts';
import {
  IGNITION_RAMP_MS,
  IGNITION_SPAN_MS,
  ignitionSchedule,
  ignitionStartOffsetMs,
  ignitionWorldMs,
  LAMP_MOTION_ON,
  lampBreathAt,
  lampBrightnessAt,
  lampIgnitionAt,
  lampSwayAt,
} from '../src/world/lamp-motion.ts';
import { minuteOfDay, TIMETABLE, type TimetableId } from '../src/world/timetable.ts';

/** 时刻表里某一拍的分钟数。测试不写死 1080 / 300，只认 id。 */
function beatMinute(id: TimetableId): number {
  const beat = TIMETABLE.find((item) => item.id === id);
  assert.ok(beat !== undefined, `时刻表应有 ${id}`);
  return beat.minuteOfDay;
}

/** 世界日的第 minute 分钟（第 0 天）。 */
function atMinute(minute: number): number {
  return minute * 60_000;
}

const ON = beatMinute('light_lamps');
const TOTAL = LAMP_STREET_LAMP_COUNT;

// ------------------------------------------------------------ 渐次点亮

test('渐次点亮：t = 点灯时刻时 0 盏，窗口走完时 28 盏', () => {
  assert.equal(lampIgnitionAt(atMinute(ON) - 1, 0, TOTAL, 'dusk'), 0, '点灯前一毫秒不亮');
  // 傍晚点灯前（强制相位把总闸说成「亮」）也必须是暗的：不能把下午算成「昨天点着的」。
  assert.equal(lampIgnitionAt(atMinute(ON - 60), 0, TOTAL, 'dusk'), 0, '17:00 不该已经亮着');
  assert.equal(lampIgnitionAt(atMinute(ON - 1), TOTAL - 1, TOTAL, 'dusk'), 0, '最后一盏更不该提前亮');
  const atOn = atMinute(ON);
  assert.equal(lampIgnitionAt(atOn, 0, TOTAL, 'dusk'), 0, '第一盏也要从这个时刻才起亮');
  assert.equal(lampIgnitionAt(atOn + IGNITION_RAMP_MS, 0, TOTAL, 'dusk'), 1);
  // 最后一盏的起点正好是窗口末端；起点前不亮，走完 ramp 才亮满。
  const last = TOTAL - 1;
  assert.equal(lampIgnitionAt(atOn + IGNITION_SPAN_MS - 1, last, TOTAL, 'dusk'), 0);
  assert.equal(lampIgnitionAt(atOn + IGNITION_SPAN_MS + IGNITION_RAMP_MS, last, TOTAL, 'dusk'), 1);
});

test('渐次点亮：第 1 盏与最后一盏的世界时刻相隔整个窗口', () => {
  const now = atMinute(ON);
  const first = ignitionWorldMs(now, 0, TOTAL);
  const last = ignitionWorldMs(now, TOTAL - 1, TOTAL);
  assert.equal(minuteOfDay(first), ON, '第一盏就在点灯那一拍');
  assert.equal(first, now);
  assert.equal(last - first, IGNITION_SPAN_MS, '首末相隔一个窗口（6 世界分钟）');
  assert.equal(minuteOfDay(last), ON + 6);
  // 顺序是单调的：后一盏不会早于前一盏。
  for (let i = 1; i < TOTAL; i += 1) {
    assert.ok(ignitionStartOffsetMs(i, TOTAL) > ignitionStartOffsetMs(i - 1, TOTAL));
  }
});

test('渐次点亮：亮满的盏数随时间单调增加，不会跳回', () => {
  let previous = -1;
  for (let minute = ON; minute <= ON + 8; minute += 1) {
    const schedule = ignitionSchedule(atMinute(minute), TOTAL, 'dusk');
    assert.ok(schedule.litAt >= previous, `${minute} 分时亮满盏数不该回落`);
    previous = schedule.litAt;
  }
  assert.equal(ignitionSchedule(atMinute(ON), TOTAL, 'dusk').litAt, 0);
  assert.equal(ignitionSchedule(atMinute(ON + 8), TOTAL, 'dusk').litAt, TOTAL);
});

test('渐次点亮：总闸说不亮时，28 盏一盏都不许亮', () => {
  for (const order of [0, 7, TOTAL - 1]) {
    assert.equal(lampIgnitionAt(atMinute(ON) + 60_000, order, TOTAL, 'noon'), 0);
  }
  const schedule = ignitionSchedule(atMinute(ON), TOTAL, 'noon');
  assert.equal(schedule.firstAtMs, null);
  assert.equal(schedule.lastAtMs, null);
});

test('渐次点亮：凌晨那段按「昨天已亮」给 1，不做假渐次', () => {
  // 05:00 收灯前（也就是 00:00–05:00）灯是从昨天亮过来的。
  assert.equal(lampIgnitionAt(atMinute(60), 0, TOTAL, 'night'), 1);
  assert.equal(lampIgnitionAt(atMinute(60), TOTAL - 1, TOTAL, 'night'), 1);
});

test('强制相位：世界钟离点灯窗口很远时，整条街按「早就亮过」给 1', () => {
  // `?time=night` 的回归截图里世界钟停在下午：不能因为「今天还没到 18:00」
  // 把整条街判成暗，否则夜街光带读数会跟着掉。
  assert.equal(lampIgnitionAt(atMinute(15 * 60), 0, TOTAL, 'dusk', false), 1);
  assert.equal(lampIgnitionAt(atMinute(15 * 60), TOTAL - 1, TOTAL, 'night', false), 1);
  // 但点灯窗口本身仍走渐次（证据脚本正是靠它按世界时刻钉帧）。
  assert.equal(lampIgnitionAt(atMinute(ON - 5), 0, TOTAL, 'dusk', false), 0, '窗口内第一盏还没点');
  assert.equal(lampIgnitionAt(atMinute(ON + 5), TOTAL - 1, TOTAL, 'dusk', false), 0, '窗口内最后一盏还没亮满');
});

// ------------------------------------------------------------ 呼吸 / 风摆

test('呼吸：四秒内会变，且始终落在 0.95–1.08 之间', () => {
  const samples = Array.from({ length: 40 }, (_, i) => lampBreathAt(atMinute(20) + i * 8_000, 3));
  assert.ok(Math.min(...samples) <= 0.95 + 1e-9, '低谷应到 0.95');
  assert.ok(Math.max(...samples) >= 1.08 - 1e-9, '高峰应到 1.08');
  assert.ok(samples.every((value) => value >= 0.95 && value <= 1.08));
  assert.ok(new Set(samples).size > 1, '呼吸必须真的在动');
});

test('风摆：幅度不超过 1px，悬挂灯多一个纵向抬升', () => {
  for (let i = 0; i < 20; i += 1) {
    const now = atMinute(20) + i * 7_000;
    const post = lampSwayAt(now, 4, false);
    assert.ok(Math.abs(post.dx) <= 1 && post.dy === 0, '灯柱只横向晃 1px');
    const hanging = lampSwayAt(now, 4, true);
    assert.ok(Math.abs(hanging.dx) <= 1 && Math.abs(hanging.dy) <= 1, '灯串横向纵向都 ≤1px');
  }
  // 不同相位确实摆到不同位置。
  const a = lampSwayAt(atMinute(20), 0, false);
  const b = lampSwayAt(atMinute(20), 9, false);
  assert.notDeepEqual(a, b);
});

// ------------------------------------------------------------ 确定性

test('确定性：同一个世界时刻必得同一帧的三个量', () => {
  const now = atMinute(ON + 3);
  for (const order of [0, 5, TOTAL - 1]) {
    assert.equal(
      lampBrightnessAt(now, order, TOTAL, 'dusk', true, LAMP_MOTION_ON),
      lampBrightnessAt(now, order, TOTAL, 'dusk', true, LAMP_MOTION_ON),
    );
    assert.deepEqual(lampSwayAt(now, order, false), lampSwayAt(now, order, false));
    assert.equal(lampBreathAt(now, order), lampBreathAt(now, order));
  }
});

test('开关：关掉哪一支，那一支就退成常量（其余两支不受影响）', () => {
  const allOff = { ignite: false, breathe: false, sway: false };
  // 渐次关掉 → 灯该整排亮（总闸亮时），亮度只剩呼吸。
  const now = atMinute(ON + 3);
  const ignited = lampBrightnessAt(now, 5, TOTAL, 'dusk', true, { ...allOff, ignite: false, breathe: true });
  assert.ok(ignited > 0, '关掉渐次后，点灯时刻起整排一起亮');
  // 呼吸关掉 → 亮度只剩渐次：取第 5 盏起亮半程的两个时刻，必须还在爬升。
  const half = atMinute(ON) + ignitionStartOffsetMs(5, TOTAL) + IGNITION_RAMP_MS / 2;
  const a = lampBrightnessAt(half, 5, TOTAL, 'dusk', true, { ...allOff, ignite: true, breathe: false });
  const b = lampBrightnessAt(half + 1_000, 5, TOTAL, 'dusk', true, { ...allOff, ignite: true, breathe: false });
  assert.ok(a > 0 && a < 1, '半程应处在 0 与 1 之间');
  assert.ok(b > a, '关掉呼吸后亮度只随渐次单调爬升，不会自己起伏');
});
