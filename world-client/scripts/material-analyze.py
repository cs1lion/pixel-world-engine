#!/usr/bin/env python3
"""材质证据的裁图与像素读数：从 material-capture.mjs 拍的整幅工作表里，
按**世界坐标**切出目标窗口，量源色分布 / 纹理能量 / 同材质格重复率，
并导出 1:1 与 3× 最近邻放大图。

取景坐标只写在这张表里（`CROPS`）：前后两遍跑同一张表，裁出来的就是同一块地。

读数口径：
- `textureEnergy`：相邻像素平均亮度差。平涂 ≈ 0，有接缝/纹理则抬升。
- `edgePct`：亮度差 > 3 的相邻对占比。衡量「结构线密度」，防脏防花的抓手。
- `uniqueRGB`：窗口内不同 RGB 数。注意**昼夜叠色**会把整片像素挪出 palette，
  所以 `onToken` 在灯潮界不一定是 100%——它衡量「多少像素还能精确落回源色槽」。
"""
import json
import os
import sys
from collections import Counter

from PIL import Image, ImageDraw

# 两套世界的 24 色；键名与 palette-data.ts / dengchao pack 一致。
DENGCHAO = {
    'ink': '#111821', 'soil': '#202b35', 'grass': '#30454a', 'grassLit': '#4a6152',
    'stone': '#52666a', 'plaza': '#7d8984', 'farm': '#3d5154', 'timber': '#7c4a40',
    'timberDark': '#412d32', 'trim': '#dfbd7a', 'amber': '#f0a44b', 'skin': '#d5b28c',
    'cloak': '#48727b', 'cloakDark': '#293f50', 'ember': '#bf5441', 'pale': '#d1d7bd',
    'plaster': '#b9b294', 'terracotta': '#a4483d', 'copper': '#53736d', 'water': '#294f60',
    'moss': '#47645c', 'deepShade': '#1b303b', 'warmLight': '#f4d596', 'charcoal': '#2c3439',
}
DEFAULT = {
    'ink': '#14110d', 'soil': '#1b211c', 'grass': '#2d3b2e', 'grassLit': '#334234',
    'stone': '#3e433f', 'plaza': '#4a4f42', 'farm': '#3b3423', 'timber': '#8a5a44',
    'timberDark': '#4a3f39', 'trim': '#c9a86a', 'amber': '#e3a13c', 'skin': '#e0b48c',
    'cloak': '#30506b', 'cloakDark': '#223a4d', 'ember': '#c06a3e', 'pale': '#d8dad3',
    'plaster': '#c2b39a', 'terracotta': '#9c4f3c', 'copper': '#5f8a74', 'water': '#3d6b7a',
    'moss': '#4e6241', 'deepShade': '#18242b', 'warmLight': '#f2c879', 'charcoal': '#5a463e',
}

# (名字, 工作表, 世界中心 x, 世界中心 y, 世界窗口边长, palette)
CROPS = [
    # 街面铺装：铺装带 y=29（x12..51）。取 x16..19 三格，避开灯柱(15/23)与灯串(20..31)。
    ('road-paving', 'street', 280, 472, 48, 'dengchao'),
    # 广场/空地：灯街起点 x=12 以西（x 2..11 没有摊位与灯柱）。
    ('plaza-ground', 'west-plaza', 120, 496, 48, 'dengchao'),
    # 石板路：stone 带 x28..36 / y34..45。
    ('road-flagstone', 'south-road', 520, 584, 48, 'dengchao'),
    # 积尘滩：mud x39..56 / y35..42，避开补灯铺(43,34)。
    ('ground-mud', 'mud-flat', 792, 616, 48, 'dengchao'),
    # 煤渣地：coal y34..46。取 mud 以南 x≈53（未被泥地/石板路盖住），
    # 并避开摊位火光/蒸汽——它们按相位动，前后两遍会差几十像素。
    ('ground-coal', 'mud-flat', 850, 700, 48, 'dengchao'),
    # 房屋外立面：西侧店面(x12,y27)，墙 48px 高。
    ('wall-shopfront', 'street', 216, 424, 64, 'dengchao'),
    # 叠浪楼下半截（墙 + 石脚）：prefab at (28,20) 7×6。
    ('wall-prefab', 'street', 496, 400, 64, 'dengchao'),
    # 村民：中心由 index.json 里记录的脚底世界坐标给出。
    ('villager', 'villager', None, None, 40, 'dengchao'),
    # 莞尔镇默认世界的楼。
    ('wall-default', 'default-wall', None, None, 64, 'default'),
    # 1× 宽度对照：验收看的是正常缩放，48px 的窗口看不出整片拼接是否成立。
    # 窗口可以给 (宽, 高)；石块/广场格仍是 16px，所以这两个窗口都按 16 对齐。
    # 路面：取铺装带 y=29 及两侧各一格，160×96（10 格宽 × 6 格高）。
    ('road-wide', 'street', 280, 472, (160, 96), 'dengchao'),
    # 只看铺装带本身：160×32 = 10 格 × 2 格，读数不被上方的店面/摊位摊薄。
    ('road-band-wide', 'street', 280, 472, (160, 32), 'dengchao'),
    # 广场：plaza 带 y28..31 正好 4 格高，窗口贴齐 160×64，不混入草地/煤渣。
    ('ground-wide', 'west-plaza', 120, 480, (160, 64), 'dengchao'),
    # BUG-1 对照：炉底入口的石脚（走全局 paletteFor）与紧挨着的合法 stone 地形。
    # 只在改后证据里拍这个工作表（基线没有这张），`main` 会按缺失 sheet 跳过。
    ('wall-prefab-base', 'boiler-base', 504, 276, (128, 96), 'dengchao'),
]


def rgb(hexstr):
    h = hexstr.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def texture(px):
    """纹理读数：相邻像素的亮度差。整块平涂 → 0；有接缝/纹理 → 明显抬升。
    比 uniqueRGB 稳：昼夜叠色会把源色整体挪走，但邻像素的相对差几乎不变。"""
    w, h = px.size
    data = list(px.getdata())
    lum = [luma(c) for c in data]
    diffs = []
    for y in range(h):
        for x in range(w - 1):
            diffs.append(abs(lum[y * w + x + 1] - lum[y * w + x]))
    for y in range(h - 1):
        for x in range(w):
            diffs.append(abs(lum[(y + 1) * w + x] - lum[y * w + x]))
    edge = sum(1 for d in diffs if d > 3)
    return {
        'textureEnergy': round(sum(diffs) / len(diffs), 2),
        'edgePct': round(100 * edge / len(diffs), 2),
        'lumaStd': round((sum((v - (sum(lum) / len(lum))) ** 2 for v in lum) / len(lum)) ** 0.5, 2),
    }


def analyze(img, palette, cell=16):
    px = img.convert('RGB')
    w, h = px.size
    colours = Counter(px.getdata())
    reverse = {rgb(v): k for k, v in palette.items()}
    tokens = Counter()
    off = 0
    for colour, n in colours.items():
        name = reverse.get(colour)
        if name is None:
            off += n
        else:
            tokens[name] += n
    total = w * h
    # 同材质格的重复率：能整除 16 才按格切；distinct == count 即「每格都不一样」。
    cells = []
    if w % cell == 0 and h % cell == 0:
        for cy in range(h // cell):
            for cx in range(w // cell):
                cells.append(px.crop((cx * cell, cy * cell, cx * cell + cell, cy * cell + cell)).tobytes())
    tex = texture(px)
    return {
        'width': w,
        'height': h,
        'textureEnergy': tex['textureEnergy'],
        'edgePct': tex['edgePct'],
        'lumaStd': tex['lumaStd'],
        'uniqueRGB': len(colours),
        'onToken': round(100 * (total - off) / total, 2),
        'offToken': round(100 * off / total, 2),
        'topColours': [
            {'rgb': '#%02x%02x%02x' % c, 'token': reverse.get(c, '—'), 'pct': round(100 * n / total, 2)}
            for c, n in colours.most_common(8)
        ],
        'tokens': {k: round(100 * n / total, 2) for k, n in tokens.most_common()},
        'meanLuma': round(sum(luma(c) * n for c, n in colours.items()) / total, 2),
        'cells': {'count': len(cells), 'distinct': len(set(cells))},
    }


def crop_window(sheet_img, sheet, world_x, world_y, span):
    """世界坐标 → 工作表像素：只需 scroll 与 cssPerWorld 两个读数。

    `span` 可以是单个数（正方形）或 (宽, 高)。
    """
    width, height = span if isinstance(span, tuple) else (span, span)
    scale = sheet['cssPerWorld']
    ox = (world_x - sheet['camera']['scrollX']) * scale
    oy = (world_y - sheet['camera']['scrollY']) * scale
    half_w = width * scale / 2
    half_h = height * scale / 2
    box = (
        round(ox - half_w), round(oy - half_h),
        round(ox + half_w), round(oy + half_h),
    )
    return box


def compose_pairs(root, label, other_label, names):
    """把 before / after 的 3× 放大图拼成一张对照图：左原样、右改后，标签在下方。

    名字以 `-wide` 结尾的是 1× 可见性对照，另出一张不放大的一左一右，
    验收看的是正常缩放，不能被 3× 的放大图代替。
    """
    out_dir = os.path.join(os.path.dirname(root), 'compare')
    os.makedirs(out_dir, exist_ok=True)
    for name in names:
        suffix = '' if name.endswith('-wide') else '@3x'
        left = os.path.join(os.path.dirname(root), other_label, f'{name}{suffix}.png')
        right = os.path.join(root, f'{name}{suffix}.png')
        if not (os.path.exists(left) and os.path.exists(right)):
            continue
        a = Image.open(left).convert('RGB')
        b = Image.open(right).convert('RGB')
        h = max(a.height, b.height)
        sheet = Image.new('RGB', (a.width + b.width + 12, h + 18), (8, 8, 8))
        sheet.paste(a, (0, 18))
        sheet.paste(b, (a.width + 12, 18))
        draw = ImageDraw.Draw(sheet)
        draw.text((2, 4), f'{other_label}', fill=(200, 200, 200))
        draw.text((a.width + 14, 4), f'{label}', fill=(255, 220, 150))
        out = f'{name}-1x.png' if name.endswith('-wide') else f'{name}.png'
        sheet.save(os.path.join(out_dir, out))


def main(label):
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    root = os.path.join(repo, 'docs', 'evidence', 'material-upgrade', label)
    with open(os.path.join(root, 'index.json'), encoding='utf-8') as fh:
        index = json.load(fh)
    sheets = {s['name']: s for s in index['sheets']}
    readings = []
    for name, sheet_name, wx, wy, span, pal_key in CROPS:
        sheet = sheets.get(sheet_name)
        if sheet is None:
            print(f'missing sheet {sheet_name} for {name}', file=sys.stderr)
            continue
        if name == 'villager':
            feet = sheet.get('villager', {}).get('feetWorld')
            if feet is None:
                print('missing villager feet', file=sys.stderr)
                continue
            wx, wy = feet['x'], feet['y'] + 2  # 脚底往上 2px，把整只人包进窗口
        if name == 'wall-default':
            building = sheet.get('building')
            if building is None:
                print('missing default building', file=sys.stderr)
                continue
            o, f = building['origin'], building['footprint']
            wx = (o['x'] + f['w'] / 2) * 16
            wy = (o['y'] + f['h'] - 1) * 16
        src = os.path.join(root, f'{sheet_name}-sheet-2x.png')
        if not os.path.exists(src):
            print(f'missing {src}', file=sys.stderr)
            continue
        big = Image.open(src).convert('RGB')
        box = crop_window(big, sheet, wx, wy, span)
        crop = big.crop(box)
        # 工作表是 2× CSS（一个世界像素 = 2×2 CSS 像素），按最近邻抽回 1:1，
        # 读数与放大图都从这个 1:1 图出，避免浏览器重采样骗过亮度统计。
        cw, ch = crop.width // 2, crop.height // 2
        box1 = crop.resize((cw, ch), Image.NEAREST)
        box1.save(os.path.join(root, f'{name}.png'))
        box1.resize((cw * 3, ch * 3), Image.NEAREST).save(os.path.join(root, f'{name}@3x.png'))
        palette = DENGCHAO if pal_key == 'dengchao' else DEFAULT
        reading = {'name': name, 'sheet': sheet_name, 'worldCenter': {'x': wx, 'y': wy}, 'span': span}
        reading.update(analyze(box1, palette))
        readings.append(reading)
        print(f"{name}: {cw}×{ch} @({wx},{wy}) uniqueRGB={reading['uniqueRGB']} "
              f"onToken={reading['onToken']}% meanLuma={reading['meanLuma']} "
              f"tex={reading['textureEnergy']} edge={reading['edgePct']}% "
              f"lumaStd={reading['lumaStd']} "
              f"cells={reading['cells']['distinct']}/{reading['cells']['count']}")
        for tok, pct in list(reading['tokens'].items())[:6]:
            print(f'    {tok:12s} {pct:6.2f}%')
    with open(os.path.join(root, 'readings.json'), 'w', encoding='utf-8') as fh:
        json.dump(readings, fh, ensure_ascii=False, indent=2)
    if label == 'after':
        compose_pairs(root, 'after', 'before', [c[0] for c in CROPS])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'before')
