"""按需生成一件素材：`python scripts/gen_asset.py building tea_stall --width 5 --desc "…"`。

产出写到 `world-client/public/assets/<kind>/<id>.png` 并更新 `manifest.json`。
需要 `server/.env` 里的 `IMAGE_API_KEY`；加 `--keep-raw` 把生图原图也存到 `tmp/art-raw/`
（不入库），便于调抠底参数。
`--ref URL` 传公网参考图，`--ref-file PATH` 传本机参考图（自动转 data URI，
例如从设定集 PDF 抽出的页）。用户已确认：设定集抽页可作风格锚点，不考虑版权。
"""

from __future__ import annotations

import argparse
import base64
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from art import pipeline  # noqa: E402
from oracle.env_file import load_env  # noqa: E402

ASSETS = ROOT / "world-client" / "public" / "assets"

KIND_PROMPT = {
    "building": (
        "single {desc}, front elevation view slightly from above, the whole building fully visible "
        "including roof, lit paper-lantern windows, wooden door, stone footing"
    ),
    "villager": (
        "single full-body {desc}, standing, facing front, three-quarter view, small chibi proportions "
        "(about 3 heads tall), simple readable costume, exactly one character only"
    ),
    "scenery": (
        "single {desc}, STRICTLY FRONT ORTHOGRAPHIC ELEVATION flat 2D game sprite, "
        "NO perspective, NO three-quarter view, NO visible side wall, "
        "NO ground or floor plane, NO people, NO other buildings, "
        "symmetric front-facing, solid empty background, "
        "in the painted bathhouse-town style of the reference images"
    ),
}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=sorted(KIND_PROMPT))
    ap.add_argument("asset_id")
    ap.add_argument("--desc", required=True, help="英文描述，写清楚它是什么")
    ap.add_argument("--width", type=float, help="building：占地宽度（格）")
    ap.add_argument("--height", type=int, help="villager：逻辑像素高度，默认 30")
    ap.add_argument("--ref", action="append", default=[], help="参考图 URL，可多次")
    ap.add_argument("--ref-file", action="append", default=[], help="本机参考图路径，可多次（转 data URI）")
    ap.add_argument("--keep-raw", action="store_true")
    args = ap.parse_args()

    load_env()
    # 本机参考图：压到长边 768 再转 data URI，避免整页 1MB 图直接塞进请求体。
    from PIL import Image

    refs = list(args.ref)
    ref_names: list[str] = []
    for raw_path in args.ref_file:
        path = Path(raw_path)
        if not path.is_file():
            ap.error(f"参考图不存在：{path}")
        with Image.open(path) as ref_im:
            ref_im = ref_im.convert("RGB")
            ref_im.thumbnail((768, 768), Image.LANCZOS)
            buf = io.BytesIO()
            ref_im.save(buf, "JPEG", quality=82)
        refs.append(f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}")
        ref_names.append(path.name)

    prompt = f"{KIND_PROMPT[args.kind].format(desc=args.desc)}, {pipeline.STYLE}"
    gen = pipeline.generate(prompt, ref_urls=refs or None)
    if args.keep_raw:
        raw = ROOT / "tmp" / "art-raw"
        raw.mkdir(parents=True, exist_ok=True)
        (raw / f"{args.kind}-{args.asset_id}.png").write_bytes(gen.png)

    from io import BytesIO

    img = pipeline.trim(pipeline.keep_largest(pipeline.key_out(Image.open(BytesIO(gen.png)))))
    if args.kind == "building":
        if args.width is None:
            ap.error("building 需要 --width")
        img = pipeline.fit_to_footprint(img, args.width, margin_tiles=0.25)
    elif args.kind == "scenery":
        if args.width is None:
            ap.error("scenery 需要 --width（逻辑像素宽）")
        # scenery 的包围盒不是格数，直接按逻辑像素宽缩放
        target_w = round(args.width * pipeline.ART_SCALE)
        scale = target_w / img.width
        img = img.resize((target_w, max(1, round(img.height * scale))), Image.LANCZOS)
    else:
        img = pipeline.fit_to_height(img, args.height or 30)
    out = pipeline.write_asset(
        ASSETS, args.kind, args.asset_id, img,
        {
            "prompt": prompt,
            "model": "agnes-image-2.5-flash",
            "sourceUrl": gen.url,
            "refs": args.ref,
            "refFiles": ref_names,
        },
    )
    print(f"已写入 {out.relative_to(ROOT)}  {img.width}x{img.height}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
