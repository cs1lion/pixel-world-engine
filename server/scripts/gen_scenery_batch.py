"""批量生成灯潮界设定集布景的位图素材。

覆盖 scene-artbook.ts 里的 7 个绘制函数：
  bathhouse_main（叠浪楼正立面）、shopfront_gable（山墙店面）、
  boiler（炉底）、far_tower（对岸钟塔）、far_ridge（对岸屋脊）、
  quay（渡口）、coal_heap（煤堆）。

每件用对应的设定集参考页 + 正交约束。已生成过的 id 默认跳过，--force 可重生成。

    python scripts/gen_scenery_batch.py
    python scripts/gen_scenery_batch.py --only bathhouse_main,shopfront_gable
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "world-client" / "public" / "assets" / "manifest.json"
REF_DIR = ROOT / "tmp" / "art-ref"

# id -> (逻辑像素宽, 描述, 参考页列表)
# 宽度取自各 draw 函数的包围盒计算
SCENERY: dict[str, tuple[float, str, list[str]]] = {
    "bathhouse_main": (
        166,
        "grand multi-storey Japanese bathhouse facade, layered copper-green tiled roofs with upturned eaves, "
        "red lacquer pillars and railings, rows of warm-lit lattice windows, ornate central entrance with "
        "curved gable and hanging lanterns, a tall brick chimney on the right, a vertical banner on the left, "
        "EXACTLY ONE BUILDING ONLY",
        ["ref-p15.png", "ref-p39.png", "ref-p46.png"],
    ),
    "shopfront_gable": (
        64,
        "small Japanese shop front with curved plaster gable roof, round window at the apex, "
        "two vertical signboards, lattice door, red lanterns under the eaves, weathered plaster walls, "
        "EXACTLY ONE BUILDING ONLY",
        ["ref-p35.png", "ref-p40.png"],
    ),
    "boiler": (
        37,
        "small brick furnace with iron flue pipe and brick chimney, glowing orange fire inside, "
        "dark sooty walls, EXACTLY ONE STRUCTURE ONLY",
        ["ref-p48.png"],
    ),
    "far_tower": (
        26,
        "small distant clock tower silhouette, square tower body with clock face, pointed roof, "
        "two warm-lit windows, EXACTLY ONE TOWER ONLY",
        ["ref-p3.png"],
    ),
    "far_ridge": (
        992,
        "distant shoreline with continuous roof ridge line and low mountain silhouettes, "
        "a few warm-lit windows scattered along the ridge, dark water below, "
        "panoramic horizontal strip, NO foreground buildings",
        ["ref-p3.png", "ref-p41.png"],
    ),
    "quay": (
        80,
        "stone quay wall with stepped entrance to water, mooring posts with ropes, "
        "a waiting stone bench, moss in the cracks, EXACTLY ONE STRUCTURE ONLY",
        ["ref-p41.png"],
    ),
    "coal_heap": (
        33,
        "small pile of coal with a wooden bucket beside it, dark lumps stacked in layers, "
        "EXACTLY ONE PILE ONLY",
        ["ref-p48.png"],
    ),
}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="逗号分隔，只生成这些 id")
    ap.add_argument("--force", action="store_true", help="已存在也重生成")
    args = ap.parse_args()

    import json

    existing = set(json.loads(ASSETS.read_text(encoding="utf-8"))["assets"]) if ASSETS.exists() else set()
    targets = [k for k in SCENERY if (args.only is None or k in args.only.split(","))]
    if not targets:
        ap.error("--only 没匹配到任何 id")

    cmd_base = [sys.executable, str(Path(__file__).with_name("gen_asset.py")), "scenery"]
    done: list[str] = []
    for key in targets:
        if not args.force and f"scenery/{key}" in existing:
            print(f"跳过 {key}（已存在，--force 可重生成）")
            continue
        width, desc, ref_names = SCENERY[key]
        refs = [REF_DIR / r for r in ref_names]
        for ref in refs:
            if not ref.is_file():
                ap.error(f"参考页不存在：{ref}（先跑设定集抽页）")
        cmd = cmd_base + [key, "--width", str(width), "--desc", desc]
        for ref in refs:
            cmd += ["--ref-file", str(ref)]
        print(f"生成 {key} (宽 {width}px) ...", flush=True)
        result = subprocess.run(cmd, cwd=str(Path(__file__).parent))
        if result.returncode != 0:
            print(f"失败：{key}（exit {result.returncode}）", file=sys.stderr)
            return result.returncode
        done.append(key)

    print(f"完成 {len(done)} 件：{', '.join(done) if done else '（无新增）'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
