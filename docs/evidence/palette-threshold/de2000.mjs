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

/** Sharma 2005 两个标准样本；容差 5e-4。 */
const REFERENCE_PAIRS = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
];

export function assertReferencePairs() {
  for (const [first, second, expected] of REFERENCE_PAIRS) {
    const actual = deltaE2000(
      { L: first[0], a: first[1], b: first[2] },
      { L: second[0], a: second[1], b: second[2] },
    );
    if (Math.abs(actual - expected) > 5e-4) {
      throw new Error(`CIEDE2000 自检失败：期望 ${expected}，实得 ${actual}`);
    }
  }
}
