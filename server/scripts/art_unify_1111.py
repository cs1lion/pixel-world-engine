"""把 17 件旧建筑 / 布景素材统一到 2026-11-11 参考图集的硬像素风格。

起因：`docs/evidence/art-ref-1111/world-mix-compare.png` 的实拍显示，
七张新村民立绘是小型硬像素 chibi，旧建筑却是大幅水彩细节的浴场镇，
两套笔触与密度并排。村民这一层已经统一，剩下 17 件是最后一块。

沿用 `art_ref_1111.py` 的锚点、抠底与清单写入；差异只有三处：
  - 风格串去掉「chibi / full-body」（建筑不是人）；
  - 强写正交正面 + 单栋 + 无地面（`gen_buildings_batch.py` 记过斜视角坑）；
  - 按占地宽度 / 包围盒宽度缩放，与旧件同一套尺寸口径，构图不漂。

用法（server/ 下）：
    python scripts/art_unify_1111.py --only wave_house,tea_stall
    python scripts/art_unify_1111.py
"""

from __future__ import annotations

import argparse
import io
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from art import pipeline  # noqa: E402
import art_ref_1111 as base  # noqa: E402

ASSETS = ROOT / "world-client" / "public" / "assets"
REFS = ROOT / "tmp" / "art-ref"
RAW = ROOT / "tmp" / "art-raw-1111"

#: 与 `art_ref_1111.STYLE_1111` 同一套笔触与配色，去掉人物专属的体型约束，
#: 补上建筑必须的正交 / 单栋 / 无地面。模型偶尔把「多个元素」理解成多栋楼，
#: 所以这三条要放在最前面，再重复一次在末尾。
ORTHO = (
    "STRICTLY FRONT ORTHOGRAPHIC ELEVATION flat 2D game sprite, "
    "EXACTLY ONE BUILDING ONLY, NO perspective, NO three-quarter view, "
    "NO visible side wall, NO ground or floor plane, NO street, NO other buildings, "
    "symmetric front-facing facade, whole building fully visible including roof, "
    "centered in frame"
)
STYLE_BUILDING = (
    "16-bit SNES-era pixel art, crisp hard square pixels, chunky readable silhouette, "
    "thin dark ink outline around every shape, flat fills with exactly one lighter side "
    "and one darker shadow step, warm autumn palette of weathered wood brown, terracotta, "
    "brass amber, moss green and dusk teal, warm amber glow in the windows, "
    "no anti-aliasing, no blur, no painterly shading, no photographic detail, "
    "no text, no letters, no watermark, no border, no ground shadow, no cast shadow, "
    "SOLID FLAT PURE MAGENTA (#FF00FF) background with no gradient"
)

#: id -> (占地宽(格), 描述, 旧图宽高比)
#: 宽度来自 `gen_buildings_batch.py` 的 BUILDINGS（= pack.ts prefab 的第三参）；
#: 比例取自改动前 `manifest.json` 的 width/height，生成后记录偏差供复核。
BUILDINGS: dict[str, tuple[float, str, float]] = {
    "wave_house": (7, "a broad THREE-STOREY Japanese bathhouse with a WIDE horizontal facade filling "
                      "the frame, three stacked rows of warm-lit lattice windows, ONE large layered dark "
                      "tiled roof with upturned eaves, red lacquer pillars, hanging paper lanterns, "
                      "ornate central entrance; NOT a pagoda, NOT a tower, NOT stacked tiny roofs", 0.73),
    "ferry_station": (6, "old wooden ferry waiting station, weathered timber posts, flat tiled canopy, "
                         "a wooden bench and a blank route sign, quiet and worn", 1.22),
    "tea_stall": (5, "small tea stall shop with a flat tiled roof, red noren curtain, "
                     "a steaming kettle on the counter, hanging red paper lanterns", 1.57),
    "lamp_lodge": (5, "small lantern lodge inn with a verdigris-copper gabled roof, "
                      "glowing paper lanterns under the eaves, wooden lattice windows", 1.38),
    "lamp_workshop": (4, "small lantern-maker workshop, open front with paper lanterns drying on racks, "
                         "warm light from inside, plain wood and plaster walls", 1.32),
    "boiler_annex": (4, "dark sooty boiler annex, low flat roof, one iron chimney, "
                        "charcoal-dark wooden wall, one small glowing furnace window", 1.30),
    "ledger_house": (4, "modest ledger keeper's house, dark timber gable roof, shuttered windows, "
                        "a blank paper notice board, restrained and orderly", 1.26),
    "lamp_archive": (4, "lamp archive hall, verdigris-copper gabled roof, tall lattice windows, "
                        "rows of scroll shelves visible inside, scholarly and calm", 1.52),
    "soot_forge": (4, "soot-black smith forge, flat roof, heavy wooden doors, "
                      "one small chimney, faint orange forge glow in one window", 1.35),
    "waiting_shelter": (4, "small roadside waiting shelter, simple copper-tiled flat roof, "
                           "open front with two posts and a bench, no side walls, wide and low", 1.80),
}

#: 布景：id -> (逻辑像素宽, 描述, 旧图宽高比)
#: 宽度来自 `gen_scenery_batch.py`（= art-scenery.ts 各包围盒宽）。
SCENERY: dict[str, tuple[int, str, float]] = {
    "bathhouse_main": (166, "grand multi-storey bathhouse facade, layered copper-green tiled roofs "
                            "with upturned eaves, red lacquer pillars, rows of warm-lit lattice windows, "
                            "ornate central entrance with curved gable, hanging lanterns, "
                            "a tall brick chimney on the right", 0.87),
    "shopfront_gable": (64, "small shop front with a curved plaster gable roof, a round window at the "
                            "apex, two blank vertical signboards, lattice door, red lanterns under "
                            "the eaves, weathered plaster walls", 0.66),
    "boiler": (37, "small brick furnace with an iron flue pipe and brick chimney, "
                   "glowing orange fire inside, dark sooty walls", 0.56),
    "far_tower": (26, "small distant clock tower silhouette, square tower body with a clock face, "
                      "pointed roof, two warm-lit windows", 0.78),
    "quay": (80, "stone quay wall with stepped entrance to the water, mooring posts with ropes, "
                 "a waiting stone bench, moss in the cracks", 0.92),
    "coal_heap": (33, "a small LOW MOUND of chunky black coal lumps, rounded irregular black "
                      "rocks with a few grey highlights, a small wooden bucket beside the mound; "
                      "NO fence, NO planks, NO pallet, NO building, NO signboard", 2.44),
    "far_ridge": (992, "wide panoramic horizontal strip of a distant shoreline, continuous low roof "
                       "ridge line and dark mountain silhouettes, a few warm-lit windows scattered "
                       "along the ridge, dark water below, NO foreground buildings", 3.23),
}

#: 建筑与布景共用三张 11-11 图作锚点：村庄建筑形制、正交三栋、tileset 笔触。
#: 不用工坊四态图（斜视角，会把正交约束带偏，旧批次踩过同一个坑）。
ANCHORS = (
    "pixel-village-asset-sheet.jpg",
    "scholarly-zone-buildings.jpg",
    "pixel-tileset-props-sheet.jpg",
)


def build_prompt(desc: str, ratio: float, strict: bool = False) -> str:
    # 比例只作软提示：硬约束是正交与单栋。模型把「多层的地标」画成五层细塔
    #（实测 wave_house 比例 0.35 对旧图 0.73，渲染会被高度上限压成窄条），
    # 所以偏离过大时用 strict 版再画一次，把「不要塔」写成明确的形状约束。
    if ratio > 2.2:
        shape = "a very wide panoramic horizontal strip, much wider than tall"
    elif ratio > 1.5:
        shape = "wide and low, clearly wider than tall"
    elif ratio < 0.9:
        shape = ("broad and compact, roughly as wide as it is tall, "
                 "NOT a thin tower, NOT a pagoda, NOT a skinny spire")
    else:
        shape = "roughly four by three, slightly wider than tall"
    extra = (" Keep the building filling most of the frame width; only three storeys; "
             "do not stack many tiny floors. The ENTIRE canvas background must be flat pure "
             "magenta (#FF00FF) and NOTHING else: no ground, no floor, no wall, no scenery, "
             "no painted backdrop, no gradient. " if strict else " ")
    return (
        f"A SINGLE {desc}. {ORTHO}, overall silhouette {shape}.{extra}"
        f"{STYLE_BUILDING}. {ORTHO}"
    )


def normalize_to_target(img: Image.Image, target_w: int, target_h: int, *, cover: bool = False) -> Image.Image:
    """等比装进与旧件同尺寸的透明画布，主体完整保留、整体宽高比固定。

    为什么需要：模型给的比例随机（实测同一件能从 0.35 跳到 2.24），而引擎按
    占地宽度缩图、高度完全由图的长宽比决定。不归一化的话，细塔会被
    `artBuildingScale` 的高度上限压成窄条，宽横条又会矮成贴纸。

    `cover` 只给超宽条带（far_ridge）：按宽度铺满，超出高度居中裁掉，
    否则那条远景会缩成中间一小块。
    """
    w, h = img.size
    if cover:
        scale = target_w / w
        new_w = target_w
        new_h = max(1, round(h * scale))
    else:
        scale = min(target_w / w, target_h / h)
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
    scaled = img.resize((new_w, new_h), Image.LANCZOS)
    if cover and new_h > target_h:
        top = (new_h - target_h) // 2
        scaled = scaled.crop((0, top, target_w, top + target_h))
        new_h = target_h
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas


def background_ok(keyed: Image.Image, limit: float = 0.72) -> bool:
    """底色质检：抠完应当「四角透明 + 主体只占中间一块」。

    实测失败模式：模型偶尔不画洋红底，改画一整片棕色实景（火堆 / 布景 / 地面），
    泛洪删不到它，裁边后整张都是不透明背景。看四角颜色不够稳（暗玫瑰紫也会被
    误判），直接看抠底结果的 alpha 分布更贴着这个失败模式。
    """
    alpha = keyed.getchannel("A")
    w, h = alpha.size
    corners = (alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)),
               alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1)))
    if any(c != 0 for c in corners):
        return False
    hist = alpha.histogram()
    opaque = sum(hist[1:])
    return opaque / (w * h) <= limit


def _one_try(kind: str, spec: tuple, refs: list[str], prompt: str, tag: str):
    art_id = spec[0]
    gen = pipeline.generate(prompt, ref_urls=refs, timeout=300)
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / f"unify-{kind}-{art_id}{tag}.png").write_bytes(gen.png)
    keyed = base.key_out_magenta(Image.open(io.BytesIO(gen.png)))
    # far_ridge 是铺满宽度的横向条带，主体占比天然高，别把它误判成实景底。
    ok = background_ok(keyed, limit=0.90 if spec[1][2] > 2.2 else 0.72)
    img = pipeline.trim(keyed)
    return gen, img, img.width / img.height, ok


def generate_one(kind: str, spec: tuple, refs: list[str]) -> tuple[str, Image.Image, dict, float]:
    art_id = spec[0]
    desc = spec[1][1]
    ratio = spec[1][2]
    strict_prompt = build_prompt(desc, ratio, strict=True)
    attempts = [
        ("", build_prompt(desc, ratio)),
        ("-strict", strict_prompt),
        # 第三次把底要求单独再喊一遍：模型偶尔会为了「画面好看」自己加布景底。
        ("-strict2", strict_prompt + " BACKGROUND = FLAT PURE MAGENTA ONLY. NO SCENERY BEHIND THE BUILDING."),
    ]
    best: tuple | None = None
    for tag, prompt in attempts:
        gen, img, raw_ratio, ok = _one_try(kind, spec, refs, prompt, tag)
        dev = raw_ratio / ratio
        # 排序先看底色合格，再看比例接近；合格的第一次就收，最多三次。
        score = (0 if ok else 1, abs(1 - dev))
        if best is None or score < best[0]:
            best = (score, gen, img, raw_ratio, ok, prompt, dev)
        if ok and abs(1 - dev) <= 0.35:
            break
    assert best is not None
    _, gen, img, raw_ratio, bg_ok, prompt, dev = best
    # 目标尺寸与改动前那件逐像素一致：建筑按占地宽 + 0.25 格边距，
    # 布景按包围盒逻辑宽 × ART_SCALE；高度由旧图比例反推。
    if kind == "building":
        target_w = round((spec[1][0] + 2 * 0.25) * pipeline.TILE_PX * pipeline.ART_SCALE)
    else:
        target_w = round(spec[1][0] * pipeline.ART_SCALE)
    target_h = round(target_w / ratio)
    img = normalize_to_target(img, target_w, target_h, cover=ratio > 2.2)
    meta = {
        "prompt": prompt,
        "model": "agnes-image-2.5-flash",
        "sourceUrl": gen.url,
        "refs": [],
        "refFiles": [n.replace(".jpg", ".png") for n in ANCHORS],
        "origin": "2026-11-11-reference-set-unify",
        "replaces": "painted bathhouse-town style (2026-11-10 batch)",
        "sourceAspect": round(ratio, 2),
        "generatedAspect": round(raw_ratio, 2),
        "normalizedTo": [target_w, target_h],
        "normalizeMode": "cover" if ratio > 2.2 else "contain",
        "backgroundOk": bg_ok,
    }
    return art_id, img, meta, dev


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="逗号分隔，只生成这些 id（建筑或布景）")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    base.load_env()
    refs = [base.ref_data_uri(REFS / name) for name in ANCHORS]
    only = set(args.only.split(",")) if args.only else None
    todo: list[tuple[str, tuple]] = []
    for key, spec in BUILDINGS.items():
        if only is None or key in only:
            todo.append(("building", (key, spec)))
    for key, spec in SCENERY.items():
        if only is None or key in only:
            todo.append(("scenery", (key, spec)))
    if not todo:
        ap.error("--only 没匹配到任何 id")

    ok, deviations = 0, []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(generate_one, kind, spec, refs): (kind, spec[0]) for kind, spec in todo}
        for fut in as_completed(futures):
            kind, art_id = futures[fut]
            try:
                got_id, img, meta, dev = fut.result()
                out = pipeline.write_asset(ASSETS, kind, got_id, img, meta)
                deviations.append((art_id, dev))
                print(f"[{kind}] {art_id} -> {out.relative_to(ROOT)}  {img.width}x{img.height}  ratio×{dev:.2f}")
                ok += 1
            except Exception as exc:
                print(f"[{kind}] {art_id} FAIL {type(exc).__name__}: {exc}", file=sys.stderr)

    if deviations:
        worst = sorted(deviations, key=lambda x: abs(1 - x[1]), reverse=True)[:5]
        print("比例偏差最大五件（生成 / 旧图）：" + ", ".join(f"{k}×{v:.2f}" for k, v in worst))
    print(f"unify: {ok}/{len(todo)} 件")
    return 0 if ok == len(todo) else 1


if __name__ == "__main__":
    raise SystemExit(main())
