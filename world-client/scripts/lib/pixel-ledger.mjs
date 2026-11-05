/**
 * 截图台账：每图一行 `file + 逐像素 sha256 + 尺寸 + 世界时刻 / 潮位 / 相机读数`。
 *
 * 为什么单独落盘：PNG 字节 sha256 会带编码器与元数据差异，跨进程不可比；逐像素
 * sha256 才是判据。两跑各写一份 `<name>-pixel-ledger.json`，外部逐条 `file` 对齐即可
 * 判「同场复跑是否真的逐像素相同」——这就是跨进程自证入口，不依赖脚本内的 run1/run2。
 *
 * 用法：在 `shot()` 里 `recordShot({ file, pixel, now, tide, camera })`，
 * 脚本末尾 `writePixelLedger(OUT, 'scene-motion')`。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rows = [];

/** 逐像素 sha256 + 尺寸；PNG 字节 hash 不作判据。 */
export async function hashImage(page, buf) {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', data);
    return {
      sha256: Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      width: canvas.width,
      height: canvas.height,
    };
  }, `data:image/png;base64,${buf.toString('base64')}`);
}

/** pixel：`pixelHash()` 的返回（{ sha256, width, height }）。 */
export function recordShot({ file, pixel, now = null, tide = null, camera = null }) {
  rows.push({
    file: file.split(/[\\/]/).pop(),
    sha256: pixel.sha256,
    size: `${pixel.width}x${pixel.height}`,
    now,
    tide,
    camera,
  });
}

export function writePixelLedger(outDir, name) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}-pixel-ledger.json`);
  writeFileSync(file, `${JSON.stringify({ schema: 1, shots: rows }, null, 2)}\n`);
  return file;
}
