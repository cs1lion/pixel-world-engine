# 可辨阈值色卡（palette threshold）

用途：以后判「相邻两段色带差多少才算读得出来」，引用本表，不再靠肉眼碰运气。
本目录是**证据**，不是闸门；没有任何测试会替你看图。

## 资产

| 文件 | 作用 |
|---|---|
| `de2000.mjs` | sRGB ↔ CIE L\*a\*b\* 与 CIEDE2000 的单一实现；按 Sharma et al. (2005) 完整式，内置两个标准样本自检 |
| `gen-threshold.mjs` | 生成器：算色、写 `readings.json`、写 `ramp-test-4x.png` |
| `ramp-test-4x.png` | 判读用图，128×512（8 行 × 左右两块） |
| `readings.json` | 每档实际 hex、回算 L\*、ΔL\*、ΔE2000 |

`ramp-test-4x.png` sha256 `FDAB80BF35CCD34E503F92C69690CAA0C62D38D17929282C20A4F09D0BA6CD4F`
`readings.json` sha256 `E0F7BB64D7B2DB5B516F310218C1EA8F00C66003935C7F6E591D9959EB864A1F`

（以上是**生成器直出内容**的 sha256，即 LF 换行的版本；仓库内 `core.autocrlf=true`，检出到工作区后文本文件会变成 CRLF，此时对工作区文件算 sha256 会不同。要比对复跑结果，请看下面「复跑」一节按 git blob 比对。）

## 生成方法与参数

- 基色：灯潮界草色 `#30454a`（L\* 27.79，a −6.76，b −5.66）。
- 只改明度：保持 a/b 不变，把 L\* 逐档加 2/3/4/5/6/8/10/12；sRGB 量化后**回算实际 ΔL\***（所以表里是 2.17/3.03/3.89/5.10/6.02/8.06/10.14/11.90）。
- 版面：每档一行，左半 = 基色，右半 = 加档色；每半 16 art px 宽、行高 16 art px，共 8 行。
- 放大：整图 4× 最近邻（1 art px = 4 图内 px）；输出 128×512。
- 判读：在 4× 图上逐行看左右两块的边界——看不见 / 极弱缝 / 能指出分界 / 稳定可辨。
- 性质：色块面积远大于 3px 窄带，所以这是**宽松下界**；人工判读只保证「同一个人、同一张卡」可重复，不宣称普适感知阈值。

## 读数

| ΔL\* 目标 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 |
|---|---|---|---|---|---|---|---|---|
| 实际 ΔL\*（回算） | 2.17 | 3.03 | 3.89 | 5.10 | 6.02 | 8.06 | 10.14 | 11.90 |
| ΔE2000 | 1.66 | 2.33 | 3.00 | 3.97 | 4.70 | 6.38 | 8.13 | 9.65 |
| 目视 | 看不见 | 看不见 | 极弱缝 | 能指出分界 | 稳定可辨 | 清楚 | 清楚 | 清楚 |

**「ΔL 6 稳定」这句话的出处就是这张表**（配合仓库既有 `EDGE_VISIBLE_MIN_DL = 6`，后者管 1px 边沿，本表管 ≥3px 色带）。可判定定义：

- ≥3 art px 色带：`ΔL* ≥ 5` 算「看得出」，`ΔL* ≥ 6` 算「稳定」。
- `ΔL* < 4`（本表 ΔE2000 < 3.1）不算可用色阶。
- 1px 边沿仍用 `EDGE_VISIBLE_MIN_DL = 6`。

## 口径更正（重要）

2026-11 的初版读数（ΔE 2.96/3.50/4.08/4.88/5.53，以及 `soil→farm` 的 12.85）来自一份**漏掉 `a′ = a(1+G)` 与 `C′/h′` 重算的简化 ΔE2000**。本目录的 `de2000.mjs` 用 Sharma 完整式，并通过该文两个标准样本（2.0425 / 2.8615）自检；上表是更正后的值。

- **判读依据是 ΔL，不是 ΔE**，所以「ΔL 6 稳定」的结论不变。
- 凡引用旧值（2.96/3.50/4.08/4.88/5.53、12.85）的文档需按本表订正。

已知受影响的引用（`docs/P1_SHORE_BAND_DESIGN.md`，`feat/shore-band@124f802`）：

| 位置 | 旧值 | 更正 | 状态 |
|---|---|---|---|
| §6.1 可辨阈值 | ΔE 2.96/3.50/4.08/4.88/5.53 | 1.66/2.33/3.00/3.97/4.70 | 已复算 |
| §6.1 `farm→plaster` | 42.0 | 42.07 | 已复算 |
| §6.2 夜相 `farm→stone` | ΔL 4.8 / ΔE 3.71；阈值 5.53 | ΔL 4.84 / ΔE 3.72；阈值 4.70 | 已复算（0.46 叠加） |
| §6.5 表 `soil→farm` | 12.85；阈值 ≥5.53 | 13.58；阈值 ≥4.70 | 已复算 |
| §6.5 表 `farm→plaza`（午） | 22.23 | 22.21 | 已复算 |
| §6.5 雨天各行 | 9.17/15.04/10.06/…/4.60 | — | **未复核**：需按 §6.5 的时相/天气混合函数统一重跑；未重跑前不得当实测引用 |

已复核的判定不变：夜相 `farm→stone` 仍低于 ΔL 6（4.84），夜+雨仍最弱；把 ΔE 阈值从 5.53 改为 4.70 不会把「未到」翻成「过」。雨天各行只是数值列需重跑，**结论列不据此改写**。

## 复跑

```powershell
node docs/evidence/palette-threshold/gen-threshold.mjs
```

**按 git blob 比对（不受换行转换影响）：**

```powershell
git hash-object --no-filters docs/evidence/palette-threshold/readings.json
git hash-object --no-filters docs/evidence/palette-threshold/ramp-test-4x.png
```

- `readings.json` blob `3ec83f46608fa8a7014ed88afcebc497f679382d`
- `ramp-test-4x.png` blob `7c7fa137eeb49a272079c085667a42705fe0aca3`

连续两次运行，上述两个 blob 与脚本重复运行产出的 blob 完全一致（实测：连跑两次 + 与已入库 blob 三方比对，均相同）。脚本内色值、ζ 均为固定参数，无随机、无时间戳；若修改了 `de2000.mjs`，自检会在生成前抛错。

注：`ramp-test-4x.png` 是二进制，blob 与工作区文件一致；`readings.json` 是文本，`core.autocrlf=true` 检出后为 CRLF，所以对工作区文件算 sha256 会与上表不同，但 `git diff` 无内容差异（只是换行转换）。直接比对上面的 blob 值即可。

---

## 附：`audit-palette` 误报修复的红 → 绿读数

修复提交 `3228fa5`（分支 `feat/palette-audit-fix`，父提交 `main@a03a1cb`）。

### 病因

渲染层不直接读 `WORLD.x`：调用点写 `paletteFor().x`、形参 `palette: WorldPalette` 的 `palette.x`、或 `const c = pack.palette; c.x`。旧版审计只数 `WORLD.x`，于是把这些读点全漏了，反过来把它们报成「未引用」——闸门自己撒谎。

### 修法

- 静态识别色板绑定：类型标注 `WorldPalette` / `Readonly<Record<WorldColor, number>>` / `SettingPack['palette']`，以及 `const x = paletteFor() / worldPalette() / *.palette` 的别名声明。
- `<binding>.<token>` 计为静态引用；`<binding>['token']` 字面量下标同样是静态引用。
- `<binding>[expr]` 的非常量下标（`palette[primary]`、`palette[look.cloak]`、`palette[BRIGHT[self]]`）单列为**动态引用**，不静默算作已用。
- 别名表：读到 `TERRAIN_COLORS.x` 时同时记到它指向的 `WORLD` 槽；`terrainFor()[...]` 整表动态读按静态别名解析展开（别名内容是源码里的固定映射，可证）。
- 已知排除项：`building.palette.trim` 是 prefab 槽位，不是 `WORLD.trim`；用负向前视避免把「别人的 `.palette`」算进来。

### 修前（`main@a03a1cb`，沿用旧脚本）

```
世界层唯一色：24 / 24（over 0）
palette.ts 未引用 token：19 项
  grass, grassLit, farm, pale, terracotta, moss            ← 用户点名的 6 条误报
  TERRAIN_COLORS.grass / soil / water / stone / mud / tree / shallow / coal   ← 8 条别名误报
  TERRAIN_SPECK.grass / stone / plaza / farm / tree        ← 5 条，确实无读点
引用处数：95
```

### 修后（同一份源码树）

```
世界层唯一色：24 / 24（over 0）
静态可证引用（WORLD 槽）：24 / 24
动态引用（静态不可判定）：无（所有 24 槽都有静态读点）
未引用（无任何读点）：TERRAIN_SPECK.grass, TERRAIN_SPECK.stone,
                      TERRAIN_SPECK.plaza, TERRAIN_SPECK.farm, TERRAIN_SPECK.tree
引用处数：831
```

- 用户点名的 6 条全部消失；剩下的 5 条是 `TERRAIN_SPECK` 别名表——`src/`、`test/`、`scripts/` 里都没有读点，属 dead data（不是 dead color）。
- **没有用白名单消误报**：绑定识别是静态可证规则，动态下标单列。
- 动态下标确实存在 6 处（`region-paint.ts:370/392/394` 的 `palette[primary]`/`palette[accent]`、`terrain-edges.ts:310/312` 的 `palette[BRIGHT[self]]`/`palette[DARK[self]]`、`villager.ts:194` 的 `palette[look.cloak]`），但它们的候选集合里每个槽都另有静态读点，所以「仅动态引用、静态不可判定」的槽为 0；报告里保留 `dynamicReadSites` 明细，未来若某槽只经字符串拼接取用，会落进 `dynamicWorldTokens` 而不是被当成已用。
- `refs` 从 95 涨到 831 不是「颜色变多了」，是**旧口径漏读**；两版读数不可直接比较。
