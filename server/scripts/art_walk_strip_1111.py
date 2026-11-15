"""只重画「走路」那一行：四帧步态条，合成回已有动作表的第 2 行。

为什么要单开一条产线：整表一次生成时，模型会把走路行画成侧面、还会把参考图里
的草帽少年画进来（实测 v0 就是这样跑偏的）。走路是最需要「四帧连贯」的一行，
把它单独生成、单独验收、再合成，才不会连累其它已经合格的行。

判据（客观）：
  1. 四格都必须有内容；
  2. 四角是洋红底（能被抠底）；
  3. **腿区变化明显大于头区**——整块错位会让两区一起变，读成抖动而不是抬脚。
合成后把「腿/头」比值写进清单，方便逐件复核。

用法（server/ 下）：
    python scripts/art_walk_strip_1111.py --only v0
    python scripts/art_walk_strip_1111.py
"""

from __future__ import annotations

import argparse
import base64
import io
import json
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
RAW = ROOT / "tmp" / "art-walk-raw"

CELL_W, CELL_H = 96, 120
COLS, ROWS = 4, 6
WALK_ROW = 1
WALK_FRAMES = 4

STYLE = (
    "16-bit SNES-era pixel art, crisp hard square pixels, thin dark ink outline around every shape, "
    "flat fills with exactly one lighter side and one darker shadow step, simple chibi proportions "
    "about three heads tall, warm autumn palette of weathered wood brown, terracotta, brass amber, "
    "moss green and dusk teal, no anti-aliasing, no blur, no text, no letters, no watermark, "
    "no border, no ground shadow, no floor, no scenery, "
    "SOLID FLAT PURE MAGENTA (#FF00FF) background in every cell"
)

PROMPT = (
    "A pixel-art WALK CYCLE STRIP of ONE character: {desc}. "
    "LAYOUT: exactly 4 columns by 1 row = 4 equal cells in a wide landscape strip, "
    "thin faint dark separator lines allowed, NO labels. "
    "The SAME character, SAME scale, SAME outfit, SAME head and hair in every cell, "
    "front-facing three-quarter view with the body angled about 20 degrees so BOTH legs read "
    "separately (NOT a side profile), centered in its cell with empty magenta margin, "
    "feet at the SAME baseline in every cell so the sprite does not jump vertically. "
    "THE FOUR FRAMES, left to right, are ONE continuous walking step: "
    "(1) CONTACT - front leg extended forward, foot flat, back leg trailing with heel lifted, arms widest; "
    "(2) DOWN - legs close together, body at its lowest point; "
    "(3) PASSING - the trailing leg swings through, knee bent, foot clearly LIFTED off the ground; "
    "(4) UP - that leg reaching forward, about to land. "
    "Across the four frames the legs must visibly SCISSOR and the arms must swing opposite to the legs. "
    "Anyone looking at these four frames must read 'taking steps'. "
    "The character must NOT be standing still, must NOT carry a cart, crate, box or any prop, "
    "must NOT hold a tool, must NOT wear a straw hat unless described. "
    "{style}"
)

CAST: dict[str, str] = {
    "v0": "a young traveller girl with a brown ponytail, vermilion work tunic with a pale front panel, dark blue shorts",
    "v1": "a pale-robed boy with short dark hair, white and light-cyan robe with a blue sash, barefoot",
    "v2": "a tall narrow figure in a black hooded robe with a white featureless mask and dark purple eye slits",
    "v3": "a short stout elderly boiler keeper, bald with a white beard and round spectacles, dusty purple-grey work robe",
    "v4": "a short wide matron with a tall white bun and a large nose, deep blue layered cloak with a gold sash",
    "v5": "a neat bookkeeper with short dark hair, dark charcoal long coat with copper trim",
    "v6": "a washerwoman with a dark brown ponytail, copper-brown dress with a pale apron",
}

VALID_FRAMES = (3, WALK_FRAMES, 4, 2, 4, 4)


def data_uri(path: Path, max_side: int = 768) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def leg_head_ratio(strip: Image.Image) -> float:
    """四帧之间：腿区变化 / 头区变化。≥1.2 才算「腿在动、头基本不动」。"""
    import numpy as np

    cells = []
    for i in range(WALK_FRAMES):
        cell = strip.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H))
        cells.append(np.asarray(cell).astype(int))
    leg = head = 0.0
    for a, b in zip(cells, cells[1:]):
        both = (a[:, :, 3] > 0) | (b[:, :, 3] > 0)
        d = np.abs(a[:, :, :3] - b[:, :, :3]).sum(axis=2) * both
        leg += float(d[int(CELL_H * 0.55):, :].sum())
        head += float(d[int(CELL_H * 0.05):int(CELL_H * 0.40), :].sum())
    return leg / max(1.0, head)


def build_strip(gen_png: bytes) -> tuple[Image.Image, list[int]]:
    sheet = Image.open(io.BytesIO(gen_png)).convert("RGBA")
    w, h = sheet.size
    out = Image.new("RGBA", (COLS * CELL_W, CELL_H), (0, 0, 0, 0))
    counts: list[int] = []
    for i in range(COLS):
        cell = sheet.crop((round(i * w / COLS), 0, round((i + 1) * w / COLS), h))
        keyed = base.key_out_magenta(cell)
        bbox = keyed.getchannel("A").getbbox()
        if bbox is None:
            counts.append(0)
            continue
        content = keyed.crop(bbox)
        scale = min(CELL_W / content.width, CELL_H / content.height)
        cw, ch = max(1, round(content.width * scale)), max(1, round(content.height * scale))
        content = content.resize((cw, ch), Image.LANCZOS)
        tile = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        tile.alpha_composite(content, ((CELL_W - cw) // 2, CELL_H - ch))
        out.alpha_composite(tile, (i * CELL_W, 0))
        counts.append(1)
    return out, counts


def corners_magenta(gen_png: bytes) -> bool:
    im = Image.open(io.BytesIO(gen_png)).convert("RGB")
    w, h = im.size
    cs = [im.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    r, g, b = (sum(c[i] for c in cs) // 4 for i in range(3))
    return r > g + 30 and b > g + 18 and r > 70


def one(art_id: str) -> tuple[str, bytes, Image.Image, dict, float]:
    """只算不写：manifest 必须由主线程串行写，并发写会把 JSON 撞坏（实测）。"""
    sheet_path = ASSETS / "action" / f"{art_id}.png"
    if not sheet_path.is_file():
        raise RuntimeError(f"没有动作表：{sheet_path}（先跑 art_action_sheets_1111.py）")
    refs = [data_uri(REFS / "villager-sprite-sheet.jpg"),
            data_uri(ASSETS / "villager" / f"{art_id}.png", 512)]
    prompt = PROMPT.format(desc=CAST[art_id], style=STYLE)
    best: tuple[tuple[int, float], bytes, Image.Image, list[int], int] | None = None
    for attempt in range(3):
        gen = pipeline.generate(prompt, ref_urls=refs, ratio="16:9", size="1K", timeout=300)
        RAW.mkdir(parents=True, exist_ok=True)
        (RAW / f"{art_id}-{attempt}.png").write_bytes(gen.png)
        strip, counts = build_strip(gen.png)
        ratio = leg_head_ratio(strip)
        filled = sum(counts)
        ok_bg = corners_magenta(gen.png)
        score = (1 if (filled == WALK_FRAMES and ok_bg and ratio >= 1.2) else 0, ratio)
        if best is None or score > best[0]:
            best = (score, gen.png, strip, counts, attempt)
        if score[0] == 1:
            break
    assert best is not None
    score, png, strip, counts, attempt = best
    ratio = leg_head_ratio(strip)

    # 合成回已有动作表的第 2 行（行号 1），其余行一个像素都不动。
    sheet = Image.open(sheet_path).convert("RGBA")
    sheet.paste(strip, (0, WALK_ROW * CELL_H))
    data = pipeline.png_bytes(sheet)
    patch = {
        "walkLegOverHead": round(ratio, 2),
        "walkFilledCells": sum(counts),
        "walkAttempt": attempt,
        "walkOrigin": "dedicated 4-frame walk strip, composited into row 2",
    }
    return art_id, data, sheet, patch, ratio


def write_one(art_id: str, data: bytes, sheet: Image.Image, patch: dict) -> dict:
    """主线程串行落盘：PNG + 清单一起写。清单并发写会把 JSON 撞坏（实测）。"""
    import hashlib

    (ASSETS / "action" / f"{art_id}.png").write_bytes(data)
    meta_path = ASSETS / "manifest.json"
    manifest = json.loads(meta_path.read_text(encoding="utf-8"))
    entry = manifest["assets"][f"action/{art_id}"]
    entry.update(patch)
    entry["width"], entry["height"] = sheet.width, sheet.height
    entry["sha256"] = hashlib.sha256(data).hexdigest()
    entry["bytes"] = len(data)
    meta_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + chr(10), encoding="utf-8"
    )
    return entry


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="逗号分隔，只重画这些 id")
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    base.load_env()
    only = set(args.only.split(",")) if args.only else None
    todo = [k for k in CAST if only is None or k in only]
    if not todo:
        ap.error("--only 没匹配到任何 id")

    ok = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(one, k): k for k in todo}
        for fut in as_completed(futures):
            art_id = futures[fut]
            try:
                got, data, sheet, patch, ratio = fut.result()
                entry = write_one(got, data, sheet, patch)
                print(f"[walk] {art_id} 腿/头={ratio:.2f}  "
                      f"filled={entry.get('walkFilledCells')} attempt={entry.get('walkAttempt')}")
                if ratio < 1.2:
                    print(f"  ! {art_id} 腿/头 < 1.2：抬脚可能仍然读不出来", file=sys.stderr)
                ok += 1
            except Exception as exc:
                print(f"[walk] {art_id} FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"walk strips: {ok}/{len(todo)}")
    return 0 if ok == len(todo) else 1


if __name__ == "__main__":
    raise SystemExit(main())
