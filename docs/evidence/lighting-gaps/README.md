# 光照查漏补缺 · G2 / G3 / KB4 证据（lighting-gaps）

- 日期：2026-11-07
- 分支：`feat/lighting-gaps`
- 证据跑时的 HEAD：`4343632`（本批改动尚未提交，见 R5）
- 改动位置：[buildings.ts](../../../world-client/src/render/buildings.ts)（接触暗部改 `ink` 0.12、钳制「不提亮」）、
  [SandboxScene.ts](../../../world-client/src/scenes/SandboxScene.ts)（把 AO 落点那一格的地形底色传给建筑层）、
  [check-ground-shadow.mjs](../../../world-client/scripts/check-ground-shadow.mjs)（ΔL > 0 断言、窄带余量、放弃样本分档）、
  [check-glow-contrast.mjs](../../../world-client/scripts/check-glow-contrast.mjs)（KB 要点 4 的可测判据）

> **本仓未接入 `audit:reports` 闸门。** 仓内没有 `audit:reports` 这个 npm script，`docs/` 下也没有对应配置。
> 下面的 R1–R7 是按报告纪律**手工**填的：闸门缺席不等于证据缺席。

## 一句话

AO 从 `deepShade` 0.15 改成 `ink` 0.12，并加了「合成后比基底亮就不产出矩形」的钳制与 ΔL > 0 断言；
`mud` 从「−0.79 的提亮」变成「+1.79 的压暗但仍在带外」。窄带判据按实测重新声明：
上端余量 7.7%、下端 24.3%，**任一端 <5% 才触发重新配平**。放弃样本按 `occluded`（遮挡）与
`dark`（深底）分开登记。KB 要点 4 的可测判据已落地，现状读数 **dusk 0.012 < 0.18，不满足**；
noon 对照 0.026 < 0.10 通过，annulus token 只名义满足；机制仍是**全屏 dim + ADD 光池**，不是局部压低周边。

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

实现（[buildings.ts](../../../world-client/src/render/buildings.ts)）：

```ts
if (contactAoEnabled()) {
  const shade = paletteFor().ink;         // Rec.709 亮度 23.16，比所有地形基底都暗
  if (groundBase === undefined || lumaOf(shade) < lumaOf(groundBase)) {
    g.fillStyle(shade, 0.12);
    g.fillRect(-4, h, 4, 4);
  }
}
```

- **为什么换色**：`deepShade` 的亮度 44.33，**高于最深的 mud 基底**（soil `#202b35`，41.38），
  叠上去实测 −0.79（提亮）。一个叫「接触暗部」的东西变亮是语义错误，所以阴影色换成 24 色里最暗的
  `ink`（23.16）。`mud` 现在读 +1.79（仍 <6，见 2.4 的深底放弃）。
- **钳制**：合成后比基底亮时**不产出矩形**（`groundBase` 未给的单测场景不拦）。
- **断言**：`check-ground-shadow.mjs` 对**所有**样本（pinned / dark / occluded）先判
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

### 3.2 现状读数【测】（2026-11-07，exit 1）

| 相位 | patch meanL | annulus meanL | `(patch−annulus)/255` | 阈值 | 结果 |
| --- | --- | --- | --- | --- | --- |
| dusk | 84.65 | 81.49 | **0.012** | ≥ 0.18 | **不过** |
| noon（同一世界中心） | 96.30 | 89.63 | 0.026 | < 0.10 | 过 |
| 截图像素口径参照 dusk / noon | 88.48 / 100.80 | 84.20 / 95.75 | 0.017 / 0.020 | — | — |

- 样本：第 21 盏灯（灯串）@ 世界 `(652,404)`，中心世界 `(648,404)`，灯体 8×8 峰值 165.1；
  视口内候选 10 盏，按「最亮的一盏」预先钉住，没有为了读数换灯。
- annulus 地形 token：按上述规则数到 **5 种**（noon 帧：grass 26.15% / charcoal 19.17% /
  soil 1.56% / plaza 1.46% / farm 1.04%），≥3 名义上满足；但 `classifiedShare` 只有 0.497，
  且大份额的 grass/charcoal 很可能来自立面/屋面——**这条只是名义满足**，不能当「annulus 真是
  三种地面 token」的证据。

### 3.3 现状是否满足这条 KB 要点？

**不满足。**

- **读数**：dusk 0.012 < 0.18（差 0.168，约 42.9 luma），只有 noon 对照过。
- **机制**：也不是「局部压低周边」——实现是**全屏相位 dim（乘色压暗整帧）+ 灯/窗 ADD 光池**。
  annulus 没有被局部压暗，它只是和整帧一起变暗。noon 0.026 < 0.10 说明「全屏压暗冒充对比」这条
  反例没有发生（否则 noon 也会抬高），但 dusk 起不来恰好说明：**全屏 dim 不产生局部对比**。
- **不满足是实现的哪种选择导致的**：
  1. **ADD 光池**：32×32 的 annulus 把灯下的光池整个包进来，annulus 被抬到 81.49，与 patch 84.65 只差 3.16。
  2. **发光芯太小**：灯芯 4×6 世界 px，在 8×8 patch 里只占约 9/16 的像素面积，patch 均值被背景稀释到 84.65。
  3. **全屏 dim**：patch 与 annulus 同倍压暗，比值不变——dim 越深，两边一起暗，不会把 0.012 变成 0.18。
- **不许把「读数在阈值内」等同于「实现了局部压低周边」**：noon 的 0.026 与 token 的 5 都只是读数；
  机制字段在脚本里单独写死 `localSurroundSuppression: false`。

## 4. R1–R7 结构化块

### R1 产物（哈希与字节）

| 文件 | 字节 | sha256 |
| --- | --- | --- |
| `check-ground-shadow-green.log` | 2676 | `8f326aa75aac4887897eb338d12218dcf5c4a21878bc68c317e70e98171a93fa` |
| `check-ground-shadow-red-ao.log` | 3000 | `e5fe55ed15e3a574fd016c15383a00b0163fd71b7987f55f8b4916bd49921331` |
| `ground-shadow.json` | 51218 | `c32b45d52b2d5111a5f3ccba9a7fc047cb43144b40d7c53f86c515b67d3abe01` |
| `ground-shadow-ao-on-soot_forge-1.png` | 37942 | `68fc3061568b842bd636cf541e46a6ca95a38092221e89d11dec6e2e7bae2a49` |
| `ground-shadow-ao-off-soot_forge-1.png` | 37785 | `629c95238974664693206ee6a74f6586c2d20468772146c74e6d029e5e03060b` |
| `check-glow-contrast.log` | 926 | `598822a5ba42d468ed36465cf4940422ac79ad0422911468c9153e63644ef807` |
| `glow-contrast.json` | 4195 | `4800acb2ef9658c6ca3f4843997b0506fb42fe63b4b5dfe0ba6d08f86a6d8773` |
| `glow-dusk.png` | 37862 | `719d37b9a4431bcad3371be8fdec4c55f229cb2d7d1388feffd55fd8c13e8cf0` |
| `glow-noon.png` | 32786 | `eba73394100ceb059f2cf411288b22f09109b15e6e4175ec21af09617118a2f2` |
| `ao-scan-alpha012.log` | 2714 | `dbda315106697d2c52afd1405a8afd5bb4d13171ef0a12405393c818965c707c` |
| `lighting-g1-dusk-4x.png` | 50059 | `85d327b343998f6f7ffeed5f75b6dd334937075ba8b6aa9cc6656f079fdfe047` |

`ao-scan-alpha012.log` 是上一批 `deepShade` 的探针，保留作 2.3 的历史基线；本批没有重跑探针。

### R2 exit（整数）

| 跑 | exit | 判据行 |
| --- | --- | --- |
| 绿（`ink` @ 0.12，本批实现） | **0** | `[判据] 绿` |
| 红（临时把阴影色改浅到 `charcoal` 50.66） | **1** | `[判据] 红（3 条）`，含 `ΔL 0.00 ≤ 0` 的语义红条 |
| KB 要点 4（现状读数） | **1** | `[判据] 红（1 条）：dusk ratio 0.012 < 0.18` |

### R3 比对口径

- **method**：G2 = 同机位 `debugGroundShadows` 开/关，段内平均亮度差 ÷ 基底；相邻段相对落差。
  G3 = 同机位 `?contactAO=0` 再开一页，`ΔL = 关(基底) − 开`，ROI 恰为 AO 的 4×4 世界像素；
  另在同 ROI 做 on/off 像素差，数「真正变了的像素」。
  KB4 = 同机位两页（`time=dusk` / `time=noon`），dusk 找最亮灯 → 8×8 世界 patch、32×32 annulus；
  noon 用同一世界中心；`ratio = (meanL(patch) − meanL(annulus)) / 255`（Rec.601）。
- **threshold**：G2 相邻段相对落差 ≥ 25%；G3 ΔL ∈ [6,14]，且**所有**样本 ΔL > 0；
  KB4 dusk ≥ 0.18 / noon < 0.10 / annulus ≥ 3 token。
- **size**：视口 1010×700；`zoom` 1；画布内渲染 2×；G3 ROI 4×4 世界 px；KB4 patch 16×16 截图 px、
  annulus 64×64 截图 px（= 8×8 / 32×32 世界 px）；摊位 ROI `20 + span`；人物脚底 ROI ±48 / 上 70 / 下 16。
- **shots**：每相位 stall/villager 各 on/off 1 张；另含全关同刻 2、暂停 2、确定性 13×2 帧哈希、
  G3 6 样本 ×2 页、G1 4× 1 张、KB4 dusk/noon 各 1 张。产物只写 `world-client/tmp/screens/`，
  不写 `eval/screens`。
- **scope**：机位 摊位 (400,470)、人物 (400,470)，人物钉格 (23,31)；KB4 机位 (832,522)；
  潮位 1；晴；相位 dawn/noon/dusk/night；世界时刻 18:10（1090 min）；落地影 depth 3.1；
  建筑接触暗部深度随建筑层。

### R4 basis（哪句是测的、哪句是推的）

- **测**：2.2 六样本的基底/开后/ΔL；2.1 红样例的三条读数与 0/64 可见像素；2.4 的 48/64；
  KB4 的 84.65 / 81.49 / 0.012 / 96.30 / 89.63 / 0.026 / 峰值 165.1 / 候选 10 盏；
  G2 三相位各段 strength；夜间开/关 0.00%（0 px）；确定性 13/13。
- **推**：上限 14 = 追平既有最外阶 α0.16 的同帧实测 ΔL 14.00 → 超过会读成第二层影子
  （14.00 本身仍是「追平」，未超过）；下限 6 = 0.4×14 进位；可读基底门槛 **73.16** =
  23.16 + 6/0.12；grass 需 α ≥ 0.144、mud 需 α ≥ 0.330（由实测基底 luma 推）；
  boiler 被压住那一角的 ~172 luma（由 `116.40 = 0.75×98 + 0.25×172` 反解）；
  「两端 <5% 不可能」的不等式（2.3）。
- 报告与本节里，带「【测】/【推】」或「实测/推断」标记的句子按上述划分。

### R5 提交状态与 sha

- 证据产出于 **2026-11-07 16:59–17:00（本地）**，工作树 = `HEAD 4343632` + 本批未提交改动。
- 本 README 与代码在**同一个提交**入库；该提交（代码 + 证据）的完整 sha：`e75e2d2aedcc630b1f4607f5ed137eb03261533b`（`e75e2d2`）。
  本段 sha 回填是紧随其后的 `docs(lighting)` 小提交，不改动代码与产物。
- 未 push；未碰 `eval/screens`；未碰 `ci.yml`（等 `chore/orphan-gates` 合并后一次接线）；
  未碰他人工作树。

### R6 时间（产物 ≤ 报告）

- 产物 mtime：2026-11-07 16:59:58（本地），全部产物同一批次写出。
- 本 README 写入：2026-11-07 17:00（本地）；提交紧随其后。
- 满足「产物时间 ≤ 报告时间 ≤ 提交时间」。
- 已知覆盖：红跑与绿跑写同一路径（`ground-shadow.json` 与 AO 截图），入库的是恢复 `ink` 后的绿跑产物；
  红跑的读数在 `check-ground-shadow-red-ao.log` 里逐行保留。

### R7 artifacts / noArtifactsReason

- `artifacts`（非空）：`check-ground-shadow-green.log`、`check-ground-shadow-red-ao.log`、
  `ground-shadow.json`、`ground-shadow-ao-on-soot_forge-1.png`、
  `ground-shadow-ao-off-soot_forge-1.png`、`check-glow-contrast.log`、`glow-contrast.json`、
  `glow-dusk.png`、`glow-noon.png`、`ao-scan-alpha012.log`、`lighting-g1-dusk-4x.png`。
- 因为 `artifacts` 非空，**不适用 `noArtifactsReason`**；若未来某轮确实没有产物，必须在该轮写
  `noArtifactsReason`。
- 闸门状态：**本仓未接入 `audit:reports`**（无该 npm script、无配置）；本块为手工纪律块。

## 5. 复跑

```powershell
# 绿（本批实现：ink 0.12）
$env:PIXEL_WORLD_URL="http://127.0.0.1:5301/"
node scripts/check-ground-shadow.mjs

# 红样例（临时把 buildings.ts 的阴影色改成 paletteFor().charcoal，跑完恢复 ink）
node scripts/check-ground-shadow.mjs

# KB 要点 4（dusk / noon 同机位）
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
- KB 要点 4 只做了「可测判据 + 现状读数」，**没有**改成局部压低周边；那是实现改动，需单独批准。
