import json
import sys
from collections import Counter
from pathlib import Path


def dominant(pixels):
    c = Counter(tuple(pixels[i:i + 3]) for i in range(0, len(pixels), 4))
    return c.most_common(3)


def summarize(path: Path) -> None:
    data = json.loads(path.read_text(encoding='utf-8'))
    print(f'\n== {path.parent.name} ({data["mode"]}, errors={len(data["errors"])})')
    for rec in data['records']:
        s = rec['state']
        rb = rec['readback']
        print(
            f'{rec["label"]:10s} now={s["now"]:9d} tide={s["tide"]["level"]:.3f} '
            f'weather={s["weather"]:5s} phase={s["phase"]:5s} '
            f'villager={s["villager"]["mode"]}/{int(s["villager"]["walking"])} '
            f'pos=({s["villager"]["pos"]["x"]:.2f},{s["villager"]["pos"]["y"]:.2f}) '
            f'cam={s["camera"]["scrollX"]},{s["camera"]["scrollY"]} '
            f'readback={rb["width"]}x{rb["height"]} top={dominant(rb["pixels"])[:2]}'
        )


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        summarize(Path(arg))
