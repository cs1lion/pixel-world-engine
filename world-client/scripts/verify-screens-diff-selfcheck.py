"""screens-diff.py 的自检：正例必须绿，构造的红例必须红。

判据本身不改，只喂合成图：
  - 可见差门槛是任一 RGB 通道 >= 8；差 7 时可见掩膜为 0，结构断言必须红。
  - 结构断言看最大连通块面积是否落在 [minArea, maxArea]；2900 与 3000 两档分界。
  - 同图两跑没有差区，必须报 no-diff-region 并退出 1。

跑法（cwd 任意）：
  python world-client/scripts/verify-screens-diff-selfcheck.py
产物：world-client/tmp/verify-flows/screens-diff/
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DIFF = HERE / "screens-diff.py"
OUT_ROOT = Path(os.environ.get("VERIFY_FLOWS_OUT", HERE.parent / "tmp" / "verify-flows" / "screens-diff"))

W, H = 200, 200


def write_png(path: Path, array: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(array.astype(np.uint8), "L").convert("RGBA").save(path)


def make_pair(case: str, delta: int, rect: tuple[int, int, int, int] | None) -> tuple[Path, Path]:
    old = np.zeros((H, W), dtype=np.uint8)
    new = old.copy()
    if rect is not None:
        x, y, w, h = rect
        new[y : y + h, x : x + w] = delta
    old_dir = OUT_ROOT / case / "old"
    old_dir.mkdir(parents=True, exist_ok=True)
    new_dir = OUT_ROOT / case / "new"
    new_dir.mkdir(parents=True, exist_ok=True)
    write_png(old_dir / "case.png", old)
    write_png(new_dir / "case.png", new)
    return old_dir, new_dir


def run_case(case: str, spec: dict, expect_exit: int, expect_reason: str, expect_area: int) -> list[str]:
    old_dir, new_dir = make_pair(
        case,
        delta=spec.get("delta", 0),
        rect=tuple(spec["rect"]) if "rect" in spec else None,
    )
    out_dir = OUT_ROOT / case / "out"
    spec_path = OUT_ROOT / case / "spec.json"
    spec_path.write_text(
        json.dumps({"case.png": {"kind": "selfcheck", "minArea": spec["minArea"], "maxArea": spec["maxArea"]}}),
        encoding="utf-8",
    )
    proc = subprocess.run(
        [
            sys.executable,
            str(DIFF),
            "--old",
            str(old_dir),
            "--new",
            str(new_dir),
            "--out",
            str(out_dir),
            "--structure-spec",
            str(spec_path),
        ],
        capture_output=True,
        text=True,
    )
    errors: list[str] = []
    if proc.returncode != expect_exit:
        errors.append(f"{case}: 退出码 {proc.returncode}，期望 {expect_exit}")
    payload = json.loads((out_dir / "screens-diff.json").read_text(encoding="utf-8"))
    record = payload["records"][0]
    assertion = record.get("structureAssertion") or {}
    if assertion.get("reason") != expect_reason:
        errors.append(f"{case}: reason={assertion.get('reason')!r}，期望 {expect_reason!r}")
    if assertion.get("largestAreaPx") != expect_area:
        errors.append(f"{case}: largestAreaPx={assertion.get('largestAreaPx')}，期望 {expect_area}")
    print(
        f"{case:22s} exit={proc.returncode} reason={assertion.get('reason'):18s} "
        f"area={assertion.get('largestAreaPx')} visiblePx={record.get('visibleChangedPx')}"
    )
    return errors


def main() -> int:
    cases = [
        # 3000 px 落在 [3000, 5200]：绿
        dict(case="pass-3000", delta=255, rect=(10, 10, 150, 20), minArea=3000, maxArea=5200,
             expect_exit=0, expect_reason="pass", expect_area=3000),
        # 2900 px 低于下界：红
        dict(case="fail-2900", delta=255, rect=(10, 10, 145, 20), minArea=3000, maxArea=5200,
             expect_exit=1, expect_reason="area-out-of-range", expect_area=2900),
        # 差 7 级：精确差有 100 px，可见差 0 px，结构断言必须红
        dict(case="fail-visible-7", delta=7, rect=(10, 10, 10, 10), minArea=1, maxArea=999_999,
             expect_exit=1, expect_reason="no-diff-region", expect_area=0),
        # 差 8 级：刚好进可见掩膜，绿
        dict(case="pass-visible-8", delta=8, rect=(10, 10, 10, 10), minArea=1, maxArea=999_999,
             expect_exit=0, expect_reason="pass", expect_area=100),
        # 同图两跑：没有差区，红
        dict(case="fail-no-diff", delta=0, minArea=38, maxArea=85,
             expect_exit=1, expect_reason="no-diff-region", expect_area=0),
    ]
    errors: list[str] = []
    for item in cases:
        case = item.pop("case")
        spec = {k: item[k] for k in ("delta", "rect", "minArea", "maxArea") if k in item}
        errors.extend(
            run_case(
                case,
                spec,
                expect_exit=item["expect_exit"],
                expect_reason=item["expect_reason"],
                expect_area=item["expect_area"],
            )
        )
    if errors:
        print("\n自检失败：")
        for line in errors:
            print(f"  - {line}")
        return 1
    print("\nscreens-diff 自检通过：5/5 例按预期判绿或判红")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
