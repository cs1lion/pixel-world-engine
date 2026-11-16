/**
 * 确定性 FNV-1a 64-bit 双通道十六进制指纹（同步纯函数，浏览器与 Node 通用）。
 *
 * 用于 Trajectory 状态指纹与回溯保真度自证：同形状输入必须得到同指纹。
 * 刻意不用 `Math.random()` / `Date.now()`——指纹要能跨进程（评测重放）逐字节一致。
 */
export function computeDeterministicFingerprint(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  let h1 = 0xdeadbeef ^ canonical.length;
  let h2 = 0x41c6ce57 ^ canonical.length;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
