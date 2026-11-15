/**
 * 颜色换算与 CIEDE2000 的单一实现。
 *
 * 为什么要单列：2026-11 的初版阈值表用了一份“简化 ΔE2000”（漏了 a′ = a(1+G)
 * 与 C′/h′ 重算），把 ΔE 报小了。这里按 Sharma et al. (2005) 的步骤实现，
 * 并用该文两个标准样本自检；以后所有 ΔL/ΔE 读数都从这里出。
 */

const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));

export function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => clamp255(value).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToLab({ r, g, b }) {
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const f = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/** CIE L*a*b* → sRGB。超出 sRGB 域时由 clamp 截断，调用方应回算实际 Lab。 */
export function labToRgb({ L, a, b }) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (value) => {
    const cube = value ** 3;
    return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787;
  };
  const x = 0.95047 * inv(fx);
  const y = 1.00000 * inv(fy);
  const z = 1.08883 * inv(fz);
  const rgb = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.2040 * y + 1.0570 * z,
  ].map((value) => {
    const channel = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return clamp255(channel * 255);
  });
  return { r: rgb[0], g: rgb[1], b: rgb[2] };
}

/** CIEDE2000（kL = kC = kH = 1，Sharma 2005 完整式）。 */
export function deltaE2000(first, second) {
  const [L1, a1, b1] = [first.L, first.a, first.b];
  const [L2, a2, b2] = [second.L, second.a, second.b];
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    return angle < 0 ? angle + 360 : angle;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(((dhp / 2) * Math.PI) / 180);
  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH),
  );
}

/** Sharma, Wu & Dalal (2005) Table 1 的 34 对标准样本；容差 5e-4。 */
const REFERENCE_PAIRS = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
  [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0000],
  [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0000],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0009], 7.1792],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0010], 7.1792],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0011], 7.2195],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0012], 7.2195],
  [[50, -0.0010, 2.4900], [50, 0.0009, -2.4900], 4.8045],
  [[50, -0.0010, 2.4900], [50, 0.0010, -2.4900], 4.8045],
  [[50, -0.0010, 2.4900], [50, 0.0011, -2.4900], 4.7461],
  [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.9030],
  [[50, 2.5, 0], [58, 24, 15], 19.4535],
  [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0000],
  [[50, 2.5, 0], [50, 3.2972, 0], 1.0000],
  [[50, 2.5, 0], [50, 1.8634, 0.5757], 1.0000],
  [[50, 2.5, 0], [50, 3.2592, 0.3350], 1.0000],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.2480, -4.9620], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
  [[36.4612, 47.8580, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.4410], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082],
];

const asLab = ([L, a, b]) => ({ L, a, b });

/** 逐对返回 34 个标准样本的期望 / 实测 / 偏差。 */
export function referencePairResults() {
  return REFERENCE_PAIRS.map(([first, second, expected], index) => {
    const actual = deltaE2000(asLab(first), asLab(second));
    return { index: index + 1, first, second, expected, actual, delta: actual - expected };
  });
}

export function assertReferencePairs() {
  for (const result of referencePairResults()) {
    if (Math.abs(result.delta) > 5e-4) {
      throw new Error(
        `CIEDE2000 自检失败 #${result.index}：期望 ${result.expected}，实得 ${result.actual.toFixed(4)}`,
      );
    }
  }
}

// 直接运行本文件时打印 34 对判读，便于人工复核。
const isCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('de2000.mjs');
if (isCli) {
  for (const result of referencePairResults()) {
    const mark = Math.abs(result.delta) > 5e-4 ? 'FAIL' : 'ok';
    console.log(
      `#${String(result.index).padStart(2, '0')} 期望 ${result.expected.toFixed(4)} ` +
        `实测 ${result.actual.toFixed(4)} Δ ${result.delta >= 0 ? '+' : ''}${result.delta.toFixed(4)} ${mark}`,
    );
  }
}
