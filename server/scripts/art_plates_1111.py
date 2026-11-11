"""把 11-11 参考图集里剩下的 6 张构图稿切成「画册贴片」。

前一轮只切了本身规整、可当引擎小图的四张窗口图。剩下六张是整幅构图
（世界地图、桌面 UI 稿、村庄 2×2、学者区、tileset、角色动作表），
它们的价值在**构图与密度**，不是可抠底的独立物件，所以：

- 不抠底、不裁边：贴片是带背景的矩形画片（像邮票），保留整幅构图；
- 只做等分切格 + 等比缩到固定宽，纯确定性，不调模型；
- 落 `plate/*`，接在日历抽屉的周视图上当插图（见 `ui/daycard-panel.ts`）。

桌面 UI 设计稿只作构图基准，**不改现有 HUD**：落地它会动整个界面布局，
超出「美术素材」这一刀。取舍记在 `docs/adr/ADR_ART_REF_20261111.md`。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path("D:/project/pixel-world-engine")
ASSETS = ROOT / "world-client" / "public" / "assets"

#: (文件名, 列, 行, 只取前 N 格, 目标宽, id 前缀)
PLATES: tuple[tuple[str, int, int, int, int, str], ...] = (
    ("pixel-world-map-16x9.png", 2, 2, 4, 320, "map"),
    ("pixel-village-asset-sheet.png", 2, 2, 4, 320, "village"),
    ("pixel-world-engine-desktop-ui-mockup.jpg", 2, 1, 2, 320, "ui"),
    ("scholarly-zone-buildings.png", 1, 1, 1, 320, "scholarly"),
    ("pixel-tileset-props-sheet.png", 1, 1, 1, 320, "tileset"),
    ("villager-sprite-sheet.png", 1, 1, 1, 320, "cast"),
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=SOURCE)
    args = ap.parse_args()

    import sys
    sys.path.insert(0, str(ROOT / "server"))
    from art import pipeline  # noqa: E402

    written = 0
    for name, cols, rows, limit, width, prefix in PLATES:
        path = args.source / name
        if not path.is_file():
            print(f"缺图，跳过：{name}")
            continue
        with Image.open(path) as sheet_file:
            sheet = sheet_file.convert("RGBA")
        w, h = sheet.size
        cw, ch = w / cols, h / rows
        for index in range(min(cols * rows, limit)):
            col, row = index % cols, index // cols
            cell = sheet.crop((
                round(col * cw), round(row * ch),
                round((col + 1) * cw), round((row + 1) * ch),
            ))
            scale = width / cell.width
            cell = cell.resize((width, max(1, round(cell.height * scale))), Image.LANCZOS)
            art_id = f"{prefix}-{index:02d}"
            meta = {
                "source": "2026-11-11-reference-set",
                "sheet": name,
                "cell": {"col": col, "row": row, "cols": cols, "rows": rows},
                "origin": "deterministic plate; full rectangular crop, no keying, no model call",
            }
            pipeline.write_asset(ASSETS, "plate", art_id, cell, meta)
            written += 1
        print(f"[plate] {name}: {min(cols * rows, limit)} 张 -> {prefix}-*")
    print(f"plates: {written} 件")
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main())
