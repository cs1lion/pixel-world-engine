# 设定集参考图试点：茶摊三版对比（2026-11-10）

用户确认「可以用设定集做参考，不考虑版权问题」后的第一次按需重生成。

## 参考来源

《千与千寻视觉设定集》PDF（本机 `C:\Users\18712\Downloads\...`，99 页，140 MB，不入库）。
用 PyMuPDF 抽两页缩到长边 768 后转 data URI，经 `gen_asset.py --ref-file` 传给生图接口：

- **p19**：浴场街市水彩全景（街道层次、木构密度）
- **p49**：红漆油屋与灯笼（配色、暖光、门帘）

## 三版

| 版本 | 文件 | 做法 |
|---|---|---|
| A 文字版 | `tea_stall-text-only.png` | 只有文字 Prompt，无参考图（上一轮产物） |
| B 斜视角 | `tea_stall-perspective.png` | p19+p49 参考，未约束视角 |
| C 正交版 | 正式素材 `public/assets/building/tea_stall.png` | p19+p49 参考 + Prompt 强制 `FRONT ORTHOGRAPHIC / NO perspective / NO ground plane` |

`compare.png` 是三版并排图。

## 结论

- **参考图确实提升质感**：B/C 的瓦片纹理、门帘纹样、木构细节明显细于 A。
- **B 不能进引擎**：斜视角自带侧墙与石板地面，与世界正交网格、Y-Sort 拼接不兼容；实测抠底干净（洋红残边 0.15%），问题在透视不在抠图。
- **采纳 C**：正交正面、无地面、无侧墙，浏览器 `?art=1&world=dengchao&time=noon` 实测与场景衔接正常。代价是灯笼压成贴墙小圆片、丢了 B 的地面暖光——**正交化会损失一部分氛围**，这是取舍。
- **混用期风格不统一**：目前只有 2 栋建筑 + 2 个村民有素材，其余仍是程序化绘制，截图里位图楼比周围细节多。这是按需逐件生成的过渡态，不是错位。

## 复现

```bash
cd server
python scripts/gen_asset.py building tea_stall --width 5 \
  --desc "... STRICTLY FRONT ORTHOGRAPHIC ELEVATION ... NO ground plane ..." \
  --ref-file ../tmp/art-ref/ref-p19.png --ref-file ../tmp/art-ref/ref-p49.png
```

参考页抽取脚本见本目录说明；`tmp/` 下的抽取产物不入库。
