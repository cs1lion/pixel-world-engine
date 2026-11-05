#!/usr/bin/env python3
"""结构档的反向用例：证明断言真的会红，而不是永远绿。

用法（三跑落在 <runs>/run1|run2|run3）：
  python reverse-structure-check.py --run1 <.../run1> --run2 <.../run2>

四个用例：
  1. 真实 02 两跑 → 应 PASS（烟柱的差异块落在 3000–5200）；
  2. 真实 04 两跑 → 应 PASS（雨丝差异块落在 38–85）；
  3. 合成「烟柱像素数压到 2,900」→ 应 FAIL（最大块 2900 < 3000）；
  4. 合成「雨丝全无」→ 应 FAIL（两图逐字节相同，最大块 0）。
"""
import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DIFF = HERE.parents[2] / 'world-client' / 'scripts' / 'screens-diff.py'
SPEC = HERE / 'structure-spec.json'


def load_diff_module():
    spec = importlib.util.spec_from_file_location('screens_diff', DIFF)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def structure_of(sd, old_path: Path, new_path: Path) -> dict:
    old = sd.load_rgba(old_path)
    new = sd.load_rgba(new_path)
    delta = np.abs(old[:, :, :3].astype(np.int32) - new[:, :, :3].astype(np.int32)).max(axis=2)
    return sd.structure_report(delta >= 8)


def make_smoke_2900(old_path: Path, out_path: Path) -> None:
    """在旧图上涂一块 145×20=2900 px 的差，模拟「烟柱只剩 2900 像素」。"""
    old = np.asarray(Image.open(old_path).convert('RGB')).astype(np.int32)
    old[200:220, 600:745] = np.clip(old[200:220, 600:745] + 24, 0, 255)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(old.astype(np.uint8), 'RGB').save(out_path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run1', required=True)
    ap.add_argument('--run2', required=True)
    args = ap.parse_args()
    run1, run2 = Path(args.run1), Path(args.run2)
    sd = load_diff_module()
    spec = json.loads(SPEC.read_text(encoding='utf-8'))
    synth = HERE / 'reverse'
    synth.mkdir(parents=True, exist_ok=True)

    rows = []

    def case(label: str, old: Path, new: Path, rule: dict, expect_pass: bool) -> None:
        struct = structure_of(sd, old, new)
        verdict = sd.structure_assertion(struct, rule)
        ok = verdict['pass'] is expect_pass
        rows.append((label, struct['largestAreaPx'], 'PASS' if verdict['pass'] else 'FAIL',
                     'PASS' if expect_pass else 'FAIL', ok))

    case('真实 02 两跑（期望 PASS）', run1 / '02-working.png', run2 / '02-working.png',
         spec['02-working.png'], True)
    case('真实 04 两跑（期望 PASS）', run1 / '04-rain.png', run2 / '04-rain.png',
         spec['04-rain.png'], True)

    smoke_2900 = synth / '02-smoke-2900.png'
    make_smoke_2900(run1 / '02-working.png', smoke_2900)
    case('合成烟柱 2900px（期望 FAIL）', run1 / '02-working.png', smoke_2900,
         spec['02-working.png'], False)

    rain_none = synth / '04-rain-none.png'
    Image.open(run1 / '04-rain.png').save(rain_none)
    case('合成雨丝全无（期望 FAIL）', run1 / '04-rain.png', rain_none,
         spec['04-rain.png'], False)

    print(f"{'case':30s} {'largestPx':>10s} {'actual':>7s} {'expected':>9s} {'ok':>4s}")
    ok_all = True
    for label, area, actual, expected, ok in rows:
        ok_all = ok_all and ok
        print(f'{label:30s} {area:10d} {actual:>7s} {expected:>9s} {str(ok):>4s}')
    print(f"\n反向用例：{'全部符合预期' if ok_all else '有不符合预期的项'}")
    raise SystemExit(0 if ok_all else 1)


if __name__ == '__main__':
    main()
