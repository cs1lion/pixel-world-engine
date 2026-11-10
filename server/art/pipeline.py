"""素材管线：生图模型 → 抠底 → 裁边 → 缩放到世界尺度 → 落盘 + 清单。

为什么是离线脚本、不是运行时调用：素材是**作品**，要进版本管理、要能评审、
要保证同一份存档在任何机器上画出同一个世界。运行时现生成会让画面每次不同，
也会把生图 Key 暴露给前端。所以这里的产出是 `world-client/public/assets/` 下
的 PNG 和一份 `manifest.json`（提示词、尺寸、sha256），渲染层只读它们。

纯函数部分（抠底 / 裁边 / 缩放）不联网，可单测；联网只在 `generate()`。
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

#: 素材纹理相对世界逻辑像素的倍率。世界 1 格 = 16 逻辑像素，素材 1 格 = 16*ART_SCALE 纹理像素。
#: 渲染层以 1/ART_SCALE 显示，所以画面清晰度取决于画布是否以 ≥ART_SCALE 的分辨率渲染。
ART_SCALE = 2
TILE_PX = 16

STYLE = (
    "hand-painted pixel art game asset, Studio Ghibli Spirited Away bathhouse-town mood, "
    "warm lantern light, dusk-teal and lacquer-red palette, weathered timber and tile, "
    "clean readable silhouette, crisp edges, no text, no watermark, no border, "
    "centered, solid flat pure magenta (#FF00FF) background with no gradient, no ground shadow, no floor, no cast shadow"
)


@dataclass(frozen=True)
class Generated:
    png: bytes
    url: str | None


def generate(
    prompt: str,
    *,
    ratio: str = "1:1",
    size: str = "1K",
    ref_urls: list[str] | None = None,
    timeout: float = 300.0,
) -> Generated:
    """调用 Agnes Image。Key 只从环境读，绝不进日志。"""
    import httpx

    key = os.environ.get("IMAGE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("未配置 IMAGE_API_KEY（写进 server/.env）")
    base = os.environ.get("IMAGE_BASE_URL", "https://api.agnes-ai.cn/v1").rstrip("/")
    model = os.environ.get("IMAGE_MODEL", "agnes-image-2.5-flash")
    extra: dict[str, Any] = {"response_format": "url"}
    if ref_urls:
        extra["image"] = ref_urls
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "ratio": ratio,
        "extra_body": extra,
    }
    r = httpx.post(
        f"{base}/images/generations",
        headers={"Authorization": f"Bearer {key}"},
        json=body,
        timeout=timeout,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"生图失败 {r.status_code}：{r.text[:200]}")
    item = r.json()["data"][0]
    if item.get("b64_json"):
        return Generated(base64.b64decode(item["b64_json"]), None)
    url = item["url"]
    # 图床偶发半截断开（实测 RemoteProtocolError），下载重试几次；生图本身不重试，那要花钱。
    last: Exception | None = None
    for _ in range(4):
        try:
            d = httpx.get(url, timeout=timeout)
            d.raise_for_status()
            return Generated(d.content, url)
        except httpx.HTTPError as exc:
            last = exc
    raise RuntimeError(f"下载生成图失败：{last}")


def _dist(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def key_out(img: Image.Image, tolerance: int = 90) -> Image.Image:
    """从四条边向内泛洪，把与底色相近的连通区域变透明。

    为什么泛洪而不是全图按颜色删：素材里可能有洋红色的灯笼边/布，全图删会挖洞；
    泛洪只删**与画布边相连**的底。底色取四角各通道的中位数——模型给的"纯洋红"并不纯。
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    corners = [px[0, 0][:3], px[w - 1, 0][:3], px[0, h - 1][:3], px[w - 1, h - 1][:3]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        r, g, b, _ = px[x, y]
        if _dist((r, g, b), bg) > tolerance:
            continue
        px[x, y] = (r, g, b, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    _drop_magenta(rgba)
    for _ in range(3):  # 洋红晕可能有几像素厚，逐圈剥
        _defringe(rgba)
    return rgba


def _drop_magenta(img: Image.Image) -> None:
    """模型常在脚下画一圈洋红色的"地影"，它与底色有差距、泛洪删不到。
    洋红 = 红蓝都高、绿明显更低；红灯笼蓝低、木色蓝低，不会误伤。"""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and r > 120 and b > 120 and g < min(r, b) - 60:
                px[x, y] = (0, 0, 0, 0)


def keep_largest(img: Image.Image) -> Image.Image:
    """只留 α>0 的最大连通块（8 邻域）。模型偶尔多画半个人/碎屑，裁边前先去掉。"""
    w, h = img.size
    a = img.getchannel("A").load()
    label = [[0] * w for _ in range(h)]
    sizes: dict[int, int] = {}
    n = 0
    for y0 in range(h):
        for x0 in range(w):
            if a[x0, y0] == 0 or label[y0][x0]:
                continue
            n += 1
            label[y0][x0] = n
            stack = [(x0, y0)]
            count = 0
            while stack:
                x, y = stack.pop()
                count += 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and a[nx, ny] and not label[ny][nx]:
                            label[ny][nx] = n
                            stack.append((nx, ny))
            sizes[n] = count
    if not sizes:
        return img
    best = max(sizes, key=lambda k: sizes[k])
    out = img.copy()
    px = out.load()
    for y in range(h):
        for x in range(w):
            if label[y][x] != best:
                px[x, y] = (0, 0, 0, 0)
    return out


def _defringe(img: Image.Image) -> None:
    """抠完后贴着透明区的一圈像素常带洋红晕：偏洋红的边缘像素直接去掉。"""
    w, h = img.size
    px = img.load()
    kill = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            touches = any(
                0 <= x + dx < w and 0 <= y + dy < h and px[x + dx, y + dy][3] == 0
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            if touches and r > g + 30 and b > g + 30 and r > 90 and b > 90:
                kill.append((x, y))
    for x, y in kill:
        px[x, y] = (0, 0, 0, 0)


def trim(img: Image.Image) -> Image.Image:
    box = img.getchannel("A").getbbox()
    if box is None:
        raise ValueError("抠底后整张图都是透明的：底色识别失败或模型没画出主体")
    return img.crop(box)


def fit_to_footprint(img: Image.Image, footprint_w_tiles: float, *, margin_tiles: float = 0.0) -> Image.Image:
    """按占地宽度缩放：主体宽 = (占地 + 2*margin) 格 * 16 * ART_SCALE 纹理像素。"""
    target_w = round((footprint_w_tiles + 2 * margin_tiles) * TILE_PX * ART_SCALE)
    scale = target_w / img.width
    target_h = max(1, round(img.height * scale))
    return img.resize((target_w, target_h), Image.LANCZOS)


def fit_to_height(img: Image.Image, height_px_logical: int) -> Image.Image:
    target_h = height_px_logical * ART_SCALE
    scale = target_h / img.height
    return img.resize((max(1, round(img.width * scale)), target_h), Image.LANCZOS)


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def write_asset(root: Path, kind: str, asset_id: str, img: Image.Image, meta: dict[str, Any]) -> Path:
    """落盘并更新清单。清单按 id 排序，保证重跑 diff 干净。"""
    out = root / kind / f"{asset_id}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    data = png_bytes(img)
    out.write_bytes(data)
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = {"artScale": ART_SCALE, "assets": {}}
    manifest["artScale"] = ART_SCALE
    manifest["assets"][f"{kind}/{asset_id}"] = {
        **meta,
        "width": img.width,
        "height": img.height,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
    }
    manifest["assets"] = dict(sorted(manifest["assets"].items()))
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out
