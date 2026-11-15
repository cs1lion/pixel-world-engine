"""量位图素材到灯潮界 24 色的偏离（ADR_ART_PALETTE_DECISION 的复现脚本）。

    python scripts/audit_art_palette.py            # 打印
    python scripts/audit_art_palette.py --out ../docs/evidence/art-pipeline/color-deviation.json

只读，不改任何文件。距离 = RGB 欧氏距离；alpha <= 200 的像素不计（抠底抗锯齿边）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "world-client" / "public" / "assets"
PACK = ROOT / "world-client" / "src" / "settings" / "dengchao" / "pack.ts"


def world_palette() -> dict[str, tuple[int, int, int]]:
    text = PACK.read_text(encoding="utf-8")
    block = text[text.index("palette: {") : text.index("terrainColors:")]
    hexes = re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", block)
    return {name: tuple(int(h[i : i + 2], 16) for i in (1, 3, 5)) for name, h in hexes}  # type: ignore[misc]


def distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="把结果写进这个 JSON 文件")
    args = ap.parse_args()

    palette = world_palette()
    if len(palette) != 24:
        raise RuntimeError(f"设定集色板槽数应为 24，实际 {len(palette)}")
    base = list(palette.values())
    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))

    result: dict[str, object] = {
        "paletteSlots": len(palette),
        "method": "RGB 欧氏距离到最近 24 色槽；alpha<=200 不计",
        "assets": {},
    }
    rows: list[str] = []
    for key in manifest["assets"]:
        path = ASSETS / f"{key}.png"
        with Image.open(path) as im:
            rgba = im.convert("RGBA")
        raw = rgba.tobytes()
        pixels = [
            (raw[i], raw[i + 1], raw[i + 2])
            for i in range(0, len(raw), 4)
            if raw[i + 3] > 200
        ]
        if not pixels:
            continue
        devs = [min(distance(c, b) for b in base) for c in pixels]
        entry = {
            "uniqueColors": len(set(pixels)),
            "opaquePixels": len(pixels),
            "meanDistance": round(sum(devs) / len(devs), 2),
            "farOver40Ratio": round(sum(1 for d in devs if d > 40) / len(devs), 4),
        }
        result["assets"][key] = entry  # type: ignore[index]
        rows.append(
            f"{key:26s} {entry['uniqueColors']:>6} 色  "
            f"平均距离 {entry['meanDistance']:>6.2f}  >40 占 {entry['farOver40Ratio'] * 100:>5.1f}%"
        )

    print("\n".join(rows))
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
