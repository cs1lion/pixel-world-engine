# 丙类 18 张相位帧的弱判据

> 这份判据**不是**像素级回归。它只回答一个问题：两次抓拍的差异是否还落在「动画对象应该在的地方」、规模是否还在这三跑见过的量级里。它判不了动画本身对不对，也判不了颜色预算。详见文末「这套弱判据判不了什么」。

## 为什么需要它

`SCREENSHOT_BASELINE_CHANGES.md` 里 18 张丙类（`01-salute`、`06-faith`、`creation-rejected`、两张 `dengchao-tide-*`、6 张 `ground-shadow-villager-*`、3 张 `ground-shadow-foot-*`、`lamp-pool-tide-10`、`placement-behind`、`setting-scale-after`、`stall-motion-rain`）的共同点是：三跑之间确实有差，但差区落在角色、影子、雨幕这些**逐帧相位本来就会变**的对象上。此前只写了一句「不可作逐像素判据」，等于没有判据——任何漂移都能以「相位」名义放过。

现在给它们三条可执行断言：区域外必须干净，区域内的面积和连通块数必须有上限。阈值全部从 2026-11-05 的三跑实测反推，不取整。

## 判据

输入一张参考图 `ref` 和一张待验图 `cur`（同尺寸），逐像素比较 RGBA（含 alpha），得到差异掩码 `M`；把 `M` 按该图的区域清单切成「区域内 `M_in`」与「区域外 `M_out`」。

三条断言同时成立才算 `ok`：

1. `|M_out| = 0`。逐像素严格比较，PNG 解码无损，不存在压缩噪声；容差取 0，任何区域外差异都能定位到具体像素与 bbox。
2. `components(M_in) ≤ ceil(并集块数 × 1.5)`。
3. `|M_in| ≤ ceil(并集面积 × 1.4)`。

区域清单与阈值基准在 `world-client/scripts/lib/phase-regions.json`；执行入口 `world-client/scripts/check-phase-frames.mjs`（`npm run verify:phase`）。

## 区域配置（18 张）

bbox 为 `[x0, y0, x1, y1)`，右下开区间；坐标取自三跑并集差分的连通块，外扩到对象边界。

| 图 | 区域（kind [bbox]） | 来源 |
|---|---|---|
| 01-salute.png | actor [368,203,596,491]<br>overlay [513,151,656,219]<br>overlay [803,61,844,101] | 三跑并集最大两块 13376px@378,333,502,481 与 9376px@510,213,586,385 合并外扩 8px：主角抬手动作的身体与袖口<br>448px@610,177,646,197 + 266px@535,161,560,173 + 266px@525,199,550,211：世界内招牌文字，DOM 文本栅格<br>420px@813,71,834,91：小地图上的玩家标记 |
| 06-faith.png | actor [822,126,874,198]<br>actor [226,142,278,178]<br>overlay [790,800,843,827] | 448px@830,134,866,154 + 448px@830,170,866,190：右侧走动的村民（16×24 人形，两帧相位各露一半）<br>448px@234,150,270,170：左侧走动的村民<br>96px@821,809,833,819 + 63px@807,808,819,819 + 49px@798,809,805,819：神谕日报分页箭头，DOM 文本栅格抖动 |
| creation-rejected.png | actor [762,185,822,217]<br>actor [290,473,350,505]<br>actor [86,501,146,533] | 496px@770,193,814,209：世界右上角走过的小人<br>496px@298,481,342,497：街面中部走过的小人<br>496px@94,509,138,525：街面左下角走过的小人 |
| dengchao-tide-high.png | rain [24,68,1000,756]<br>overlay [774,910,844,940] | 整个 3D 视口：三跑差分为 109 个 1–2px 宽竖直细条、分布全屏，与雨幕逐帧相位一致；视口边界由基线图边框像素扫描（x 24–999，y 68–755）<br>98px@784,921,796,931 + 97px@821,921,833,931 + 76px@807,920,819,931：神谕日报分页箭头 |
| dengchao-tide-low.png | rain [24,68,1000,756]<br>overlay [774,910,844,940] | 整个 3D 视口：三跑差分为 111 个竖直细条、分布全屏，与雨幕逐帧相位一致；另有 2728px@26,373,274,387 的潮位横条<br>神谕日报分页箭头，与 dengchao-tide-high 同位置 |
| ground-shadow-foot-dusk-3x.png | shadow [112,118,152,164] | 1116px@114,120,150,162：check-ground-shadow 的脚下 3× 裁图（脚底 ±16×±22、最近邻放大 3×），整块是投影与鞋底接触边 |
| ground-shadow-foot-dusk-off-3x.png | shadow [112,118,152,164] | 1116px@114,120,150,162：同 ground-shadow-foot-dusk-3x 的裁剪参数 |
| ground-shadow-foot-dusk.png | shadow [36,38,52,56] | 124px@38,40,50,54：脚下 1× 裁图，投影与鞋底交界 |
| ground-shadow-villager-dusk-off.png | shadow [422,388,442,410] | 124px@426,392,438,406：0 号人物钉在格 (23,31)，黄昏影长 56px，取脚底投影 |
| ground-shadow-villager-dusk-on.png | shadow [422,388,442,410] | 124px@426,392,438,406：同上，摊位开灯对照帧 |
| ground-shadow-villager-night-off.png | shadow [422,388,442,410] | 120px@426,392,438,406：夜里不做投影，残留的是鞋底与地面接触像素 |
| ground-shadow-villager-night-on.png | shadow [422,388,442,410] | 120px@426,392,438,406：同夜晚关灯帧 |
| ground-shadow-villager-noon-off.png | shadow [422,388,442,410] | 120px@426,392,438,406：正午影长 1px，取脚底投影 |
| ground-shadow-villager-noon-on.png | shadow [422,388,442,410] | 120px@426,392,438,406：同正午关灯帧 |
| lamp-pool-tide-10.png | light [14,72,34,150]<br>edge [338,306,356,320] | 48px@22,78,26,90 + 48px@22,114,26,126 + 48px@22,130,26,142：左侧灯柱光晕边缘的三段竖条<br>32px@344,312,350,320：画布右下角潮水/岸线边缘 |
| placement-behind.png | actor [270,0,392,44]<br>actor [404,210,424,292] | 80px@308,16,316,36 + 56px@276,0,282,14 + 48px@382,20,386,32 + 8px@324,0,328,2：被建筑遮挡、只露顶边的人物（placement 用例的『身后』对象）<br>48px@412,218,416,230 + 48px@412,270,416,282：右侧边缘同一小人露出的两段 |
| setting-scale-after.png | rain [0,0,480,320] | 624px 分成 9 处 4–20px 竖直细条、散布全屏，与雨幕相位一致；整张裁图都是 3D 视口 |
| stall-motion-rain.png | rain [0,0,960,631] | 1758px 分成 67 个 1–2px 竖直细条、散布全屏，与雨幕相位一致；整张是 3D 视口裁图 |

「overlay」是这版判据的**显式让步**：招牌文字、小地图标记、神谕日报分页箭头都是 DOM 栅格抖动，不属于动画对象，但它们确实会在同代码两次抓拍之间出现几十到几百像素的差。不登记就会天天误红；登记了就等于这几处不受本判据保护。两者都不理想，这里选的是「先让判据可用」，并在文末写明代价。

## 阈值推导

每个图的基准取**三跑并集**（r1-r2 ∪ r2-r3 ∪ r1-r3）：并集按定义不小于任何单对，是这三跑见过的差异上界。

| 图 | 并集面积 | 面积上限(×1.4) | 并集块数 | 块数上限(×1.5) |
|---|---|---|---|---|
| 01-salute.png | 24663 | 34529 | 9 | 14 |
| 06-faith.png | 1552 | 2173 | 6 | 9 |
| creation-rejected.png | 1488 | 2084 | 3 | 5 |
| dengchao-tide-high.png | 5651 | 7912 | 109 | 164 |
| dengchao-tide-low.png | 6124 | 8574 | 111 | 167 |
| ground-shadow-foot-dusk-3x.png | 1116 | 1563 | 1 | 2 |
| ground-shadow-foot-dusk-off-3x.png | 1116 | 1563 | 1 | 2 |
| ground-shadow-foot-dusk.png | 124 | 174 | 1 | 2 |
| ground-shadow-villager-dusk-off.png | 124 | 174 | 1 | 2 |
| ground-shadow-villager-dusk-on.png | 124 | 174 | 1 | 2 |
| ground-shadow-villager-night-off.png | 120 | 168 | 1 | 2 |
| ground-shadow-villager-night-on.png | 120 | 168 | 1 | 2 |
| ground-shadow-villager-noon-off.png | 120 | 168 | 1 | 2 |
| ground-shadow-villager-noon-on.png | 120 | 168 | 1 | 2 |
| lamp-pool-tide-10.png | 176 | 247 | 4 | 6 |
| placement-behind.png | 288 | 404 | 6 | 9 |
| setting-scale-after.png | 624 | 874 | 9 | 14 |
| stall-motion-rain.png | 1758 | 2462 | 67 | 101 |

余量 1.4 / 1.5 的来路：对每张图算「并集 / 最大单对」，这个比值就是「多跑一次相对已见最大差异还会涨多少」的实测分布。

- 面积比值：最小 1.000（`creation-rejected`），p50 1.051，p75 1.176，p90 1.393，最大 1.425（`06-faith`：单对 1089 → 并集 1552）。取 **1.40**（p90 向上取到 0.05 刻度），18 张里盖住 17 张；唯一超出的是 `06-faith` 的 1.425，它多出来的是村民跨两帧露出的第二块，属于连通块问题，由块数上限兜。
- 块数比值：最小 0.5（并集把两块连成一块），p50 0.75，p75 1.20，最大 1.453（`dengchao-tide-high`：75 → 109）。取 **1.5**（最大实测向上取整），18 张全盖住。
- 两个余量都刻意小于 1.5：反向用例要「放大到并集 1.5 倍」时必然越界，保证判据可红。若哪天把面积余量调到 ≥1.5，这条反向用例就会失效——那是改动阈值时必须一起改的约束。

区域外容差取 0 的依据：18 张 × 三对 = 54 次两两比较，区域外差异全部为 0（见下表实跑读数），没有一次落在边界像素上。

## 实跑

### 对已提交基线（`eval/screens` vs r1）：13 通过 / 5 不过

```
FAIL	01-salute.png	区域外差异 496px / 1 个连通块 / bbox 254,517,298,533（要求 0px）；区域内差异连通块 20 个超过上限 14 个
FAIL	06-faith.png	区域外差异 102552px / 4 个连通块 / bbox 26,0,986,218（要求 0px）；区域内差异面积 2902px 超过上限 2173px
FAIL	creation-rejected.png	区域外差异 360px / 2 个连通块 / bbox 26,189,986,513（要求 0px）
ok	dengchao-tide-high.png	区外 0px / 区内 6918px（上限 7912）/ 区内 71 块（上限 164）
ok	dengchao-tide-low.png	区外 0px / 区内 6942px（上限 8574）/ 区内 70 块（上限 167）
ok	ground-shadow-foot-dusk-3x.png	区外 0px / 区内 864px（上限 1563）/ 区内 2 块（上限 2）
ok	ground-shadow-foot-dusk-off-3x.png	区外 0px / 区内 864px（上限 1563）/ 区内 2 块（上限 2）
ok	ground-shadow-foot-dusk.png	区外 0px / 区内 96px（上限 174）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-dusk-off.png	区外 0px / 区内 96px（上限 174）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-dusk-on.png	区外 0px / 区内 96px（上限 174）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-night-off.png	区外 0px / 区内 120px（上限 168）/ 区内 1 块（上限 2）
ok	ground-shadow-villager-night-on.png	区外 0px / 区内 120px（上限 168）/ 区内 1 块（上限 2）
ok	ground-shadow-villager-noon-off.png	区外 0px / 区内 96px（上限 168）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-noon-on.png	区外 0px / 区内 96px（上限 168）/ 区内 2 块（上限 2）
FAIL	lamp-pool-tide-10.png	区域外差异 42986px / 61 个连通块 / bbox 0,0,480,312（要求 0px）；区域内差异面积 968px 超过上限 247px
FAIL	placement-behind.png	区域外差异 64539px / 27 个连通块 / bbox 0,0,480,320（要求 0px）；区域内差异面积 4208px 超过上限 404px
ok	setting-scale-after.png	区外 0px / 区内 336px（上限 874）/ 区内 5 块（上限 14）
ok	stall-motion-rain.png	区外 0px / 区内 1292px（上限 2462）/ 区内 58 块（上限 101）

总计 18：ok 13 / FAIL 5 / missing 0
```

5 张不过的逐张归因（配置没错，归类也没错，是三跑之外多出来的东西）：

| 图 | 读数 | 归因 |
|---|---|---|
| 01-salute | 区外 496px@254,517–298,533（44×16），区内 20 块 > 14 | 三跑在该处完全一致，已提交基线却多出一个小物件/小人；基线录制时的世界时刻与现在不同 |
| 06-faith | 区外 102552px（11.11%，视口上沿整条），区内 2902 > 2173 | 基线是另一套光照/时间下的视口内容，整块漂移 |
| creation-rejected | 区外 360px，两块 @26,189–986,513 | 视口左右边缘各有一条基线独有的窄边 |
| lamp-pool-tide-10 | 区外 42986px（28.62%，整张），区内 968 > 247 | 基线整张视口与当前不同 |
| placement-behind | 区外 64539px（44.76%，整张），区内 4208 > 404 | 基线整张视口与当前不同 |

这 5 张正是账本顶部 banner 说的那件事：基线录于 `pinShotState` 之前，不能当验收依据。判据在这里不是「误报」，而是把「这份基线不可用」具体到像素。`pinShotState` 合入并重录后，这 5 张应当转为通过；若届时仍红，那就是真的回归。

### 同条件两跑（r1 vs r2）：18/18 通过

```
ok	01-salute.png	区外 0px / 区内 23096px（上限 34529）/ 区内 8 块（上限 14）
ok	06-faith.png	区外 0px / 区内 1034px（上限 2173）/ 区内 4 块（上限 9）
ok	creation-rejected.png	区外 0px / 区内 1488px（上限 2084）/ 区内 3 块（上限 5）
ok	dengchao-tide-high.png	区外 0px / 区内 2508px（上限 7912）/ 区内 75 块（上限 164）
ok	dengchao-tide-low.png	区外 0px / 区内 5321px（上限 8574）/ 区内 79 块（上限 167）
ok	ground-shadow-foot-dusk-3x.png	区外 0px / 区内 360px（上限 1563）/ 区内 2 块（上限 2）
ok	ground-shadow-foot-dusk-off-3x.png	区外 0px / 区内 360px（上限 1563）/ 区内 2 块（上限 2）
ok	ground-shadow-foot-dusk.png	区外 0px / 区内 40px（上限 174）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-dusk-off.png	区外 0px / 区内 40px（上限 174）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-dusk-on.png	区外 0px / 区内 40px（上限 174）/ 区内 2 块（上限 2）
ok	ground-shadow-villager-night-off.png	区外 0px / 区内 120px（上限 168）/ 区内 1 块（上限 2）
ok	ground-shadow-villager-night-on.png	区外 0px / 区内 120px（上限 168）/ 区内 1 块（上限 2）
ok	ground-shadow-villager-noon-off.png	区外 0px / 区内 0px（上限 168）/ 区内 0 块（上限 2）
ok	ground-shadow-villager-noon-on.png	区外 0px / 区内 0px（上限 168）/ 区内 0 块（上限 2）
ok	lamp-pool-tide-10.png	区外 0px / 区内 128px（上限 247）/ 区内 3 块（上限 6）
ok	placement-behind.png	区外 0px / 区内 240px（上限 404）/ 区内 5 块（上限 9）
ok	setting-scale-after.png	区外 0px / 区内 448px（上限 874）/ 区内 6 块（上限 14）
ok	stall-motion-rain.png	区外 0px / 区内 1028px（上限 2462）/ 区内 55 块（上限 101）

总计 18：ok 18 / FAIL 0 / missing 0
```

这一组是**自洽性检查**，不是独立证据：区域和阈值本来就是从这三跑推出来的，通过是设计使然。它的用处是证明工具在真实相位帧上跑得绿、不会一上来就误红。

## 反向用例（必须红）

`--self-test` 用同一份区域配置、同一套判定，造两个合成样本：

```
## 反向用例（合成） 基准：01-salute.png  区内面积上限 34529px
   原始对：ok
   [应红] 把差区搬到区域外（bbox 378,79,826,481 → 底部）：
     FAIL ✓ 区域外差异 23096px / 8 个连通块 / bbox 281,532,729,934（要求 0px）
   [应红] 区内面积放大到并集 1.5 倍（目标 36995px，实得 36995px）：
     FAIL ✓ 区域内差异面积 36995px 超过上限 34529px
```

- 搬移：把 r1→r2 的全部 23096px 差异整体平移到画面底部（落点像素取参考值 +1，保证确实不同），区域外立刻从 0 变成 23096px / 8 块。
- 放大：以真实差区为种子，沿四邻域在区域内部生长，直到面积正好达到并集 24663px 的 1.5 倍（36995px），超过 34529px 上限 2466px 而红。

两条都红、原始对仍绿，`--self-test` 退出码 0；任一没红则退出码 1。

## 跑法

```bash
cd world-client
npm run verify:phase -- --ref eval/screens --cur ../tmp/anim-verify/r1/screens
npm run verify:phase -- --ref ../tmp/anim-verify/r1/screens --cur ../tmp/anim-verify/r2/screens
npm run verify:phase -- --self-test --ref ../tmp/anim-verify/r1/screens --cur ../tmp/anim-verify/r2/screens
```

退出码：全过 0；任一 FAIL / missing / 自检没红 1；用法错误 2。`--only <文件名>` 可单跑一张。

## 这套弱判据判不了什么

1. **判不了动画本身对不对。** 它只看差异的位置与规模，不比对期望帧。角色动作整体错位、少一帧、多一帧，只要还在 bbox 内且面积不超上限，一律通过。
2. **判不了颜色与光照预算。** 整片色阶位移只要落在区域内、面积不超限就通过。这正是丙类里「整片色阶常量位移」那类问题抓不到的地方。
3. **判不了 overlay 区。** 招牌文字、小地图标记、神谕日报分页箭头被显式登记为允许差异；这些区域的回归它看不见。登记它们是为了不误红，代价写在这里。
4. **判不了「多出来的对象是不是该出现」。** 新增一个角色，只要落在已登记 bbox 内，面积也可能仍在余量内，会通过。
5. **判不了时序。** 单帧对单帧，不管帧率、播放时长、过渡曲线。
6. **不能替代重录。** 阈值来自这三跑；`pinShotState` 合入、正式重录之后，区域和阈值都要用新三跑重算，不能把今天这份配置当成长期基线。
7. **不是像素级回归。** 任何「逐像素必须相同」的断言仍然只适用于甲类；这 18 张的定位是「漂移的粗筛」，不是验收的终点。
