# 光照查漏补缺 · G2 / G3 / KB4 证据（lighting-gaps）

- 日期：2026-11-07
- 分支：`feat/lighting-gaps`
- 证据跑时的 HEAD：`5075d71`（本批改动尚未提交，见 R5）
- 改动位置：
  - [contact-ao.ts](../../../world-client/src/render/contact-ao.ts)（新）：`shouldDrawContactAo` + 未知基底计数
  - [buildings.ts](../../../world-client/src/render/buildings.ts)：AO 改走 `shouldDrawContactAo`，接触暗部 `ink` 0.12
  - [contact-ao.test.ts](../../../world-client/test/contact-ao.test.ts)（新）：未知 / 已知基底的计数单测
  - [SandboxScene.ts](../../../world-client/src/scenes/SandboxScene.ts)：`renderStats().contactAoUnknownBase`、`debugLampLocalShade`
  - [debug-panel.ts](../../../world-client/src/ui/debug-panel.ts)：`debugLampLocalShade` 的可选调试口
  - [setting-scenery.ts](../../../world-client/src/render/setting-scenery.ts)：有芯的光（纸面 warmLight 叠层）+ 三档 ink 局部压暗
  - [check-ground-shadow.mjs](../../../world-client/scripts/check-ground-shadow.mjs)：`[G3 基底未知]` 计数断言
  - [check-glow-contrast.mjs](../../../world-client/scripts/check-glow-contrast.mjs)：ratio 定义式、反解、三相位、机制对照、停手判据

> **本仓未接入 `audit:reports` 闸门。** 仓内没有 `audit:reports` 这个 npm script，`docs/` 下也没有对应配置。
> 下面的 R1–R7 是按报告纪律**手工**填的：闸门缺席不等于证据缺席。

## 一句话

`groundBase` 未知时**不再默认画**：AO 改走 `shouldDrawContactAo`，未知基底 → 不产出矩形并累加计数；
单测断言「已知基底不计入未知」，现场 `renderStats().contactAoUnknownBase` 实测 **0 次**（非 0 即红）。
KB 要点 4 的判据补成可反解的：`ratio = (meanL(patch) − meanL(annulus)) / 255`，8 位 sRGB 的 Rec.601 平均、
**不线性化**；由此反解 dusk 目标 annulus = `patch − 45.9`：旧 patch 84.65 → **38.75**，改后 patch 99.24 → **53.34**。
光池按这个靶子改成「有芯的光」（纸面 warmLight 叠层 + 三档 ink 局部压暗，未新增色），读数
dusk **0.065** / noon **0.026** / dawn **0.065**；仍不达 0.18。两条路都已到上限：patch 顶到 **101.91**（需 125.77），
压暗 α=1 实测 **0.093**。**同源核对后结论降级**：`0.18` 是 KB 的**暂定值**，没标定、没写单位、没写 dim 前/后，
所以只能说「当前几何（8×8/32×32 世界 px）+ 当前 dim（ink 0.16）+ 现有 24 色下，dusk 上界 **0.09–0.10**」；
「必须改美术模型」**不成立**，冲突登记在 `OPEN_ISSUES.md` G1（先钉判据形式 / 是否放宽全局 dim）。

## 1. G2：晨 / 午 / 昏跑同一条判据

判据：同机位开/关，按实现自己的段宽切 ROI，取段内平均亮度差；**相邻两段相对落差 ≥ 25%**
（`G2_MIN_REL_DROP = 0.25`，见 [check-ground-shadow.mjs](../../../world-client/scripts/check-ground-shadow.mjs) 断言旁注释）。
单段样本（正午人物 span=1）只要求「有影且 >0」，不套两段判据。

### 绿跑读数【测】（2026-11-07 16:59，exit 0）

| 相位 | 摊位 内 / 中 / 外 | 内→中 落差 | 中→外 落差 | 人物 |
| --- | --- | --- | --- | --- |
| dawn | 9.26% / 4.46% / 1.56% | 51.8% | 65.0% | 5.91% / 1.28%（2 段，落差 78.3%） |
| noon | 8.20% / 2.97% / 1.54% | 63.8% | 48.1% | 4.84%（单段，>0 即可） |
| dusk | 9.54% / 4.50% / 2.22% | 52.8% | 50.7% | 13.09% / 5.14% / 3.30%（60.7% / 35.8%） |

数字是「关−开」的亮度差相对基底的百分比，越大越深。全部相邻段 ≥ 25%，无红色。

### 红跑读数【测】（同一判据，把 G2 相关三个文件回退到 `HEAD~1`；2026-11-07 16:07，exit 1）

| 相位 | 摊位 内 / 中 / 外 | 内→中 落差 | 中→外 落差 | 人物 |
| --- | --- | --- | --- | --- |
| dawn | 9.26% / 8.17% / 4.90% | **11.8%（红）** | 40.0% | 5.91% / 3.15% |
| noon | 8.20% / 8.20% / 5.13% | **−0.0%（红）** | 37.4% | 4.84%（单段） |
| dusk | **4.78% / 10.10% / 8.68%（倒挂）** | **−111.3%（红）** | **14.0%（红）** | **13.09% / 13.09% / 13.09%（0.0%，红）** |

红跑共 6 条失败：晨摊位、午摊位、昏摊位 ×2、昏人物 ×2。**晨、午各有独立红条**
（旧实现只测黄昏会漏掉这两种），这正是上一轮要求补测的原因。

### 内芯锚定规则（一句话）

> **内芯锚在「相位的根」——即贴物体那一端，不是固定左/右端；根在哪由 `dx` 的符号决定
> （晨/午 `dx≥0` 根在左，黄昏 `dx<0` 根在右）。**

同一句话也写在 [ground-shadow.ts](../../../world-client/src/world/ground-shadow.ts) 的 `shadowSegments` 文档里，
不只体现在代码分支里。

## 2. G3：按基底 token 多样本量 ΔL（接触暗部）

AO 那一块 4×4 压在**楼左侧地面**，不在墙面：本设定集各 prefab 的墙体 `body` token 本来就不同
（terracotta / copper / charcoal / timberDark），但 AO 落点是地面格，所以真正变化的是**基底地形 token**。
样本取 `(origin.x−1, origin.y+footprint.h)` 这一格。建筑层现在拿得到这一格的底色
（`SandboxScene.terrainBaseOf` → `createBuilding(..., groundBase)`），钳制才有依据。

### 2.1 AO 不许提亮：钳制 + 断言

实现（[buildings.ts](../../../world-client/src/render/buildings.ts) + 新模块
[contact-ao.ts](../../../world-client/src/render/contact-ao.ts)）：

```ts
if (contactAoEnabled()) {
  const shade = paletteFor().ink;         // Rec.709 亮度 23.16，比所有地形基底都暗
  if (shouldDrawContactAo(groundBase, shade)) {   // 基底未知 → 不画，并计数
    g.fillStyle(shade, 0.12);
    g.fillRect(-4, h, 4, 4);
  }
}
```

```ts
// contact-ao.ts（纯模块，不依赖 Phaser）
export function shouldDrawContactAo(groundBase: number | undefined, shade: number): boolean {
  if (groundBase === undefined) {      // 「不知道」≠「安全」：不画，且记一次
    unknownBaseCount += 1;
    return false;
  }
  return lumaOf(shade) < lumaOf(groundBase);
}
```

- **为什么换色**：`deepShade` 的亮度 44.33，**高于最深的 mud 基底**（soil `#202b35`，41.38），
  叠上去实测 −0.79（提亮）。一个叫「接触暗部」的东西变亮是语义错误，所以阴影色换成 24 色里最暗的
  `ink`（23.16）。`mud` 现在读 +1.79（仍 <6，见 2.4 的深底放弃）。
- **钳制**：合成后比基底亮时**不产出矩形**（`lumaOf(shade) < lumaOf(groundBase)`）。
- **未知基底不再默认画**（本批修正）：上一版把 `groundBase === undefined` 写进「画」的分支，
  等于把「不知道」当「安全」。现在未知 → 不画 + `unknownBaseCount += 1`；这个计数只在
  `contactAoEnabled()` 且真走到 `createBuilding` 时累加，别处不计。
  - **测试断言**：`test/contact-ao.test.ts` 断言「undefined → false 且计数 +1」、
    「已知基底（mud/grass/stone/plaza）→ true 且计数不变」、「charcoal 对 mud 为 false 但**不计入未知**」
    （那是「提亮」分支，不是「取错落点」）。
  - **现场断言**：`renderStats().contactAoUnknownBase` 由
    `check-ground-shadow.mjs` 逐样本读回并汇总，**非 0 一律红**——因为非 0 只可能说明
    `terrainBaseOf({ x: origin.x−1, y: origin.y + footprint.h })` 取错了格。
  - **本批实测【测】**：6 个样本全为 0，汇总 `[G3 基底未知] 0 次`，判据绿（exit 0）。
- **ΔL > 0 断言**：`check-ground-shadow.mjs` 对**所有**样本（pinned / dark / occluded）先判
  `ΔL > 0`；`ΔL ≤ 0` 一律红，不再看角色。
- **红样例**（临时把阴影色改浅到 `charcoal` 50.66，跑完立即恢复 `ink`）【测】：

  | 样本 | 基底 | 红跑 ΔL | 可见像素 | 结果 |
  | --- | --- | --- | --- | --- |
  | lamp_workshop#1 | mud 41.32 | **0.00** | **0/64** | 被钳制 → 不产出矩形 → 断言红 |
  | soot_forge#1 | stone 90.55 | 4.78 | 64/64 | 连带跌破下限（改浅色同时变淡） |
  | ferry_station#1 | stone 87.00 | 4.37 | 64/64 | 同上 |

  红条原文：`G3 lamp_workshop#1（mud，dark）ΔL 0.00 ≤ 0：接触暗部没有压暗基底
  （阴影色比基底亮，已钳制为不产出矩形）`。恢复 `ink` 后重跑绿（exit 0）。

### 2.2 绿跑读数【测】（`ink` @ 0.12，exit 0）

| 样本 | 基底 token | 基底 luma | 开后 luma | ΔL | [6,14] | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| lamp_archive#1 | **plaza（最亮）** | 134.09 | 121.16 | **12.93** | 内 | 钉住 |
| soot_forge#1 | stone | 90.55 | 82.66 | **7.88** | 内 | 钉住（可读最暗） |
| ferry_station#1 | stone | 87.00 | 79.54 | **7.46** | 内 | 钉住（同档第二例） |
| boiler_annex#1 | stone | 116.40 | 110.41 | 5.99 | 外 | **放弃：遮挡**（可见 48/64 px） |
| tea_stall#1 | grass | 64.90 | 60.11 | 4.79 | 外 | **放弃：深底** |
| lamp_workshop#1 | **mud（最深）** | 41.32 | 39.53 | 1.79 | 外 | **放弃：深底**（已不再提亮） |

上一批基线（`deepShade` @ 0.15，同一脚本）曾读 13.28 / 6.77 / 6.24 / 5.18 / 2.93 / −0.79；
本题换成 `ink` 后，所有基底都进入「ΔL > 0」，代价是最亮端往下走（12.93）、可读最暗端往上走（7.46）。

### 2.3 窄带声明（判据规则，不是现状修饰）

> **本判据是窄带判据。** 带 `[6,14]` 只有 8 宽；本题钉住样本跨度 12.93 − 7.46 = 5.47（占 68% 带宽）。
> 触发线 = **任一端余量 < 5%**（上端 `14 − maxΔL`、下端 `minΔL − 6`；余量为负即越界，同样红）。
> **触发时重新配平 `AO_ALPHA` / 阴影色，不许放宽 `[6,14]`。**

当前实测（2.2）：上端余量 **1.07（7.7% of 14）**，下端余量 **1.46（24.3% of 6）** → 当前未触发。

**必须写清的偏差**：上一批 `deepShade`@0.15 的读数 13.28 / 6.24 两端余量 5.1% / 4.0%，那是旧配置的窄带；
本批按 2.1 换成 `ink` 之后，**两端同时 <5% 在数学上不可能**：

- 要两端都 <5%：上端需 `ΔL ≥ 13.30`、下端需 `ΔL ≤ 6.30`，即要求
  `(134.09 − s) / (87.00 − s) ≥ 13.30 / 6.30 = 2.111`（s = 阴影色 luma）。
- 但 2.1 要求 s 必须 **< 41.32**（否则 mud 又会被钳制、ΔL=0）。在这个区间里该比值最大只有
  `(134.09 − 41.32) / (87.00 − 41.32) = 2.031 < 2.111`；实测是 `107.75 / 62.17 = 1.733`。
- 结论：不是判据被改宽，而是「任一基底必须压暗」这条语义把下端推离了 6。这里的规则从「两端 <5%」
  改为**「任一端 <5% 触发」**，并保留旧读数作为触发线的历史例子。

**会变红（或吃掉余量）的情形**：

1. **token 微调**：plaza / stone / ferry 的 hex 或地形映射变亮变暗（±1 luma ≈ ΔL ±0.12）；上端只剩 1.07，
   plaza 再亮约 9 luma 就顶到 14。
2. **luma 口径 / 色调曲线变化**：Rec.709 ↔ Rec.601、相位 dim、tone mapping 改动，会让基底与开后值整体漂移。
3. **换世界包**：`paletteFor()` 不再是 dengchao，所有 token luma 与地形色都变。
4. **α / 阴影色改动没同步脚本常量**：`AO_ALPHA`、`AO_SHADE_LUMA` 必须与 `buildings.ts` 同值；
   α 从 0.12 抬到约 0.13 就会把 plaza 推过 14。
5. **新增 pinned 样本落在基底 41.32–73.16**：低于可读门槛 73.16（`ink + 6/0.12`），会以「基底低于门槛」红。
6. **渲染口径变化**：zoom / DPR / AA / 材质叠加改变 ROI 采样，ΔL 会跟着变。
7. **noon 相位 dim 不再为 0**：AO 读数是在 noon 的干净帧上取的，基底变暗会让 ΔL 变小。

### 2.4 放弃样本：按原因分开登记

| 原因 | 样本 | 基底 | 实测 ΔL | 处置与理由 |
| --- | --- | --- | --- | --- |
| **遮挡** | `boiler_annex#1` | stone（ROI 实测 116.40，混合基底） | 5.99 | 墙角被静态上层压住：on/off 只有 **48/64** 像素变化，另 16 px 不变；由 `116.40 = 0.75×98 + 0.25×172` 推得被压住的那一角约 172 luma 的静态亮层。不是角色、不是取景角度。 |
| **深底** | `tea_stall#1` | grass 64.90 | 4.79 | 单一全局 α 拉不进带：要 ≥6 需 α ≥ 0.144，同 α 把 plaza 顶到 15.97 > 14。 |
| **深底** | `lamp_workshop#1` | mud 41.32 | 1.79 | 要 ≥6 需 α ≥ 0.329，plaza 会到 36 以上；已确认只压暗、不提亮。 |

**遮挡那条值不值得换取景补测？不值得。** 遮挡物是静态层（z-order 在 AO 之上），2D 下换机位不会改变
层次关系；48/64 的读数在三次跑（绿、红、绿）里稳定复现。唯一能复测的路子是**改层次**（让 AO
画在那层之上，或把那一角让出来），那是设计改动，不是补拍。因此它只登记、不参与带内判定。

### 2.5 为什么「三种 token 都进带」做不到（放弃理由，不是 α 没调够）【推】

- `ink` 能压暗所有基底（2.2 全部 ΔL > 0），但幅度由 `α×(L − 23.16)` 决定，跨度是固定的：
  plaza 与 ferry 差 47.09 luma，α 0.12 下 ΔL 差 5.64。
- grass 要进带需 `α ≥ 6/41.74 = 0.144`，同 α 下 plaza `0.144×110.93 = 15.97 > 14`。
- mud 要进带需 `α ≥ 6/18.16 = 0.330`，同 α 下 plaza 会到 36 以上。
- 所以可进带的只有 plaza / stone 两档；深底两档明确放弃，读数留在 2.2 / 2.4。
- 若以后确实要求三档都进带，唯一路子是**按基底自适应 α**；那是设计改动，本轮未做，需单独批准。

## 3. KB 要点 4：发光块 vs 周边（可测判据与现状读数）

KB 原文（`D:\project\pixel-world-engine` 的 docs/DESIGN_ACCEPTANCE.md，另一棵只读树，不在本仓）：

> 黄昏固定机位下，以最亮窗/灯为中心取 8×8 patch、其外 32×32 环形 annulus，要求
> `(meanL(patch) − meanL(annulus)) / 255 ≥ 0.18`；同一机位 `noon` 相位的同一 patch 该比值必须 `< 0.10`；
> annulus 内至少出现 3 种地形 token 色。

### 3.1 判据的可测形式（取样区域 / 阈值 / 比较对象）

- **取样区域**：固定机位 = `lamp_post_10` 的池心 `(832,522)`，zoom 1，视口 1010×700。
  该帧 `debugLampUnits()` 里逐盏量灯体 8×8 世界像素，取最亮的一盏；中心 = 它 8×8 内最亮的像素。
  patch = 中心 ±4 世界 px；annulus = 中心 ±16 世界 px 方框减去 patch（即「其外」）。
- **单位**：8×8 / 32×32 按**世界像素**（= 设计像素）。截图是 2× 渲染，所以截图里 patch 16×16、
  annulus 64×64。理由：截图像素口径下 annulus 只有 16×16 世界 px（一格），一格只有一种地形，
  KB 的「≥3 种地形 token」永远不可能满足——两条要求只在设计像素口径下自洽。另报截图像素口径
  （4×4 / 16×16 世界 px）作灵敏度参照，不参与判定。
- **阈值**：dusk `ratio ≥ 0.18`；noon `ratio < 0.10`；annulus 内 ≥3 种地形 token
  （按最近 token 色分类，RGB 距离 ≤60、覆盖 ≥1% annulus 像素才算「出现」）。阈值原样照抄。
- **比较对象**：noon 用**同一个世界中心**、同一机位、同一 patch/annulus；灯在 noon 强制关
  （`debugForceLamps(false)`），否则「白天的灯还亮着」会把 noon 对照废掉。
- **亮度**：Rec.601 `0.299R+0.587G+0.114B`，与 KB 的读数脚本 measure-design-readouts.mjs 同口径。

### 3.2 ratio 的定义式（可反解，不是一句「实测 0.012」）

```text
ratio = (meanL(patch) − meanL(annulus)) / 255
```

- **不是** `(patch − annulus) / patch`：分母是 **255**（8 位满刻度），不是 patch 自身。
  若按 patch 归一，0.18 只需 `0.18 × 84.65 = 15.24 luma`，和 KB 的 45.9 差三倍——定义先错，靶子就错。
- `meanL` = 对**最终帧**逐像素取 Rec.601 `0.299R + 0.587G + 0.114B`，再算术平均；
- 取浏览器截图里的 **8 位 sRGB 值**（0..255），**不做线性化**、不取亮度 Y、不拆层重算；
- 相位 dim、光池、灯体、AO 全部已烘进这张最终帧——量的是「玩家看到的那张图」。

因此 `ratio ≥ 0.18 ⇔ patch − annulus = 0.18 × 255 = 45.9 luma`。反解两条，改光池时以它们为靶子：

```text
annulus_target = patch − 45.9          （固定 patch，问 annulus 要降到多少）
patch_required = annulus + 45.9        （固定 annulus，问 patch 要升到多少）
```

### 3.2b KB 要点 4 的判据形式与来源几何（同源核对）

**结论先说：不同源。`0.18` 不是任何一次测量的产物，是 KB 作者写下的暂定值。**

1. **来源**：`D:\project\pixel-world-engine\docs\DESIGN_ACCEPTANCE.md` 要点 4，
   首次出现在 `ea762a6d20c9de77399b77fcd5463144bf0618f9`（2026-11-06，guoyu，
   "把 8 条设计要点写成可执行判据"）。原始素材只有一句画册引文 `p037_L`（72）——
   *"by reducing the surrounding colors, the color shined like gold."* —— **引文里没有任何数字**。
   `0.18` / `0.10` 是那次提交**新写**的阈值，不是从素材里读出来的。
2. **文档自己怎么标**：判据形态是 `像素（阈值暂定，须标定）`；第 105 行写「暂定值 `0.18` 先不进闸门；
   `dusk` 与 `noon` 两张标定图落地后再钉」；第 225 行把 `0.18` 列进「暂定」类，要求「必须在同一份提交里
   附标定截图和旧值→新值的原因」。**KB 仓库内不存在这两张标定图**：`0.18` 只出现在该条判据（读数器只在输出行把它当常量打印），
   KB 自带的读数器头部也写「阈值（0.18 / 2 / 8 / 4）仍是暂定值」。所以**「谁测的」= 没有人测**。
3. **几何与单位**：判据文字写「8×8 patch、其外 32×32 annulus」，**没写单位**。KB 自带的
   `measure-design-readouts.mjs` 把 `patchSize = 8`、`outer = 32` 直接套在**传入截图**的像素上
   （[measure-design-readouts.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/measure-design-readouts.mjs#L126-L137)）。
   三种读法都成立、数值都不同：

   | 读法 | 8×8 的世界等效 | 32×32 的世界等效 | 与本仓实测（8×8 / 32×32 世界 px）的关系 |
   | --- | --- | --- | --- |
   | KB 读数器：截图 px（本仓 ≈2 截图 px/世界 px） | 4×4 | 16×16 | 我们是它的 **2 倍线性**（4 倍面积） |
   | 4× 截图口径（要点 8 的标定说明用的就是 4×） | 2×2 | 8×8 | 我们是它的 **4 倍线性** |
   | 世界 px（我们采用） | 8×8 | 32×32 | 同口径 |

   面积占比恒为 `64 : 960 = 6.67%`，但 annulus 覆盖的世界范围从 ~1 格到 ~2 格变化，
   装进去的地形/立面完全不同——**同一个比值在两套几何下不是同一个量**。
   本仓 `check-glow-contrast.mjs` 的 `scale = 2 × zoom` 即上表的「截图 px」换算。
4. **形式**：判据原文是 `(meanL(patch) − meanL(annulus)) / 255 ≥ 0.18`，即**绝对 luma 差**归一化到 255；
   `45.9 = 0.18 × 255` 是一步乘法，没有别的换算。**不是** WCAG 式 `(Y亮 + 0.05)/(Y暗 + 0.05)` 比值。
5. **帧态（dim 前 / 后）**：**未定义**。判据只说「黄昏固定机位…截图」，KB 读数器吃的是最终截图，
   等价于 **dim 后**；但 `0.18` 从未标定，所以「dim 前的读数」根本不存在。我们拿 dim 后的帧套它，
   是**形式未定**的比较，不是同一次测量。

**绝对差与全局 dim 的关系（这一条决定结论能不能上升到「改美术模型」）**：

全局 dim 把两端同比例压缩，**绝对差随压缩变小、比值不变**。dusk 的 dim 是 `ink` α0.16，
即 `L' = 0.84 L + 2.79`。所以：

- 若 `0.18` 原本指 **dim 前的绝对差**，压暗后的等效阈值是 `45.9 × 0.84 = 38.56`；
  我们拿 45.9 套压暗帧就是**偏严**，不能据此判「美术模型不行」。
- 把读数换回 dim 前：dusk gap **19.61**（对 45.9）、noon gap **7.94**（对 25.5）、
  patch 上限 **118.00**、压暗 α=1 的 annulus **86.46** ⇒ 两杠杆叠加的上界
  `(118.00 − 86.46)/255 = 0.124`；dim 后是 `(101.91 − 75.42)/255 = 0.104`。
  **两种口径都不够，但数字不同**——所以数字必须带口径写。
- 判据的反例写「全屏压暗而不动发光块：比值同样抬高」。这句话只在**相对量**下成立；
  对绝对差，压暗只会让差**变小**。**公式与反例论证用的不是同一形式**，这是 KB 自己的内部不一致。

**如果判据的实际意图是相对量**（用户问的第二分支），同一组实测会得出完全不同的结论：

| 形式 | dusk | noon | α=1 上界 |
| --- | --- | --- | --- |
| `(patch − annulus)/255`（KB 原文，现行） | 0.065 | 0.026 | 0.104 |
| `(patch − annulus)/annulus` | **0.199** | **0.074** | 0.316 |
| `(patch − annulus)/patch` | **0.166** | **0.069** | 0.240 |

换成后两种相对形式，**dusk 与 noon 会同时通过**。所以「到不到 0.18」首先是**判据形式没钉死**，
不是世界达不到。

**对上一轮结论的修订**：`0.18` 没有标定、没写单位、没写 dim 前/后，且反例论证与公式形式不一致。
按「判据和它比的对象必须来自同一次测量」，**「必须改美术模型」不成立**。可写的结论只有：

> 在**当前几何（8×8 / 32×32 世界 px）、当前 dim（`ink` 0.16）与现有 24 色**下，
> dusk 的上界约 **0.09–0.10**（`0.093` 单靠压暗 / `0.104` 两杠杆叠加）；
> 要达 `0.18`，需先决定「是否放宽全局 dim / 判据是否改相对形式」，再谈是否改美术模型。

判据冲突已登记在 [OPEN_ISSUES.md](../OPEN_ISSUES.md) 的 **G1**（谁定的、差在哪、要不要改形式）。

### 3.3 反解：annulus 要降到多少【算】

> 以下按 KB 原文的 `45.9` 口径反解（`45.9` 是**暂定值**，来源与形式核对见 3.2b；结论据此降级）。

| 口径 | patch | annulus 现状 | 目标 annulus = patch − 45.9 | 还差 |
| --- | --- | --- | --- | --- |
| **改前（上一批读数，用户问的那个）** | 84.65 | 81.49 | **38.75** | 42.74 |
| **改后（有芯的光）** | 99.24 | 82.77 | **53.34** | 29.42 |
| noon 对照（改后，上界不是下界） | 96.30 | 89.63 | 不能低于 70.80 | 现状高 18.83 → 过 |

### 3.4 光池半径 / ADD 扩散范围要缩到多大【测+算】

**缩到 0 也不够。** 同机位、同中心、灯全关（`debugForceLamps(false)`）的 annulus 是任何光池改动
都到不了的**下限**（光池只会往上加）：

| 量 | 值 |
| --- | --- |
| 灯全关 annulus / patch | **79.87 / 84.65** |
| 光池贡献（开灯 − 关灯） | **+2.90** |
| 目标 annulus（改前 / 改后） | 38.75 / 53.34 |
| 关灯后仍差 | **41.12 / 26.52** |

把光池半径缩到 0 最多回收 2.90 luma，缺口是它的 9–14 倍。**「缩光池」不是这条判据的杠杆。**

### 3.5 patch 提亮的上限：也不够【测+算】

用同一帧开灯/关灯两张图逐像素比，luma 差 ≥5 的像素算「灯的地盘」：**56/256 像素 = 21.88%**。
把这块地盘里每个像素都推到该帧最亮的 165.1（实测峰值）：

| 量 | 值 |
| --- | --- |
| patch 现状 | 99.24 |
| patch 上限（不扩足迹、不新增色） | **101.91** |
| 需要（annulus 取环境最低 79.87） | **125.77** |
| 差 | **23.86 luma** |

要补这 23.86，只能让发光块从 21.88% 占到约 65%——**把灯画得比 7×9 灯体更大**（超出既有美术边界），
或换一个比 `warmLight` 更亮的色（红线：不许新增色）。两条都不成立 ⇒ patch 路线关闭。

### 3.6 三种相位读数【测】（2026-11-07，`check-glow-contrast-three-phase.log`，exit 1）

| 相位 | 灯态 | patch meanL | annulus meanL | ratio | 阈值 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| dusk | 强制点亮 | 99.24 | 82.77 | **0.065** | ≥ 0.18 | **不过** |
| noon | 强制关闭 | 96.30 | 89.63 | **0.026** | < 0.10 | 过 |
| dawn | 强制点亮（仅读数） | 102.64 | 86.16 | **0.065** | KB 无阈值 | 仅参照 |

- patch 内色阶 dusk **6 级** ≥ 4（KB 反例护栏：没被提亮成一片纯色）。
- dawn 比 dusk 的 annulus 亮 3.39 luma、patch 亮 3.40，比值同为 0.065——说明这条对比是
  「灯相对周边」而非「晨昏绝对亮度」。
- annulus 地形 token（noon 帧）5 种（grass 26.15% / charcoal 19.17% / soil 1.56% / plaza 1.46% / farm 1.04%），
  `classifiedShare` 仅 0.497，大份额来自立面/屋面——**仍只是名义满足**，不能当「三种地面 token」的证据。

### 3.7 机制：`localSurroundSuppression` 凭什么能变真【测】

**实现**：全屏相位 dim（压整帧）+ 灯/窗光池 + **每盏灯三档 `ink` 局部压暗**
（环带 `[5,9)/[9,13)/[13,17)` 世界 px，α 0.20/0.13/0.08，画在 `lampLight` 层，中心留给灯芯）。

**判据**：同一冻结帧、同一机位、同一全屏 dim，只拨 `debugLampLocalShade` 一个开关：

| 量 | 压暗开 | 压暗关 | 差 |
| --- | --- | --- | --- |
| annulus meanL | 82.77 | **84.30** | **+1.53 luma** |
| patch meanL | 99.24 | 99.24 | **0.00** |

- 门槛 1.0 luma（量化噪声上限 ~0.01，量的是 960 个 annulus 像素的均值）。
- 回升 **不能来自 dim**（dim 一个字都没动），也**不是「把灯芯挪走/改亮」**（patch 变化 0.00）
  ⇒ 只能来自「周围的 ink 环带被撤掉」。这就是「真压低」的可测证据，不是名义 token 数。
- **幅度要说清**：1.53 luma 只证明**机制在**，不证明**幅度够**——比值仍是 0.065。
- 为什么只有 1.53：inner 环被光晕/灯芯盖住，外环大部分被 depth > 700 的构件/楼体压住；
  α=1 的直测实验里真正被压到的环带像素只有 **2.02% / 13.95% / 22.26%**
  （低 α 线性外推会高估成 2.86% / 24.09% / 35.42%，以 α=1 直测为准）。

### 3.8 停手条件：逐条核对 ⇒ **这条要改美术模型**

| 条件 | 核对 | 结论 |
| --- | --- | --- |
| ① 光池扩散超出既有美术边界 | patch 路线要发光足迹从 21.88% 扩到 ~65%（大于灯体）；压暗路线要把 `ink` 画到楼体/构件之上（改 z-order） | **触发** |
| ② 必然产生裁剪 | 达标靠**压暗**不靠增亮，不需要新增裁剪；现状 576 px 裁剪在「灯开 / 灯关 / 压暗关」三帧完全相同、max 同为 255/241/173 ⇒ 既有 **ADD 窗光**，非本轮引入 | 未触发（但红条照留） |
| ③ 必须新增色 | 24 色里最暗的 `ink` 推到 α=1（完全不透明）实测 annulus **75.42**、ratio **0.093**，仍不到 0.18；再往下只能加更暗的色或改全局 dim | **触发** |

α=1 那轮是**临时实验**：把 `LAMP_SHADE_RINGS` 三档 α 全改 1、跑完立即恢复 0.20/0.13/0.08，
产物留在 `check-glow-contrast-alpha1.log`（含比值 0.093、环带覆盖 2.02% / 13.95% / 22.26%）。

**结论（按 3.2b 的同源核对修订）：**

- 可以立的只有：在**当前几何（8×8 / 32×32 世界 px）、当前 dim（`ink` 0.16）与现有 24 色**下，
  dusk 的**上界约 0.09–0.10**（`0.093` 单压暗 / `0.104` 两杠杆叠加）。
- **不能立**「必须改美术模型」：`0.18` 是暂定值、未标定、单位与 dim 前/后都未写，
  拿 dim 后的帧套 dim 前的绝对差是**不同源比较**（见 3.2b）。
- 监测门槛 `①②③` 中的 ①③ 只是在「0.18 这个数值有效」的前提下成立；现在这个前提没被证明，
  所以它们降级为「当前参数下的上界，而不是世界的上界」。
- 本批仍然**停手**（不为凑读数扩容），但停下的是**调参**，不是「已证明要改美术模型」。
  下一步要么钉死判据形式（相对量会让 dusk/noon 同时过），要么决定是否放宽全局 dim；二者都是判据问题，
  不是美术参数问题。

### 3.9 改前基线（历史读数，保留下限）

| 相位 | patch | annulus | ratio |
| --- | --- | --- | --- |
| dusk（无芯、无压暗、光晕 14×9） | 84.65 | 81.49 | **0.012** |
| noon（同一世界中心） | 96.30 | 89.63 | 0.026 |
| 截图像素口径参照 dusk / noon | 88.48 / 100.80 | 84.20 / 95.75 | 0.017 / 0.020 |

改前机制是**全屏 dim + ADD 光池**，`localSurroundSuppression` 在脚本里写死 `false`；
本批用「同一帧只拨压暗开关」把这条判据变成可测，并实测为真（3.7）。

## 4. R1–R7 结构化块

### R1 产物（哈希与字节）

| 文件 | 字节 | sha256 |
| --- | --- | --- |
| `check-ground-shadow-green.log` | 2676 | `8f326aa75aac4887897eb338d12218dcf5c4a21878bc68c317e70e98171a93fa` |
| `check-ground-shadow-unknown-base.log`（本批） | 2752 | `704ccfea34c88ecdab5d4d5f6ec5a1a72de67fa2c13a57055f0cfe43e88de434` |
| `check-ground-shadow-red-ao.log` | 3000 | `e5fe55ed15e3a574fd016c15383a00b0163fd71b7987f55f8b4916bd49921331` |
| `ground-shadow.json`（本批覆盖） | 52020 | `92173c9c7ec99a235a75d0c22bd628ef7c5c870ccff91b5fc1688c6eefff4eeb` |
| `ground-shadow-ao-on-soot_forge-1.png` | 37942 | `68fc3061568b842bd636cf541e46a6ca95a38092221e89d11dec6e2e7bae2a49` |
| `ground-shadow-ao-off-soot_forge-1.png` | 37785 | `629c95238974664693206ee6a74f6586c2d20468772146c74e6d029e5e03060b` |
| `check-glow-contrast.log`（上一批历史） | 926 | `598822a5ba42d468ed36465cf4940422ac79ad0422911468c9153e63644ef807` |
| `check-glow-contrast-three-phase.log`（本批） | 2689 | `31210798ec7eb0f8f965165e762d2c30905cbfbcdcd3cf3fbc373783701c7905` |
| `check-glow-contrast-alpha1.log`（本批临时实验） | 2629 | `e58d2758bca42769f3150f92ab94681acd48822d29c3e3d14905b42b4fa3067c` |
| `glow-contrast.json`（本批覆盖） | 10825 | `2678e0ff389273fb1c6d66e053dee0d08560e21a3e4563d3393e71e855094fc3` |
| `glow-dusk.png`（本批覆盖） | 39956 | `f3146547b81acfec35b5d24a67783d2f4ae58ed8e720db77944b233a97ae07f2` |
| `glow-dusk-off.png`（本批） | 33751 | `2e6a6d4cbd305f616c16fcaf18523b7a20de8af63b4ce6bf9d5badbead7e8256` |
| `glow-dusk-noshade.png`（本批） | 37863 | `ab959726559306737d272f430efcf36f7e256b4c61a29aba3c0251629e11fd3d` |
| `glow-noon.png` | 32786 | `eba73394100ceb059f2cf411288b22f09109b15e6e4175ec21af09617118a2f2` |
| `glow-dawn.png`（本批） | 45816 | `fa6b648dc3665f735921133f55e1f8d66f12ba9d286fe1dd1f0ebd622b455083` |
| `ao-scan-alpha012.log` | 2714 | `dbda315106697d2c52afd1405a8afd5bb4d13171ef0a12405393c818965c707c` |
| `lighting-g1-dusk-4x.png` | 50059 | `85d327b343998f6f7ffeed5f75b6dd334937075ba8b6aa9cc6656f079fdfe047` |

`ao-scan-alpha012.log` 是上一批 `deepShade` 的探针，保留作 2.3 的历史基线；本批没有重跑探针。
`glow-dusk.png` / `glow-noon.png` / `glow-contrast.json` / `ground-shadow.json` 被本批覆盖，
字节与 sha 以上表为准；上一批的旧 sha 只保留在该批历史记录里。

### R2 exit（整数）

| 跑 | exit | 判据行 |
| --- | --- | --- |
| 绿（`ink` @ 0.12，G3 含未知基底断言，本批） | **0** | `[判据] 绿`；`[G3 基底未知] 0 次（须为 0…）` |
| 红（临时把阴影色改浅到 `charcoal` 50.66） | **1** | `[判据] 红（3 条）`，含 `ΔL 0.00 ≤ 0` 的语义红条 |
| KB 要点 4（本批实现，三相位） | **1** | `[判据] 红（4 条）：dusk 0.065 < 0.18；dusk / dusk 灯关裁剪各 576（既有窗光）；机制已真但幅度不够` |
| KB 要点 4 α=1 上限实验（临时，不作为交付读数） | **1** | `dusk ratio 0.093 < 0.18`，用于证明压暗路线到 0.18 不成立 |

### R3 比对口径

- **method**：G2 = 同机位 `debugGroundShadows` 开/关，段内平均亮度差 ÷ 基底；相邻段相对落差。
  G3 = 同机位 `?contactAO=0` 再开一页，`ΔL = 关(基底) − 开`，ROI 恰为 AO 的 4×4 世界像素；
  另在同 ROI 做 on/off 像素差，数「真正变了的像素」。
  KB4 = 同机位三页（`time=dusk` / `time=noon` / `time=dawn`），dusk 找最亮灯 → 8×8 世界 patch、32×32 annulus；
  noon 用同一世界中心并强制关灯；dawn 强制点亮、只作读数；另加 dusk 灯全关页（环境下限）与
  dusk 压暗关页（机制对照），再借「开灯/关灯」两图量发光足迹与 patch 上限。
  `ratio = (meanL(patch) − meanL(annulus)) / 255`（Rec.601，8 位 sRGB，不线性化）。
- **threshold**：G2 相邻段相对落差 ≥ 25%；G3 ΔL ∈ [6,14]，且**所有**样本 ΔL > 0、
  `contactAoUnknownBase` 恒 0；KB4 dusk ≥ 0.18 / noon < 0.10 / annulus ≥ 3 token /
  patch 内色阶 ≥ 4 / 最坏帧通道 <255 / 压暗关时 annulus 回升 ≥ 1.0 luma。
- **size**：视口 1010×700；`zoom` 1；画布内渲染 2×；G3 ROI 4×4 世界 px；KB4 patch 16×16 截图 px、
  annulus 64×64 截图 px（= 8×8 / 32×32 世界 px）；摊位 ROI `20 + span`；人物脚底 ROI ±48 / 上 70 / 下 16。
- **shots**：每相位 stall/villager 各 on/off 1 张；另含全关同刻 2、暂停 2、确定性 13×2 帧哈希、
  G3 6 样本 ×2 页、G1 4× 1 张、KB4 dusk/noon/dawn + dusk-off + dusk-noshade 共 5 张。
  产物只写 `world-client/tmp/screens/`，不写 `eval/screens`。
- **scope**：机位 摊位 (400,470)、人物 (400,470)，人物钉格 (23,31)；KB4 机位 (832,522)；
  潮位 1；晴；相位 dawn/noon/dusk/night；世界时刻 18:10（1090 min）；落地影 depth 3.1；
  建筑接触暗部深度随建筑层；灯压暗环画在 `lampLight`（depth 700）。

### R4 basis（哪句是测的、哪句是推的）

- **测**：2.2 六样本的基底/开后/ΔL；2.1 红样例的三条读数与 0/64 可见像素；2.4 的 48/64；
  KB4 的 84.65 / 81.49 / 0.012 / 96.30 / 89.63 / 0.026 / 峰值 165.1 / 候选 10 盏；
  G2 三相位各段 strength；夜间开/关 0.00%（0 px）；确定性 13/13；
  本批：`contactAoUnknownBase` 0/6 样本；改后 dusk 99.24 / 82.77 / 0.065、noon 96.30 / 89.63 / 0.026、
  dawn 102.64 / 86.16 / 0.065；灯全关 annulus 79.87、patch 84.65（光池 +2.90）；
  压暗开/关 annulus 82.77 / 84.30（+1.53 luma）、patch 不变；发光足迹 56/256 px、最亮 165.1、
  patch 上限 101.91；α=1 实验 annulus 75.42 / ratio 0.093；裁剪 576 px 在三帧相同、max 255/241/173。
- **推**：上限 14 = 追平既有最外阶 α0.16 的同帧实测 ΔL 14.00 → 超过会读成第二层影子
  （14.00 本身仍是「追平」，未超过）；下限 6 = 0.4×14 进位；可读基底门槛 **73.16** =
  23.16 + 6/0.12；grass 需 α ≥ 0.144、mud 需 α ≥ 0.330（由实测基底 luma 推）；
  boiler 被压住那一角的 ~172 luma（由 `116.40 = 0.75×98 + 0.25×172` 反解）；
  「两端 <5% 不可能」的不等式（2.3）；
  本批：反解 annulus 目标 `patch − 45.9`（38.75 / 53.34）、`patch_required = annulus + 45.9`；
  「光池缩到 0 也不够」（79.87 > 53.34）；「发光足迹要 ~65% 才够」＝ 由 101.91 上限推的算术，
  不是测的；α=1 实测的环带覆盖率 2.02% / 13.95% / 22.26%。
- 报告与本节里，带「【测】/【推】」或「实测/推断」标记的句子按上述划分。

### R5 提交状态与 sha

- 本批证据产出于 **2026-11-07 18:15–18:33（本地）**，工作树 = `HEAD 5075d71` + 本批未提交改动。
- 本 README 与代码在**同一个提交**入库；该提交（代码 + 证据）的完整 sha：
  `7f549cb3b825e987b31348eaf9a8e1d6171587b7`（`7f549cb`，18 个文件）。
  本段 sha 回填是紧随其后的 `docs(lighting)` 小提交，不改动代码与产物。
- 上一批的提交 sha：`e75e2d2aedcc630b1f4607f5ed137eb03261533b`（代码 + 证据）、
  其后 `5075d71` 为 sha 回填。
- 未 push；未碰 `eval/screens`；未碰 `ci.yml`（等 `chore/orphan-gates` 合并后一次接线）；
  未碰他人工作树。

### R6 时间（产物 ≤ 报告）

- 产物 mtime：2026-11-07 18:32:19（本地），本批产物同一次运行写出。
- 本 README 写入：2026-11-07 18:42（本地）；提交紧随其后。
- 满足「产物时间 ≤ 报告时间 ≤ 提交时间」。
- 已知覆盖：绿跑与红跑写同一路径（`ground-shadow.json` 与 AO 截图），入库的是恢复 `ink` 后的绿跑产物；
  红跑读数在 `check-ground-shadow-red-ao.log`。α=1 上限实验与正式读数写同一批截图路径，
  入库截图取自恢复 0.20/0.13/0.08 之后的正式跑；α=1 的读数在 `check-glow-contrast-alpha1.log` 里保留。

### R7 artifacts / noArtifactsReason

- `artifacts`（非空）：`check-ground-shadow-green.log`、`check-ground-shadow-unknown-base.log`、
  `check-ground-shadow-red-ao.log`、`ground-shadow.json`、`ground-shadow-ao-on-soot_forge-1.png`、
  `ground-shadow-ao-off-soot_forge-1.png`、`check-glow-contrast.log`、`check-glow-contrast-three-phase.log`、
  `check-glow-contrast-alpha1.log`、`glow-contrast.json`、`glow-dusk.png`、`glow-dusk-off.png`、
  `glow-dusk-noshade.png`、`glow-noon.png`、`glow-dawn.png`、`ao-scan-alpha012.log`、
  `lighting-g1-dusk-4x.png`。
- 因为 `artifacts` 非空，**不适用 `noArtifactsReason`**；若未来某轮确实没有产物，必须在该轮写
  `noArtifactsReason`。
- 闸门状态：**本仓未接入 `audit:reports`**（无该 npm script、无配置）；本块为手工纪律块。
- **预算口径提醒**：`renderStats()` 仍只数**顶层** `Graphics`，楼体的 99 个 Graphics / 11,090 条命令
  没进数。本批 G3 日志里的 `峰值指令 21473` 仍是这个旧口径，**不是定论**；等材质线的递归统计落地后
  需按新口径重测，届时不得引用 19179/21473 作为最终峰值。

## 5. 复跑

```powershell
# 绿（本批实现：ink 0.12 + 未知基底不画，G3 会打印 [G3 基底未知] 0 次）
$env:PIXEL_WORLD_URL="http://127.0.0.1:5301/"
node scripts/check-ground-shadow.mjs

# 红样例（临时把 buildings.ts 的阴影色改成 paletteFor().charcoal，跑完恢复 ink）
node scripts/check-ground-shadow.mjs

# KB 要点 4（dusk / noon / dawn 三相位 + 灯全关 + 压暗关，每次约 5 张截图）
node scripts/check-glow-contrast.mjs

# 压暗上限实验（临时把 setting-scenery.ts 的 LAMP_SHADE_RINGS 三档 α 全改 1，
# 并把本脚本里 SHADE_RINGS 的 α 同步改 1；跑完两处都恢复 0.20/0.13/0.08）
node scripts/check-glow-contrast.mjs

# 探针（逐栋扫 AO，上一批用过；本批未重跑）
$env:GROUND_SHADOW_AO_SCAN="1"
node scripts/check-ground-shadow.mjs
```

G2 的红跑复跑方式（回退三个文件）与上一批相同：

```powershell
git -C D:\project\pwe-lighting checkout HEAD~1 -- `
  world-client/src/world/ground-shadow.ts `
  world-client/src/render/villager.ts `
  world-client/src/render/setting-scenery.ts
node scripts/check-ground-shadow.mjs
git -C D:\project\pwe-lighting checkout HEAD -- `
  world-client/src/world/ground-shadow.ts `
  world-client/src/render/villager.ts `
  world-client/src/render/setting-scenery.ts
```

## 6. 未纳入本轮

- G1「4× 看不出来」：接受，按规则只改注释、不记待裁决项。
- 残留的单层太阳语义（[tilemap.ts:335](../../../world-client/src/render/tilemap.ts#L335)、
  [villager-layout.ts:415](../../../world-client/src/render/villager-layout.ts#L415)、
  [banner-motion.ts:85](../../../world-client/src/world/banner-motion.ts#L85)）：
  本轮不清，已登记为 [OPEN_ISSUES D7](../../OPEN_ISSUES.md) 低优先级清理项。
- KB 要点 4：本批按反解出的靶子改了光池（有芯的光 + 三档局部压暗），**未达 0.18**；
  进一步的两条路都到上限（patch 101.91 < 125.77；压暗 α=1 实测 0.093）⇒ **停手，这条要改美术模型**
  （发光足迹 / 周边压暗范围 / z-order），需单独批准。详见 3.5–3.8。
