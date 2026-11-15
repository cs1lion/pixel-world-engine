"""批量生成灯潮界开局建筑的位图素材（A2 试点扩面）。

统一带正交视角约束，每栋按中文名与形制给差异化描述。
已生成过的 id 默认跳过，--force 可重生成。

**2026-11-10 实测教训**：参考页别用 p19（街市全景）——它把模型推向
"画一条街"，lamp_workshop 两度生成成整条斜视角街景；改用 p49（单栋红漆
建筑特写）才拿到单栋正交立面。描述也要短、明确写 EXACTLY ONE BUILDING /
no street / no ground，长描述里的多个元素会被理解成多栋楼。
见 docs/evidence/art-pipeline/。

    python scripts/gen_buildings_batch.py
    python scripts/gen_buildings_batch.py --only wave_house,ferry_station

产出走 `gen_asset.py` 的同一条管线（抠底 / 裁边 / 缩放 / 清单），不另立一套。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "world-client" / "public" / "assets" / "manifest.json"
REF_DIR = ROOT / "tmp" / "art-ref"
# 只用 p49（单栋红漆建筑特写）：p19 是街市全景，实测会把模型带偏成画一条街。
REFS = [REF_DIR / "ref-p49.png"]

ORTHO = (
    "STRICTLY FRONT ORTHOGRAPHIC ELEVATION flat 2D game sprite, "
    "NO perspective, NO three-quarter view, NO visible side wall, "
    "NO ground or floor plane, symmetric front-facing facade, "
    "in the painted bathhouse-town style of the reference images"
)

# id -> (占地宽(格), 中文描述)  宽度取自 pack.ts 的 prefab() 第三个参数
BUILDINGS: dict[str, tuple[float, str]] = {
    "wave_house": (7, "grand multi-storey bathhouse tower, layered tiled roofs, red lacquer pillars, "
                      "hanging lanterns, ornate central entrance, the town's landmark"),
    "ferry_station": (6, "old wooden ferry waiting station by the water, weathered timber posts, "
                         "flat tiled canopy, a bench and a route sign, quiet and worn"),
    "lamp_workshop": (4, "small lantern-maker workshop, open front with paper lanterns drying on racks, "
                         "warm light from inside, wood and plaster walls"),
    "boiler_annex": (4, "dark sooty boiler annex, low flat roof, iron chimney, charcoal-dark walls, "
                        "faint orange furnace glow through a small window"),
    "ledger_house": (4, "modest ledger keeper's house, dark timber gable roof, shuttered windows, "
                        "a paper notice board, restrained and orderly"),
    "lamp_archive": (4, "lamp archive hall, verdigris-copper gabled roof, tall lattice windows, "
                        "rows of scroll shelves visible inside, scholarly and calm"),
    "soot_forge": (4, "soot-black smith forge, flat roof, heavy wooden doors, a chimney with faint smoke, "
                       "forge embers glowing inside"),
    "waiting_shelter": (4, "small roadside waiting shelter, simple copper-tiled flat roof, open front "
                           "with two posts and a bench, no walls on the sides"),
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
    for ref in REFS:
        if not ref.is_file():
            ap.error(f"参考页不存在：{ref}（先跑设定集抽页）")

    targets = [k for k in BUILDINGS if (args.only is None or k in args.only.split(","))]
    if not targets:
        ap.error("--only 没匹配到任何 id")

    cmd_base = [sys.executable, str(Path(__file__).with_name("gen_asset.py")), "building"]
    done: list[str] = []
    for key in targets:
        if not args.force and f"building/{key}" in existing:
            print(f"跳过 {key}（已存在，--force 可重生成）")
            continue
        width, desc = BUILDINGS[key]
        cmd = cmd_base + [key, "--width", str(width), "--desc", f"{desc}, {ORTHO}"]
        for ref in REFS:
            cmd += ["--ref-file", str(ref)]
        print(f"生成 {key} (宽 {width} 格) ...", flush=True)
        result = subprocess.run(cmd, cwd=str(Path(__file__).parent))
        if result.returncode != 0:
            print(f"失败：{key}（exit {result.returncode}）", file=sys.stderr)
            return result.returncode
        done.append(key)

    print(f"完成 {len(done)} 件：{', '.join(done) if done else '（无新增）'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
