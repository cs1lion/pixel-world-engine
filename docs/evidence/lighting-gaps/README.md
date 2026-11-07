# 光照查漏补缺 · G2 / G3 证据（lighting-gaps）

- 日期：2026-11-07
- 分支：`feat/lighting-gaps`
- 证据跑时的 HEAD：`d01eaa3`（本轮改动尚未提交，见 R5）
- 改动位置：[buildings.ts](../../../world-client/src/render/buildings.ts)（接触暗部 α `0.12 → 0.15`、`?contactAO=0` 调试口）、
  [check-ground-shadow.mjs](../../../world-client/scripts/check-ground-shadow.mjs)（G2 全相位、G3 多样本、AO 探针）、
  [ground-shadow.ts](../../../world-client/src/world/ground-shadow.ts)（内芯锚定规则写成一句话）、
  [OPEN_ISSUES.md](../../OPEN_ISSUES.md)（D7 低优先级清理项）

> **本仓未接入 `audit:reports` 闸门。** 仓内没有 `audit:reports` 这个 npm script，`docs/` 下也没有对应配置。
> 下面的 R1–R7 是按报告纪律**手工**填的：闸门缺席不等于证据缺席。

## 一句话

G2 换成晨/午/昏同一条判据后，旧实现红了 6 条（晨、午都红，不只是黄昏）；绿跑全部 ≥25%。
G3 换成「按基底 token 多样本 + 同机位 on/off」后，可读的只有 plaza / stone 两档；
grass / mud 是**物理上进不了带**（不是 α 没调够），已明确放弃，读数留在表里。

## 1. G2：晨 / 午 / 昏跑同一条判据

判据：同机位开/关，按实现自己的段宽切 ROI，取段内平均亮度差；**相邻两段相对落差 ≥ 25%**
（`G2_MIN_REL_DROP = 0.25`，见 [check-ground-shadow.mjs](../../../world-client/scripts/check-ground-shadow.mjs) 断言旁注释）。
单段样本（正午人物 span=1）只要求「有影且 >0」，不套两段判据。

### 绿跑读数【测】（2026-11-07 16:09，exit 0）

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
（旧实现只测黄昏会漏掉这两种），这正是本轮要求补测的原因。

### 内芯锚定规则（一句话）

> **内芯锚在「相位的根」——即贴物体那一端，不是固定左/右端；根在哪由 `dx` 的符号决定
> （晨/午 `dx≥0` 根在左，黄昏 `dx<0` 根在右）。**

同一句话也写在 [ground-shadow.ts](../../../world-client/src/world/ground-shadow.ts) 的 `shadowSegments` 文档里，
不只体现在代码分支里。

## 2. G3：按基底 token 多样本量 ΔL

AO 那一块 4×4 压在**楼左侧地面**，不在墙面：本设定集各 prefab 的墙体 `body` token 本来就不同
（terracotta / copper / charcoal / timberDark），但 AO 落点是地面格，所以真正变化的是**基底地形 token**。
样本取 `(origin.x−1, origin.y+footprint.h)` 这一格，覆盖最亮到最深四档。

### α 的定值依据（先量现状）

α=0.12 探针跑（`GROUND_SHADOW_AO_SCAN=1`，15:51）读数【测】：

| 样本 | 基底 token | 基底 luma | ΔL（α 0.12） |
| --- | --- | --- | --- |
| lamp_archive#1 | plaza | 134.09 | 10.35 |
| soot_forge#1 | stone | 90.55 | 5.19 |
| ferry_station#1 | stone | 87.00 | 4.78 |
| boiler_annex#1 | stone | 116.40 | 3.97（遮挡） |
| tea_stall#1 | grass | 64.90 | 2.00 |
| lamp_workshop#1 | mud | 41.32 | −0.07 |

0.12 时可读基底里最暗的 stone 只有 5.19 < 下限 6（读不出），所以 **调 α**：
0.155 时 plaza 实测 14.00，正好顶到上限、没有余量；**取 0.15**。

### 绿跑读数【测】（α 0.15，2026-11-07 16:09，exit 0）

| 样本 | 基底 token | 基底 luma | 开后 luma | ΔL | [6,14] | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| lamp_archive#1 | **plaza（最亮）** | 134.09 | 120.81 | **13.28** | 内 | 钉住 |
| soot_forge#1 | stone | 90.55 | 83.77 | **6.77** | 内 | 钉住（可读最暗） |
| ferry_station#1 | stone | 87.00 | 80.77 | **6.24** | 内 | 钉住（同档第二例） |
| boiler_annex#1 | stone | 116.40 | 111.22 | 5.18 | 外 | **放弃：遮挡**（墙角被上层盖住，基底够亮） |
| tea_stall#1 | grass | 64.90 | 61.97 | 2.93 | 外 | **放弃：深底** |
| lamp_workshop#1 | **mud（最深）** | 41.32 | 42.11 | −0.79 | 外 | **放弃：深底，压不暗（叠上去反而亮了 0.79）** |

### 为什么「三种 token 都进带」做不到（放弃理由，不是 α 没调够）【推】

- deepShade `#1b303b` 的 Rec.709 亮度是 **44.33**；mud 的基底是 **41.32**，**比阴影色还暗**，
  所以叠 deepShade 不会变暗（实测 −0.79）。换更大的 α 只会让它变亮更多。
- grass 基底 64.90，要 ΔL ≥ 6 需要 `α ≥ 6/(64.90−44.33) = 0.292`；同一 α 下 plaza 会到
  `0.292×(134.09−44.33) ≈ 26.2`，远超上限 14。**单一全局 α 不可能同时满足。**
- 因此可进带的只有 plaza / stone 两档；「最深」那一档（mud）的实测 ΔL 仍留在表里，
  处置是**放弃该基底**，不是调 α。
- 若以后确实要求三档都进带，唯一路子是**按基底自适应 α + 更深的阴影色（ink，亮度 23.16）**；
  那是设计改动，本轮未做，需单独批准。

## 3. R1–R7 结构化块

### R1 产物（哈希与字节）

| 文件 | 字节 | sha256 |
| --- | --- | --- |
| `check-ground-shadow-green.log` | 2450 | `c8306631dea63bf7aa4eadfc5a1b31256ff5389eff82a20da8adb4e87ba2f75b` |
| `check-ground-shadow-red.log` | 2912 | `48cee719bced4508a614a9bfb161db945cafe4f8bd8c1496ff80d197bbea6609` |
| `ao-scan-alpha012.log` | 2714 | `dbda315106697d2c52afd1405a8afd5bb4d13171ef0a12405393c818965c707c` |
| `ground-shadow.json` | 50432 | `dd9c7c5c57e710cc3d26c0aef4eb5c96eeac335147b67f418ec06b51aaa3772a` |
| `lighting-g1-dusk-4x.png` | 50058 | `c5e564ee12e3d2b98e917917618a056ab1017b23d6731b0337a2817f964bc21b` |
| `ground-shadow-foot-dusk-3x.png` | 3054 | `7783a52cc1f6ffc18fbc27f3a73ecd3f36b995f31fec79b5308e6f18828249fb` |
| `ground-shadow-foot-dusk-off-3x.png` | 3018 | `465ced154f81bd4bd51f24d95cda304ecf8b9c1042cb5286a3306f8b66916195` |
| `ground-shadow-ao-on-soot_forge-1.png` | 37923 | `2aa7ab7abd2a3d2c6175f56446ed5a753ef6e88069b2cbf8f466f29f43e21d96` |
| `ground-shadow-ao-off-soot_forge-1.png` | 37785 | `629c95238974664693206ee6a74f6586c2d20468772146c74e6d029e5e03060b` |

### R2 exit（整数）

| 跑 | exit | 判据行 |
| --- | --- | --- |
| 绿（α 0.15，本轮实现） | **0** | `[判据] 绿` |
| 红（G2 相关文件回退到 `HEAD~1`） | **1** | `[判据] 红（6 条）` |
| 探针（α 0.12，`GROUND_SHADOW_AO_SCAN=1`） | **1** | 探针模式不产出 verdict；红条是「样本只有 2 例」，正是调 α 的起因 |

### R3 比对口径

- **method**：G2 = 同机位 `debugGroundShadows` 开/关，段内平均亮度差 ÷ 基底；相邻段相对落差。
  G3 = 同机位 `?contactAO=0` 再开一页，`ΔL = 关(基底) − 开`，ROI 恰为 AO 的 4×4 世界像素。
- **threshold**：G2 相邻段相对落差 ≥ 25%（`0.25`）；G3 ΔL ∈ [6,14]（来源见 R4）。
- **size**：视口 1010×700；`zoom` 读数 1；画布内渲染 2×；G3 ROI 4×4 世界 px；
  摊位 ROI `20 + span`；人物脚底 ROI ±48 / 上 70 / 下 16（跟被钉的人走）。
- **shots**：每相位 stall/villager 各 on/off 1 张；另含全关同刻 2、暂停 2、确定性 13×2 帧哈希、
  G3 6 样本 ×2 页、G1 4× 1 张。产物只写 `world-client/tmp/screens/check-ground-shadow/`，不写 `eval/screens`。
- **scope**：机位 摊位 (400,470)、人物 (400,470)，人物钉格 (23,31)；潮位 1；晴；
  相位 dawn/noon/dusk/night；世界时刻 18:10（1090 min）；落地影 depth 3.1；建筑接触暗部深度随建筑层。

### R4 basis（哪句是测的、哪句是推的）

- **测**：既有最外阶 α0.16 的同帧实测 ΔL **14.00**（plaza 基底 134.09；理论值 `0.16×89.76=14.36`）；
  本轮 α0.15 六个样本的 ΔL；G2 三相位各段 strength；夜间开/关 0.00%（0 px）；确定性 13/13。
- **推**：上限 14 = 追平该阶 → **超过**会读成第二层影子（14.00 本身仍是「追平」，未超过）；
  下限 6 = 0.4×该阶（14×0.4=5.6 进位）；可读基底门槛 **84.33** = 44.33 + 6/0.15（由实测的叠色线性关系算）；
  grass 需 α ≥ 0.292、plaza 会到 26.2（由实测基底 luma 推）。
- 报告与本节里，带「【测】/【推】」或「实测/推断」标记的句子按上述划分。

### R5 提交状态与 sha

- 证据产出于 **2026-11-07 16:07–16:09（本地）**，工作树 = `HEAD d01eaa3` + 本轮未提交改动
  （α 0.15、`?contactAO=0`、G2 全相位、G3 多样本、本次 README）。
- 本 README 与代码在**同一个提交**入库；该提交（代码 + 证据）的完整 sha：
  `f5d63167535608340bc0c19fc49c46c7378aab7b`（`fix(lighting): 接触暗部 α 定到 0.15 …`）。
  本段 sha 回填是紧随其后的 `docs(lighting)` 小提交，不改动代码与产物。
- 未 push；未碰 `eval/screens`；未碰他人工作树。

### R6 时间（产物 ≤ 报告）

- 产物 mtime：红日志 16:07:51；绿日志 16:09:50；截图 16:08:02–16:09:50。
- 本 README 写入：2026-11-07 16:13（本地）；提交紧随其后。
- 满足「产物时间 ≤ 报告时间 ≤ 提交时间」。
- 已知覆盖：红跑与绿跑写同一路径，红跑当时的 G1 4× PNG 已被绿跑覆盖（16:09:49）。
  红日志里的 `[G1]` 哈希指向当时那个文件；G1 不属于 G2 红证据，绿跑的 4× 已入库。

### R7 artifacts / noArtifactsReason

- `artifacts`（非空）：`check-ground-shadow-green.log`、`check-ground-shadow-red.log`、
  `ao-scan-alpha012.log`、`ground-shadow.json`、`lighting-g1-dusk-4x.png`、
  `ground-shadow-foot-dusk-3x.png`、`ground-shadow-foot-dusk-off-3x.png`、
  `ground-shadow-ao-on-soot_forge-1.png`、`ground-shadow-ao-off-soot_forge-1.png`。
- 因为 `artifacts` 非空，**不适用 `noArtifactsReason`**；若未来某轮确实没有产物，必须在该轮写
  `noArtifactsReason`（例：纯注释改动，无新截图/日志）。
- 闸门状态：**本仓未接入 `audit:reports`**（无该 npm script、无配置）；本块为手工纪律块。

## 4. 复跑

```powershell
# 绿（本轮实现）
$env:PIXEL_WORLD_URL="http://127.0.0.1:5301/"
node scripts/check-ground-shadow.mjs

# 红（把 G2 相关三个文件回退到 HEAD~1，跑完立刻恢复；不要动 buildings.ts）
git -C D:\project\pwe-lighting checkout HEAD~1 -- `
  world-client/src/world/ground-shadow.ts `
  world-client/src/render/villager.ts `
  world-client/src/render/setting-scenery.ts
node scripts/check-ground-shadow.mjs
git -C D:\project\pwe-lighting checkout HEAD -- `
  world-client/src/world/ground-shadow.ts `
  world-client/src/render/villager.ts `
  world-client/src/render/setting-scenery.ts

# 探针（逐栋扫 AO，用来挑钉住样本）
$env:GROUND_SHADOW_AO_SCAN="1"
node scripts/check-ground-shadow.mjs
```

## 5. 未纳入本轮

- G1「4× 看不出来」：接受，按规则只改注释、不记待裁决项。
- 残留的单层太阳语义（[tilemap.ts:335](../../../world-client/src/render/tilemap.ts#L335)、
  [villager-layout.ts:415](../../../world-client/src/render/villager-layout.ts#L415)、
  [banner-motion.ts:85](../../../world-client/src/world/banner-motion.ts#L85)）：
  本轮不清，已登记为 [OPEN_ISSUES D7](../../OPEN_ISSUES.md) 低优先级清理项。
