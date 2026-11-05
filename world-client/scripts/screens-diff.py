#!/usr/bin/env python3
"""逐张比对 eval/screens 的旧（HEAD）与新（工作树）截图。

只做「测量」，不做「判定」：给每张图出
  - 旧/新 sha256、尺寸、字节差
  - 像素差百分比（任一 RGBA 通道不同即算差）
  - 差异的连通区域（8 邻接），按面积排序，给出 bbox / 面积 / 占比 / 旧新主色
  - 全局平移搜索：若存在某个整数平移 (dx,dy) 让差异骤降，说明是「整幅位移」
    （相机跟随点变了、或截图裁剪原点变了），不是「同一位置上的内容变了」

跑法：
  python scripts/screens-diff.py --old <旧图目录> --new <新图目录> --out <输出目录>

旧图目录用 `git archive HEAD world-client/eval/screens | tar -x -C <tmp>` 得到。
输出：<out>/screens-diff.json + <out>/masks/<name>.png（差异区域描红，供人看）。
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_rgba(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert('RGBA'), dtype=np.int16)


def crop_compare(old: np.ndarray, new: np.ndarray, dx: int, dy: int) -> tuple[float, int]:
    """把 new 平移 (dx,dy) 后与 old 的重叠区做比较，返回 (差异像素占比, 重叠像素数)。"""
    h, w = old.shape[:2]
    x0a, x1a = max(0, dx), min(w, w + dx)
    y0a, y1a = max(0, dy), min(h, h + dy)
    if x1a <= x0a or y1a <= y0a:
        return 1.0, 0
    a = old[y0a:y1a, x0a:x1a]
    b = new[y0a - dy:y1a - dy, x0a - dx:x1a - dx]
    diff = np.any(a != b, axis=2)
    return float(diff.mean()), int(diff.size)


def bbox_of(mask: np.ndarray) -> list[int]:
    ys, xs = np.where(mask)
    if xs.size == 0:
        return []
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def hexish(px: np.ndarray) -> str:
    """区域主色（取中位数，避免被边缘抗锯齿拉动）。"""
    med = np.median(px.reshape(-1, 4)[:, :3], axis=0)
    return '#%02x%02x%02x' % tuple(int(v) for v in med)


def label_components(mask: np.ndarray):
    """行游程 + 并查集的 8 邻接连通域，避免依赖 scipy（本机 scipy 与 numpy 2.x 不兼容）。

    返回 [(root, area, bbox, runs)]，runs 是 [(y, x0, x1)]，x1 为闭区间。
    """
    parent: list[int] = []

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    all_runs: list[tuple[int, int, int, int]] = []  # (y, x0, x1, rid)
    prev: list[tuple[int, int, int]] = []
    for y in range(mask.shape[0]):
        idx = np.flatnonzero(mask[y])
        runs: list[tuple[int, int, int]] = []
        if idx.size:
            breaks = np.where(np.diff(idx) > 1)[0]
            starts = np.concatenate(([idx[0]], idx[breaks + 1]))
            ends = np.concatenate((idx[breaks], [idx[-1]]))
            for s, e in zip(starts.tolist(), ends.tolist()):
                rid = len(parent)
                parent.append(rid)
                runs.append((s, e, rid))
                all_runs.append((y, s, e, rid))
        # 8 邻接：上一行的 [ps,pe] 与本行 [s,e] 只要 pe >= s-1 且 ps <= e+1 就连通
        j = 0
        for s, e, rid in runs:
            while j < len(prev) and prev[j][1] < s - 1:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] <= e + 1:
                union(rid, prev[k][2])
                k += 1
        prev = runs

    groups: dict[int, dict] = {}
    for y, s, e, rid in all_runs:
        root = find(rid)
        g = groups.get(root)
        if g is None:
            groups[root] = {'area': e - s + 1, 'x0': s, 'x1': e, 'y0': y, 'y1': y, 'runs': [(y, s, e)]}
        else:
            g['area'] += e - s + 1
            g['x0'] = min(g['x0'], s)
            g['x1'] = max(g['x1'], e)
            g['y1'] = y
            g['runs'].append((y, s, e))
    return list(groups.values())


def region_pixels(shape, runs) -> np.ndarray:
    ys, xs = [], []
    for y, s, e in runs:
        ys.append(np.full(e - s + 1, y, dtype=np.int32))
        xs.append(np.arange(s, e + 1, dtype=np.int32))
    return np.concatenate(ys), np.concatenate(xs)


def region_report(old: np.ndarray, new: np.ndarray, mask: np.ndarray, min_area: int) -> list[dict]:
    groups = sorted(label_components(mask), key=lambda g: g['area'], reverse=True)
    out = []
    for g in groups:
        if g['area'] < min_area:
            continue
        ys, xs = region_pixels(mask.shape, g['runs'])
        old_px = old[ys, xs]
        new_px = new[ys, xs]
        out.append(
            {
                'areaPx': int(g['area']),
                'bbox': [int(g['x0']), int(g['y0']), int(g['x1']), int(g['y1'])],  # 闭区间
                'size': [int(g['x1'] - g['x0'] + 1), int(g['y1'] - g['y0'] + 1)],
                'oldColor': hexish(old_px),
                'newColor': hexish(new_px),
                'meanAbsDiff': float(
                    np.abs(old_px[:, :3].astype(np.int32) - new_px[:, :3]).mean()
                ),
            }
        )
    if len(out) > 25:
        # 只保留前 25 个，其余合计成一行，避免 JSON 被碎片撑爆
        tail = out[25:]
        out = out[:25] + [
            {
                'areaPx': int(sum(r['areaPx'] for r in tail)),
                'bbox': [
                    min(r['bbox'][0] for r in tail),
                    min(r['bbox'][1] for r in tail),
                    max(r['bbox'][2] for r in tail),
                    max(r['bbox'][3] for r in tail),
                ],
                'size': [0, 0],
                'oldColor': '',
                'newColor': '',
                'meanAbsDiff': 0.0,
                'mergedTail': len(tail),
            }
        ]
    return out


def save_mask_png(old: np.ndarray, mask: np.ndarray, path: Path, scale: int = 1) -> None:
    """旧图上把差异像素涂成洋红，便于人眼定位。"""
    base = old[:, :, :3].astype(np.uint8).copy()
    base[mask] = [255, 0, 255]
    im = Image.fromarray(base, 'RGB')
    if scale > 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)


def analyse(old_path: Path, new_path: Path, out_dir: Path) -> dict:
    old_bytes, new_bytes = old_path.read_bytes(), new_path.read_bytes()
    rec = {
        'name': old_path.name,
        'oldSha256': sha256(old_path),
        'newSha256': sha256(new_path),
        'oldBytes': len(old_bytes),
        'newBytes': len(new_bytes),
        'identicalBytes': old_bytes == new_bytes,
    }
    old = load_rgba(old_path)
    new = load_rgba(new_path)
    rec['oldSize'] = [int(old.shape[1]), int(old.shape[0])]
    rec['newSize'] = [int(new.shape[1]), int(new.shape[0])]
    if old.shape != new.shape:
        rec['comparable'] = False
        rec['note'] = '尺寸不同，像素级不可直接比；需按「新的画面几何」单独判定'
        return rec

    rec['comparable'] = True
    # 两级口径：
    #   exact  —— 任一 RGBA 通道差 1 就算（最严，会被「整体 +1 色阶」放大成几十 %）；
    #   visible—— 任一通道差 ≥ 8 才算（与 check-phases 的亮度门槛同量级，肉眼可辨）。
    delta = np.abs(old[:, :, :3].astype(np.int32) - new[:, :, :3].astype(np.int32)).max(axis=2)
    exact_mask = (delta > 0) | np.any(old[:, :, 3:] != new[:, :, 3:], axis=2)
    visible_mask = delta >= 8
    total = exact_mask.size
    rec['exactChangedPx'] = int(exact_mask.sum())
    rec['exactDiffPct'] = round(100.0 * rec['exactChangedPx'] / total, 4)
    rec['visibleChangedPx'] = int(visible_mask.sum())
    rec['visibleDiffPct'] = round(100.0 * rec['visibleChangedPx'] / total, 4)
    rec['exactBBox'] = bbox_of(exact_mask)
    rec['visibleBBox'] = bbox_of(visible_mask)
    rec['deltaHistogram'] = {
        'gt0': int(exact_mask.sum()),
        'ge8': int(visible_mask.sum()),
        'ge32': int((delta >= 32).sum()),
        'ge64': int((delta >= 64).sum()),
        'ge128': int((delta >= 128).sum()),
    }
    signed = (new[:, :, :3].astype(np.int32) - old[:, :, :3].astype(np.int32))
    rec['meanSignedDeltaRGB'] = [round(float(signed[:, :, c].mean()), 3) for c in range(3)]
    rec['medianSignedDeltaRGB'] = [
        int(np.median(signed[:, :, c])) for c in range(3)
    ]
    rec['regions'] = region_report(old, new, visible_mask, min_area=16)
    rec['regionsTotal'] = len(rec['regions'])

    # 全局平移搜索：说明「整幅图有没有位移」。大图先按步长降采样，免得 81 次
    # 全尺寸布尔比较把内存打满；结论只关心「有没有 1–3px 级整幅位移」。
    step = max(1, max(old.shape[1], old.shape[0]) // 900)
    o_small, n_small = old[::step, ::step], new[::step, ::step]
    best = None
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            share, overlap = crop_compare(o_small, n_small, dx, dy)
            if best is None or share < best['share']:
                best = {'dx': dx, 'dy': dy, 'share': round(share, 6), 'overlapPx': overlap}
    rec['bestShift'] = best
    rec['bestShiftStep'] = step
    rec['shiftGainPct'] = round(100.0 * (rec['exactDiffPct'] / 100.0 - best['share']), 4)

    save_mask_png(old, exact_mask, out_dir / 'masks' / f'{old_path.stem}-exact.png')
    save_mask_png(old, visible_mask, out_dir / 'masks' / f'{old_path.stem}-visible.png')
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--old', required=True)
    ap.add_argument('--new', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    names = sorted(p.name for p in Path(args.new).glob('*.png'))
    records = []
    for name in names:
        old_path = Path(args.old) / name
        if not old_path.exists():
            records.append({'name': name, 'oldSha256': None, 'note': '旧图不存在（新增文件）'})
            continue
        records.append(analyse(old_path, Path(args.new) / name, out_dir))

    payload = {'oldDir': args.old, 'newDir': args.new, 'records': records}
    (out_dir / 'screens-diff.json').write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8'
    )

    # 给人看的一行摘要
    print(f"{'file':30s} {'exact%':>7s} {'vis%':>7s} {'visBBox':>20s} {'regions':>8s}")
    for r in records:
        if r.get('oldSha256') is None or not r.get('comparable'):
            print(f"{r['name']:30s} {'—':>7s} {'—':>7s} {r.get('note', '')}")
            continue
        print(
            f"{r['name']:30s} {r['exactDiffPct']:7.2f} {r['visibleDiffPct']:7.2f} "
            f"{str(r['visibleBBox']):>20s} {r['regionsTotal']:8d}"
        )


if __name__ == '__main__':
    main()
