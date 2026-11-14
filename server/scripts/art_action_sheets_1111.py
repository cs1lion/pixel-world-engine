"""C 方案：七个村民各生成一张 4×6 语义动作表（每人一次模型调用）。

设计见 `docs/adr/ADR_ACTIONS_INTERACTION_20261112.md` 的 D1/D2。
纪律：**渲染接入点与消费点已先落地**（`world-client/src/render/action-frames.ts`
与 `villager.ts`），这里才生成帧；不许反过来先切一堆 PNG 再找地方挂。

每人一张整表（4 列 × 6 行、每格 96×120 纹理 px），引擎按帧名切格显示，
所以清单只 +7 件，不是 7×21 个小文件。

用法（server/ 下）：
    python scripts/art_action_sheets_1111.py --only v0
    python scripts/art_action_sheets_1111.py
"""

from __future__ import annotations

import argparse
import base64
import io
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from art import pipeline  # noqa: E402
import art_ref_1111 as base  # noqa: E402

ASSETS = ROOT / "world-client" / "public" / "assets"
REFS = ROOT / "tmp" / "art-ref"
RAW = ROOT / "tmp" / "art-action-raw"

CELL_W, CELL_H = 96, 120
COLS, ROWS = 4, 6

#: 六行的语义（与 `action-frames.ts` 的 ACTION_ROWS 逐行对齐）。第 1 行前两帧
#: 是空手赶路、后两帧是推车搬运；行 0 只有前三帧、行 3 只有前两帧。
ROW_PROMPT = (
    "ROW 1 (top): IDLE - three frames of the SAME character standing and breathing gently, "
    "then one EMPTY cell.\n"
    "ROW 2: WALK then CARRY - first two frames the character walking empty-handed, "
    "last two frames pushing or carrying a small wooden cart / crate.\n"
    "ROW 3: WORK - four frames hammering or working at a small bench, one frame with sparks.\n"
    "ROW 4: REST - two frames wiping sweat or resting with arms folded, then TWO EMPTY cells.\n"
    "ROW 5: POUR - four frames pouring water from a small bucket, one frame with a big splash.\n"
    "ROW 6 (bottom): CHEER - four frames raising both arms with golden sparkles, "
    "a happy open-mouth expression.\n"
)

STYLE = (
    "16-bit SNES-era pixel art, crisp hard square pixels, thin dark ink outline around every shape, "
    "flat fills with exactly one lighter side and one darker shadow step, simple chibi proportions "
    "about three heads tall, front-facing three-quarter view with the body angled about 20 degrees "
    "so both legs are separately readable (NOT a full side profile), "
    "warm autumn palette of weathered wood brown, terracotta, brass amber, moss green and dusk teal, "
    "no anti-aliasing, no blur, no text, no letters, no numbers, no watermark, no border, "
    "no ground shadow, no floor, no scenery, "
    "SOLID FLAT PURE MAGENTA (#FF00FF) background in EVERY cell including the empty ones"
)

GRID = (
    "LAYOUT: a STRICT evenly spaced grid of exactly 4 COLUMNS by 6 ROWS = 24 equal cells, "
    "thin faint dark separator lines are allowed but NO labels and NO panel frames. "
    "Each row is ONE action and each column is ONE animation frame of that action. "
    "The SAME single character, SAME scale, SAME outfit and SAME camera angle in EVERY non-empty cell, "
    "centered in its cell with generous empty magenta margin around it, "
    "nothing overlapping a neighbouring cell. "
)

#: 七人外观，与 `world-client/public/assets/villager/vN.png` 的生成描述同源。
CAST: tuple[tuple[str, str], ...] = (
    ("v0", "a young traveller girl with a brown ponytail, vermilion work tunic with a pale front panel, dark blue shorts, carrying a wooden water bucket"),
    ("v1", "a pale-robed boy with short dark hair, white and light-cyan robe with a blue sash, barefoot, holding a small paper lantern"),
    ("v2", "a tall narrow figure in a black hooded robe with a white featureless mask and dark purple eye slits, carrying a tall lamp pole"),
    ("v3", "a short stout elderly boiler keeper, bald with a white beard and round spectacles, dusty purple-grey work robe, holding a coal shovel"),
    ("v4", "a short wide matron with a tall white bun and a large nose, deep blue layered cloak with a gold sash, holding a folded fan"),
    ("v5", "a neat bookkeeper with short dark hair, dark charcoal long coat with copper trim, a leather satchel and an abacus"),
    ("v6", "a washerwoman with a dark brown ponytail, copper-brown dress with a pale apron, carrying a folded bundle of clean cloth"),
)

#: 每行的有效帧数（其余格必须为空）。与 ACTION_ROWS 一致。
VALID_FRAMES = (3, 4, 4, 2, 4, 4)


def data_uri(path: Path, max_side: int = 768) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def build_sheet(gen_png: bytes) -> tuple[Image.Image, list[int]]:
    """按 4×6 切格 → 每格单独抠底 → 等比装进 96×120 → 拼回整表。

    逐格抠底而不是整图泛洪：整图的洋红间隙会把所有格子连成一片，
    `keep_largest` 只会留下一个格。
    """
    sheet = Image.open(io.BytesIO(gen_png)).convert("RGBA")
    w, h = sheet.size
    out = Image.new("RGBA", (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
    counts: list[int] = []
    for row in range(ROWS):
        for col in range(COLS):
            # 约定为空的格（idle 第 4 格、rest 第 3/4 格）强制留空：
            # 模型爱在那里补一坨土堆或重复站姿，引擎虽不取，表却读不干净。
            if col >= VALID_FRAMES[row]:
                counts.append(0)
                continue
            cell = sheet.crop((
                round(col * w / COLS), round(row * h / ROWS),
                round((col + 1) * w / COLS), round((row + 1) * h / ROWS),
            ))
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
            out.alpha_composite(tile, (col * CELL_W, row * CELL_H))
            counts.append(1)
    return out, counts


def frame_diffs(sheet: Image.Image) -> dict[str, float]:
    """量每一行的帧间变化，分成「腿区」与「头区」。

    好看的走路必须**腿在动、头基本不动**。整块错位会让两区一起变，那读成抖动
    而不是抬脚——实测第一版就是这个问题（正面两帧、腿几乎不动、全身偏移）。
    """
    import numpy as np

    out: dict[str, float] = {}
    for row in range(ROWS):
        frames = VALID_FRAMES[row]
        if frames < 2:
            continue
        cells = []
        for col in range(frames):
            cell = sheet.crop((col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H))
            cells.append(np.asarray(cell).astype(int))
        leg = head = 0.0
        pairs = 0
        for a, b in zip(cells, cells[1:]):
            both = (a[:, :, 3] > 0) | (b[:, :, 3] > 0)
            d = np.abs(a[:, :, :3] - b[:, :, :3]).sum(axis=2) * both
            h = CELL_H
            leg += float(d[int(h * 0.55):, :].sum())
            head += float(d[int(h * 0.05):int(h * 0.40), :].sum())
            pairs += 1
        if pairs:
            out[str(row)] = leg / max(1.0, head)
    return out


def walk_reads_as_steps(sheet: Image.Image) -> tuple[bool, float]:
    """走路行的「腿动 / 头动」比值。小于 1.0 说明整块都在动，判不合格。"""
    ratio = frame_diffs(sheet).get("1", 0.0)
    return ratio >= 1.0, ratio


def quality_ok(gen_png: bytes, counts: list[int]) -> bool:
    """四角洋红 + 21 个约定有效格都有内容。

    空帧（idle 第 4 格、rest 第 3/4 格）不要求为空：模型常在空格里也画一个
    角色，而引擎只取每行前 N 帧，多出来的像素根本不会被显示，不必为此重试
    烧钱。硬判据是「该有的帧不能缺」。
    """
    im = Image.open(io.BytesIO(gen_png)).convert("RGB")
    w, h = im.size
    corners = [im.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    r, g, b = (sum(c[i] for c in corners) // 4 for i in range(3))
    if not (r > g + 30 and b > g + 18 and r > 70):
        return False
    for row in range(ROWS):
        for col in range(VALID_FRAMES[row]):
            if counts[row * COLS + col] != 1:
                return False
    return True


def generate_one(spec: tuple[str, str], refs: list[str]) -> tuple[str, Image.Image, dict]:
    art_id, desc = spec
    prompt = (
        f"A SINGLE 2D pixel-art RPG character action sprite sheet of ONE character: {desc}. "
        f"{GRID}{ROW_PROMPT}{STYLE}. "
        "Keep this character's outfit, hair and proportions IDENTICAL in all 21 non-empty cells; "
        "the five empty cells must be completely flat magenta with nothing in them."
    )
    RAW.mkdir(parents=True, exist_ok=True)
    best: tuple[int, Image.Image, dict] | None = None
    for attempt in range(3):
        gen = pipeline.generate(prompt, ref_urls=refs, ratio="3:4", size="1K", timeout=300)
        (RAW / f"{art_id}-{attempt}.png").write_bytes(gen.png)
        sheet, counts = build_sheet(gen.png)
        filled = sum(counts)
        steps_ok, leg_ratio = walk_reads_as_steps(sheet)
        ok = quality_ok(gen.png, counts) and steps_ok
        meta = {
            "prompt": prompt,
            "model": "agnes-image-2.5-flash",
            "sourceUrl": gen.url,
            "refs": [],
            "refFiles": ["villager-sprite-sheet.png", f"villager/{art_id}.png"],
            "origin": "2026-11-12 semantic-action-sheet (C: per-character)",
            "grid": [COLS, ROWS],
            "cell": [CELL_W, CELL_H],
            "filledCells": filled,
            "qualityOk": ok,
            "walkLegOverHead": round(leg_ratio, 2),
            "attempt": attempt,
        }
        score = (1 if ok else 0, filled)
        if best is None or score > best[0]:
            best = (score, sheet, meta)
        if ok:
            break
    assert best is not None
    _, sheet, meta = best
    return art_id, sheet, meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="逗号分隔，只生成这些 id，如 v0")
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    base.load_env()
    struct_ref = REFS / "villager-sprite-sheet.jpg"
    if not struct_ref.is_file():
        ap.error(f"结构锚点不存在：{struct_ref}")
    only = set(args.only.split(",")) if args.only else None
    todo = [s for s in CAST if only is None or s[0] in only]
    if not todo:
        ap.error("--only 没匹配到任何 id")

    ok = 0
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def refs_for(art_id: str) -> list[str]:
        portrait = ASSETS / "villager" / f"{art_id}.png"
        return [data_uri(struct_ref)] + ([data_uri(portrait, 512)] if portrait.is_file() else [])

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(generate_one, s, refs_for(s[0])): s[0] for s in todo}
        for fut in as_completed(futures):
            art_id = futures[fut]
            try:
                got_id, sheet, meta = fut.result()
                out = pipeline.write_asset(ASSETS, "action", got_id, sheet, meta)
                print(f"[action] {art_id} -> {out.relative_to(ROOT)}  {sheet.width}x{sheet.height}  "
                      f"filled={meta['filledCells']} ok={meta['qualityOk']} "
                      f"腿/头={meta['walkLegOverHead']} attempt={meta['attempt']}")
                ok += 1
            except Exception as exc:
                print(f"[action] {art_id} FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"action sheets: {ok}/{len(todo)} 张")
    return 0 if ok == len(todo) else 1


if __name__ == "__main__":
    raise SystemExit(main())
