"""内景取证裁图的读数：房间包围盒、色数、冻结差、过渡中点差。

只读 PNG，不碰页面。跑法（仓根下）：

    python world-client/scripts/interior-analyze.py

输出 `docs/evidence/interior-view/analysis.json`，并把关键读数打到 stdout。
"""
import json
import os
from PIL import Image, ImageChops

SHOTS = "D:/project/pwe-material/docs/evidence/interior-view/shots"
OUT = "D:/project/pwe-material/docs/evidence/interior-view/analysis.json"

# 24 色世界 palette（`src/world/palette-data.ts` 的 WORLD）。
WORLD_PALETTE = {
    (0x14, 0x11, 0x0d), (0x1b, 0x21, 0x1c), (0x2d, 0x3b, 0x2e), (0x33, 0x42, 0x34),
    (0x3e, 0x43, 0x3f), (0x4a, 0x4f, 0x42), (0x3b, 0x34, 0x23), (0x8a, 0x5a, 0x44),
    (0x4a, 0x3f, 0x39), (0xc9, 0xa8, 0x6a), (0xe3, 0xa1, 0x3c), (0xe0, 0xb4, 0x8c),
    (0x30, 0x50, 0x6b), (0x22, 0x3a, 0x4d), (0xc0, 0x6a, 0x3e), (0xd8, 0xda, 0xd3),
    (0xc2, 0xb3, 0x9a), (0x9c, 0x4f, 0x3c), (0x5f, 0x8a, 0x74), (0x3d, 0x6b, 0x7a),
    (0x4e, 0x62, 0x41), (0x18, 0x24, 0x2b), (0xf2, 0xc8, 0x79), (0x5a, 0x46, 0x3e),
}
INK = (0x14, 0x11, 0x0d)
# `⚙ 调试` 按钮是 DOM，压在内景右上角（`#debug-toggle`）。它不是内景画的，
# 读数时按固定矩形剔掉，并在文里写明剔了哪一块。
DEBUG_TOGGLE_BOX = (866, 0, 961, 60)


def load(name):
    return Image.open(os.path.join(SHOTS, name)).convert("RGB")


def content_bbox(im):
    """房间贴图在画布里的包围盒：暗场是纯 ink，房间一进来就整块不是 ink。"""
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


def diff_stats(a, b, box=None):
    crop = (box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]) if box else None
    region_a = a.crop(crop) if crop else a
    region_b = b.crop(crop) if crop else b
    diff = ImageChops.difference(region_a, region_b)
    a_px = region_a.load()
    b_px = region_b.load()
    changed = 0
    for y in range(region_a.size[1]):
        for x in range(region_a.size[0]):
            if a_px[x, y] != b_px[x, y]:
                changed += 1
    return {"changedPixels": changed, "bbox": diff.getbbox(), "total": region_a.size[0] * region_a.size[1]}


def main():
    report = {}

    street = load("street.png")
    interior = load("interior.png")
    frozen_a = load("frozen-a.png")
    frozen_b = load("frozen-b.png")
    mid = load("transition-mid.png")
    after = load("street-after.png")

    box = content_bbox(interior)
    colors = colors_inside(interior, box, DEBUG_TOGGLE_BOX)
    outside = [f"#{r:02x}{g:02x}{b:02x}" for (r, g, b) in colors if (r, g, b) not in WORLD_PALETTE]

    report["size"] = {"width": interior.size[0], "height": interior.size[1]}
    report["interior"] = {
        "roomBBox": box,
        "excludedDomBox": DEBUG_TOGGLE_BOX,
        "uniqueColors": len(colors),
        "paletteColors": len(WORLD_PALETTE),
        "outsidePalette": outside,
    }
    # 冻结只比房间那一块：暗场之外没有内容，比整屏会混进边框。
    report["freeze"] = diff_stats(frozen_a, frozen_b, box)
    report["streetVsAfter"] = diff_stats(street, after)
    report["midVsInterior"] = diff_stats(mid, interior)
    report["midVsStreet"] = diff_stats(mid, street)
    report["streetVsInterior"] = diff_stats(street, interior)

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
