"""用 2026-11-11 根目录十张参考图优化美术：补素材 + 确定性切图。

两条产线，都只往 `world-client/public/assets/` 落小 PNG 并更新 `manifest.json`：

1. `villagers`：调 Agnes 生图，把 7 位村民立绘补齐（原先只有 v0/v1）。
   风格锚点是 `villager-sprite-sheet` 与 `agent-role-icon-sheet` 两张 11-11 参考图。
   沿用管线的洋红底约定，"缺什么调生图接口"只花在这七件上——参考图里
   没有逐人的正面立绘，切不出来。
2. `slices`：参考图里本来就是规整窗口的，直接按几何切格、抠底、裁边，**不调接口**。
   切出来的图是同一批参考图的像素，比让模型再画一遍更贴原稿、也更便宜。

参考图原图（4K / 5.5K，单张 14–30 MB）不入库：过不了 pre-push 的 5 MB blob 闸，
也不该把一张「示意图」当素材提交。脚本只读缩到长边 768 的 JPEG（在 `tmp/art-ref/`）。

用法（在 `server/` 下）：
    python scripts/art_ref_1111.py villagers --only v3
    python scripts/art_ref_1111.py slices
    python scripts/art_ref_1111.py all
"""

from __future__ import annotations

import argparse
import base64
import io
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from art import pipeline  # noqa: E402
from oracle.env_file import load_env  # noqa: E402

ASSETS = ROOT / "world-client" / "public" / "assets"
REFS = ROOT / "tmp" / "art-ref"
RAW = ROOT / "tmp" / "art-raw-1111"

STYLE_1111 = (
    "16-bit SNES-era pixel art, crisp hard square pixels, chunky readable silhouette, "
    "thin dark ink outline around every shape, flat fills with exactly one lighter side "
    "and one darker shadow step, warm autumn palette of weathered wood brown, terracotta, "
    "brass amber, moss green and dusk teal, simple chibi proportions about three heads tall, "
    "no anti-aliasing, no blur, no painterly shading, no text, no watermark, no border, "
    "no ground shadow, no floor, no cast shadow, no glow halo, no light bloom, "
    "centered, SOLID FLAT PURE MAGENTA (#FF00FF) background with no gradient"
)

#: 七位村民，顺序 = `world-client/src/settings/dengchao/pack.ts` 的 villagers 数组，
#: 也就是 `villager.id = v0..v6`。描述只写外形，不写身份（世界里的身份由设定集给）。
VILLAGERS: tuple[tuple[str, str], ...] = (
    ("v0", "a young traveller girl with a brown ponytail, vermilion work tunic with a pale front panel, dark blue shorts, carrying a wooden water bucket"),
    ("v1", "a pale-robed boy with short dark hair, white and light-cyan robe with a blue sash, barefoot, holding a small paper lantern"),
    ("v2", "a tall narrow figure in a black hooded robe with a white featureless mask and dark purple eye slits, carrying a tall lamp pole"),
    ("v3", "a short stout elderly boiler keeper, bald with a white beard and round spectacles, dusty purple-grey work robe, holding a coal shovel"),
    ("v4", "a short wide matron with a tall white bun and a large nose, deep blue layered cloak with a gold sash, holding a folded fan"),
    ("v5", "a neat bookkeeper with short dark hair, dark charcoal long coat with copper trim, a leather satchel and an abacus"),
    ("v6", "a washerwoman with a dark brown ponytail, copper-brown dress with a pale apron, carrying a folded bundle of clean cloth"),
)

#: 切图规格：(文件名, kind, 列数, 行数, 内缩比, 画布边长, id 前缀, 只取前 N 行, 抠底容差)
#: 内缩比是每格四周裁掉的比例，用来避开参考图里的细分隔线与邻格渗色。
#: 只切有消费方 / 明确语义的四张：
#:   工坊四态 -> 楼面板 activity 四态；祭坛三态 -> 状态素材库；
#:   角色与装备图标 -> 村民面板徽记；表情与 VFX -> 表情素材库。
#: 构图稿（世界地图 / 桌面 UI / 村庄 2x2 / 学者区 / tileset）不切：没有消费方，
#: 放在 docs/art/ 当作视觉基准，不给 manifest 添死素材。
#: 容差按张调：表情表的「黑云」格颜色离深底很近，用默认 58 会把它一起抠掉，
#: 这张单独收到 26；其余三张按默认 58。
DEFAULT_TOL = 58
GRIDS: tuple[tuple[str, str, int, int, float, int, str, int, int], ...] = (
    ("steampunk-coding-workshop-states.png", "state", 2, 2, 0.06, 256, "workshop", 2, DEFAULT_TOL),
    ("sacred-oracle-altar-states.png", "state", 3, 1, 0.08, 256, "altar", 1, DEFAULT_TOL),
    ("agent-role-icon-sheet.png", "icon", 5, 4, 0.05, 96, "role", 2, DEFAULT_TOL),
    ("pixel-ui-emote-vfx-sprite-sheet.png", "emote", 3, 4, 0.10, 96, "emote", 4, 26),
)

#: 十张原图所在目录。原图 4K/5.5K 单张 14–30 MB，不入库，只在本机读。
SOURCE_DIR = Path("D:/project/pixel-world-engine")


def ref_data_uri(path: Path) -> str:
    """本机参考图压到长边 768 再转 data URI（与 `gen_asset.py --ref-file` 同口径）。"""
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((768, 768), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def key_out_magenta(img: Image.Image, tolerance: int = 110) -> Image.Image:
    """针对 11-11 这批生图加强的抠底：底色常偏暗玫瑰紫，且带灯笼光晕与地影。

    三步，都在 `pipeline.key_out` 之后补做，不改原管线（原有 10 条单测不受影响）：
      1. 全图删「洋红族」像素（红蓝高、绿明显低）。底色与光晕都落在这一族；
         人物的肤色/木色/绿衣/橙灯光都不满足 `b > g + 18`，不会被误伤。
      2. 剥两圈边缘洋红晕。
      3. 只留最大连通块，去掉四角残留的碎斑。
    """
    rgba = pipeline.key_out(img, tolerance=tolerance)
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and r > g + 30 and b > g + 18 and r > 70 and b > 55:
                px[x, y] = (0, 0, 0, 0)
    for _ in range(2):
        pipeline._defringe(rgba)
    return pipeline.keep_largest(rgba)


def key_out_uniform(img: Image.Image, tolerance: int = 58) -> Image.Image:
    """切图用：参考图的格底是均匀深色/米色，从四条边泛洪删底色。"""
    return pipeline.keep_largest(pipeline.key_out(img, tolerance=tolerance))


def crop_cell(sheet: Image.Image, col: int, row: int, cols: int, rows: int, inset: float) -> Image.Image:
    """按等分网格切一格，四周内缩。纯函数，可单测。"""
    w, h = sheet.size
    cw, ch = w / cols, h / rows
    dx, dy = cw * inset, ch * inset
    box = (
        round(col * cw + dx), round(row * ch + dy),
        round((col + 1) * cw - dx), round((row + 1) * ch - dy),
    )
    return sheet.crop(box)


#: 小元素（火花、汗滴、烟）不能被硬拉到画布宽：原图里它们只占十几个像素，
#: 一拉就成了两个大方块。缩可以，放大最多这么多倍，然后居中贴进固定画布。
MAX_UPSCALE = 1.6


def fit_canvas(img: Image.Image, side: int) -> Image.Image:
    """等比缩放（最近邻，保硬像素边），不超倍放大，居中贴进 side×side 透明画布。"""
    scale = min(side / img.width, side / img.height, MAX_UPSCALE)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    scaled = img.resize((w, h), Image.NEAREST)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((side - w) // 2, (side - h) // 2))
    return canvas


def generate_one(spec: tuple[str, str], refs: list[str]) -> tuple[str, Image.Image, dict]:
    """只做联网与图像处理，**不写盘**：manifest 必须在主线程串行写，否则并发会互相覆盖。"""
    art_id, desc = spec
    prompt = (
        f"A SINGLE full-body chibi pixel-art RPG villager portrait, standing front-facing, "
        f"exactly one character only, {desc}. {STYLE_1111}"
    )
    gen = pipeline.generate(prompt, ref_urls=refs, timeout=300)
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / f"villager-{art_id}.png").write_bytes(gen.png)
    img = pipeline.trim(key_out_magenta(Image.open(io.BytesIO(gen.png))))
    img = pipeline.fit_to_height(img, 30)
    meta = {
        "prompt": prompt,
        "model": "agnes-image-2.5-flash",
        "sourceUrl": gen.url,
        "refs": [],
        "refFiles": ["villager-sprite-sheet.png", "agent-role-icon-sheet.png", "pixel-world-map-16x9.png"],
        "origin": "2026-11-11-reference-set",
    }
    return art_id, img, meta


def do_villagers(only: str | None, workers: int) -> int:
    load_env()
    refs = [ref_data_uri(REFS / name) for name in (
        "villager-sprite-sheet.jpg", "agent-role-icon-sheet.jpg", "pixel-world-map-16x9.jpg",
    )]
    todo = [s for s in VILLAGERS if only is None or s[0] == only]
    if not todo:
        raise SystemExit(f"--only 没匹配到任何村民：{only}")
    ok = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(generate_one, s, refs): s[0] for s in todo}
        for fut in as_completed(futures):
            art_id = futures[fut]
            try:
                got_id, img, meta = fut.result()
                out = pipeline.write_asset(ASSETS, "villager", got_id, img, meta)
                print(f"[villager] {art_id} -> {out.relative_to(ROOT)}  {img.width}x{img.height}")
                ok += 1
            except Exception as exc:  # 单件失败不拖垮整批，末尾按计数判失败
                print(f"[villager] {art_id} FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"villagers: {ok}/{len(todo)} 件")
    return 0 if ok == len(todo) else 1


def do_slices() -> int:
    src = SOURCE_DIR
    written = 0
    skipped: list[str] = []
    for name, kind, cols, rows, inset, side, prefix, row_limit, tol in GRIDS:
        path = src / name
        if not path.is_file():
            skipped.append(name)
            continue
        with Image.open(path) as sheet_file:
            sheet = sheet_file.convert("RGBA")
        for row in range(min(rows, row_limit)):
            for col in range(cols):
                cell = crop_cell(sheet, col, row, cols, rows, inset)
                keyed = key_out_uniform(cell, tolerance=tol)
                bbox = keyed.getchannel("A").getbbox()
                if bbox is None:
                    continue
                img = fit_canvas(keyed.crop(bbox), side)
                art_id = f"{prefix}-{col + row * cols:02d}"
                meta = {
                    "source": "2026-11-11-reference-set",
                    "sheet": name,
                    "cell": {"col": col, "row": row, "cols": cols, "rows": rows,
                             "inset": inset, "rowLimit": row_limit},
                    "keyTolerance": tol,
                    "canvas": side,
                    "origin": "deterministic slice; no model call",
                }
                pipeline.write_asset(ASSETS, kind, art_id, img, meta)
                written += 1
        print(f"[slice] {name}: {cols}x{min(rows, row_limit)} -> {prefix}-*")
    if skipped:
        print("参考图缺失（跳过）：" + ", ".join(skipped), file=sys.stderr)
    print(f"slices: {written} 件")
    return 0 if written > 0 else 1


def main() -> int:
    global SOURCE_DIR
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("villagers", "slices", "all"))
    ap.add_argument("--only", help="villagers：只生成某一件，如 v3")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--source", type=Path, default=SOURCE_DIR, help="十张原图所在目录")
    args = ap.parse_args()
    SOURCE_DIR = args.source
    rc = 0
    if args.mode in ("villagers", "all"):
        rc |= do_villagers(args.only, args.workers)
    if args.mode in ("slices", "all"):
        rc |= do_slices()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
