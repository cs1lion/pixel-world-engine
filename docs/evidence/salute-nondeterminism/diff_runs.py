#!/usr/bin/env python3
"""同构建多次 smoke 的截图逐张比对（01-salute 归因用）。

只测量、不判定：
  - exact   ：任一像素任一通道 != 0 的占比
  - visible ：任一通道差 >= 8 级的占比（与 Step 0 闸门同一口径）
  - maxdelta：全图最大通道差
  - 每通道差值直方图（-255..255 里的非零桶）
  - 差异最多的颜色对（旧色 -> 新色）与它的 bbox

跑法：
  python diff_runs.py <runs-dir-1> <runs-dir-2> [<runs-dir-3> ...]
输出：<runs-dir-1>/../salute-diff.json 或 --out 指定。
"""
import argparse
import itertools
import json
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image


def load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert('RGB'), dtype=np.int16)


def compare(a_path: Path, b_path: Path) -> dict:
    a, b = load(a_path), load(b_path)
    if a.shape != b.shape:
        return {'error': f'尺寸不同 {a.shape} vs {b.shape}'}
    d = np.abs(a - b)
    per_px_max = d.max(axis=2)
    exact = float((per_px_max != 0).mean() * 100)
    visible = float((per_px_max >= 8).mean() * 100)
    hist = {}
    for channel, name in enumerate(('r', 'g', 'b')):
        signed = (b[:, :, channel] - a[:, :, channel]).ravel()
        counts = Counter(signed.tolist())
        hist[name] = {str(k): v for k, v in sorted(counts.items()) if k != 0}
    mask = per_px_max >= 8
    pairs = Counter(
        (tuple(a[y, x].tolist()), tuple(b[y, x].tolist()))
        for y, x in zip(*np.nonzero(mask))
    )
    top = []
    for (ca, cb), n in pairs.most_common(6):
        sel = np.all(a == np.array(ca, dtype=np.int16), axis=2) & np.all(
            b == np.array(cb, dtype=np.int16), axis=2
        )
        ys, xs = np.nonzero(sel)
        top.append({
            'old': list(ca),
            'new': list(cb),
            'count': int(n),
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
        })
    ys, xs = np.nonzero(mask)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if xs.size else []
    return {
        'exact_pct': round(exact, 4),
        'visible_pct': round(visible, 4),
        'visible_px': int(mask.sum()),
        'max_delta': int(per_px_max.max()),
        'visible_bbox': bbox,
        'top_color_pairs': top,
        'channel_hist': hist,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('runs', nargs='+')
    parser.add_argument('--out', default=None)
    args = parser.parse_args()

    dirs = [Path(p) for p in args.runs]
    names = None
    for d in dirs:
        found = sorted(p.name for p in d.glob('*.png'))
        names = found if names is None else [n for n in names if n in found]
    result = {'runs': [str(d) for d in dirs], 'pairs': {}}
    for a_dir, b_dir in itertools.combinations(dirs, 2):
        key = f'{a_dir.name} vs {b_dir.name}'
        result['pairs'][key] = {}
        for name in names:
            result['pairs'][key][name] = compare(a_dir / name, b_dir / name)

    out = Path(args.out) if args.out else dirs[0].parent / 'salute-diff.json'
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    for pair, shots in result['pairs'].items():
        print(f'\n{pair}')
        for name, stats in shots.items():
            if 'error' in stats:
                print(f'  {name}: {stats["error"]}')
                continue
            print(
                f'  {name:28s} exact={stats["exact_pct"]:7.4f}%  '
                f'visible={stats["visible_pct"]:7.4f}%  maxdelta={stats["max_delta"]}'
            )
    print(f'\n写出 {out}')


if __name__ == '__main__':
    main()
