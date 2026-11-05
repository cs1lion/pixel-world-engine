"""回家取证的裁图读数：室内区域包围盒、唯一色数、调色板外色数。

只读 PNG。跑法（仓根下）：

    python world-client/scripts/homecoming-analyze.py

输出 `docs/evidence/homecoming/analysis.json`。
"""
import json
import os
from PIL import Image

SHOTS = "D:/project/pwe-material/docs/evidence/homecoming/shots"
OUT = "D:/project/pwe-material/docs/evidence/homecoming/analysis.json"

# 24 色世界 palette（`src/world/palette-data.ts` 的 WORLD），与内景读数同一份。
WORLD_PALETTE = {
    (0x14, 0x11, 0x0d), (0x1b, 0x21, 0x1c), (0x2d, 0x3b, 0x2e), (0x33, 0x42, 0x34),
    (0x3e, 0x43, 0x3f), (0x4a, 0x4f, 0x42), (0x3b, 0x34, 0x23), (0x8a, 0x5a, 0x44),
    (0x4a, 0x3f, 0x39), (0xc9, 0xa8, 0x6a), (0xe3, 0xa1, 0x3c), (0xe0, 0xb4, 0x8c),
    (0x30, 0x50, 0x6b), (0x22, 0x3a, 0x4d), (0xc0, 0x6a, 0x3e), (0xd8, 0xda, 0xd3),
    (0xc2, 0xb3, 0x9a), (0x9c, 0x4f, 0x3c), (0x5f, 0x8a, 0x74), (0x3d, 0x6b, 0x7a),
    (0x4e, 0x62, 0x41), (0x18, 0x24, 0x2b), (0xf2, 0xc8, 0x79), (0x5a, 0x46, 0x3e),
}
INK = (0x14, 0x11, 0x0d)
DEBUG_TOGGLE_BOX = (866, 0, 961, 60)


def content_bbox(im):
    """室内贴图在画布里的包围盒：暗场是纯 ink，房间一进来就整块不是 ink。"""
    px = im.load()
    w, h = im.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if px[x, y] == INK:
                continue
            if x < minx:
                minx = x
            if y < miny:
                miny = y
            if x > maxx:
                maxx = x
            if y > maxy:
                maxy = y
    if maxx < 0:
        return None
    return {"x": minx, "y": miny, "w": maxx - minx + 1, "h": maxy - miny + 1}


def colors_inside(im, box, exclude):
    px = im.load()
    colors = set()
    for y in range(box["y"], box["y"] + box["h"]):
        for x in range(box["x"], box["x"] + box["w"]):
            if exclude and exclude[0] <= x < exclude[2] and exclude[1] <= y < exclude[3]:
                continue
            colors.add(px[x, y])
    return sorted(colors)


def measure(name):
    im = Image.open(os.path.join(SHOTS, name)).convert("RGB")
    box = content_bbox(im)
    colors = colors_inside(im, box, DEBUG_TOGGLE_BOX)
    outside = [f"#{r:02x}{g:02x}{b:02x}" for (r, g, b) in colors if (r, g, b) not in WORLD_PALETTE]
    return {
        "file": name,
        "bbox": box,
        "uniqueColors": len(colors),
        "outsidePalette": outside,
        "colors": [f"#{r:02x}{g:02x}{b:02x}" for (r, g, b) in colors],
    }


report = {
    "paletteSize": len(WORLD_PALETTE),
    "debugToggleExcluded": DEBUG_TOGGLE_BOX,
    "interiorOccupied": measure("interior-occupied.png"),
    "streetNight": measure("street-night.png"),
}
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
print(json.dumps({
    "interiorBBox": report["interiorOccupied"]["bbox"],
    "interiorUniqueColors": report["interiorOccupied"]["uniqueColors"],
    "interiorOutsidePalette": report["interiorOccupied"]["outsidePalette"],
    "streetUniqueColors": report["streetNight"]["uniqueColors"],
}, ensure_ascii=False, indent=2))
