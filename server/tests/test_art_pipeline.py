from __future__ import annotations

import json

import pytest
from PIL import Image

from art import pipeline

MAGENTA = (255, 0, 255, 255)


def _scene() -> Image.Image:
    """洋红底，中间一块棕色，棕块里嵌一个洋红点。"""
    img = Image.new("RGBA", (40, 40), MAGENTA)
    for y in range(10, 30):
        for x in range(8, 32):
            img.putpixel((x, y), (120, 80, 40, 255))
    img.putpixel((20, 20), MAGENTA)
    return img


def test_泛洪只删与边相连的底色_主体内部不动():
    out = pipeline.key_out(_scene())
    assert out.getpixel((0, 0))[3] == 0
    assert out.getpixel((15, 15))[3] == 255
    # 主体包住的纯洋红点按约定也被清掉（洋红是保留键色，素材里不许出现），
    # 其余主体像素不动。
    assert out.getpixel((20, 20))[3] == 0
    assert out.getpixel((10, 12))[3] == 255


def test_底色不纯也能抠():
    img = _scene()
    for y in range(40):
        for x in range(40):
            if img.getpixel((x, y)) == MAGENTA:
                img.putpixel((x, y), (250 - x % 5, 4 + y % 5, 248, 255))
    out = pipeline.key_out(img)
    assert out.getpixel((0, 0))[3] == 0 and out.getpixel((39, 39))[3] == 0


def test_裁边后恰好是主体包围盒():
    out = pipeline.trim(pipeline.key_out(_scene()))
    assert out.size == (24, 20)


def test_全透明时抛错而不是产出空图():
    with pytest.raises(ValueError):
        pipeline.trim(Image.new("RGBA", (4, 4), (0, 0, 0, 0)))


def test_按占地宽度缩放到世界尺度():
    img = Image.new("RGBA", (500, 300), (1, 2, 3, 255))
    out = pipeline.fit_to_footprint(img, 4)
    assert out.width == 4 * pipeline.TILE_PX * pipeline.ART_SCALE


def test_清单按_id_排序且带_sha(tmp_path):
    img = Image.new("RGBA", (8, 8), (1, 2, 3, 255))
    pipeline.write_asset(tmp_path, "building", "b", img, {"prompt": "x"})
    pipeline.write_asset(tmp_path, "building", "a", img, {"prompt": "y"})
    m = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert list(m["assets"]) == ["building/a", "building/b"]
    assert len(m["assets"]["building/a"]["sha256"]) == 64
    assert m["artScale"] == pipeline.ART_SCALE


def test_只留最大连通块_去掉碎屑():
    img = Image.new("RGBA", (30, 10), (0, 0, 0, 0))
    for y in range(2, 8):
        for x in range(2, 12):
            img.putpixel((x, y), (9, 9, 9, 255))
    img.putpixel((25, 5), (9, 9, 9, 255))
    out = pipeline.trim(pipeline.keep_largest(img))
    assert out.size == (10, 6)


def test_脚下洋红地影被删_红灯笼不被删():
    img = Image.new("RGBA", (20, 20), MAGENTA)
    for y in range(4, 16):
        for x in range(4, 16):
            img.putpixel((x, y), (200, 40, 40, 255))  # 红灯笼
    for x in range(4, 16):
        img.putpixel((x, 17), (200, 60, 190, 255))  # 与底色有差距的洋红地影，但与边相连
    out = pipeline.key_out(img, tolerance=30)
    assert out.getpixel((8, 17))[3] == 0
    assert out.getpixel((8, 8))[3] == 255
