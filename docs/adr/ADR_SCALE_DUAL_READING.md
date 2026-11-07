# ADR：尺度类改动必须同时给常量读数与像素扫描读数

- status: aligned
- verified_at: 2026-11-04
- verified_by: agent，按证据核实，用户授权，2026-11-04
- evidence: `world-client/src/render/setting-scale.ts`, `world-client/scripts/check-setting-scale.mjs`, `world-client/test/setting-scale.test.ts`

- 状态：已接受
- 日期：2026-11-04
- 关联：`docs/SETTING_DENGCHAO.md`（灯潮界尺度）、`eval/screens/setting-scale.png`（对照图）

## 背景

尺度改动出过一次「常量对、画面错」：

- `drawShopfront` 里把墙顶写成 `top = -SHOPFRONT_TOP`（绝对值，本该是 `y - SHOPFRONT_TOP`），
  整排店面被画到世界原点附近、一像素也不在镜头里；
- 常量读数照样是 **48**（`SHOPFRONT_WALL_H + SHOPFRONT_STONE_H`），
- 逐像素扫描只量到 **6px**（那一列只剩别的构件）。

如果只看常量，这条改动会被判「通过」。**常量是绘制意图，扫描是渲染结果，两者不是同一件事。**

## 决策

凡是尺度类改动（墙高、柱高、灯体离地、人物与构件比例），回执**必须同时给出两个来源的读数**：

1. **常量读数**：渲染实际使用的那几个像素数（必须来自渲染层同一份常量，不许在回执里另抄一份）；
2. **像素扫描读数**：同一机位、同一冻结帧的截图里逐像素量出来的长度。

**两者不一致即为失败**，不许用「常量是对的」放过画面。

扫描口径：

- 扫描列要选在该构件上**连续涂装**的一段：店面选木框（从墙顶连续涂到石脚底边），
  灯柱选柱脚到灯体下沿那一截；
- 不要选会被格窗、门、招牌、角色、灯光覆盖的列；
- 1px 的口径差要写明（例：旧画法把灯体底下的 `ink` 衬线画在灯体外，注释里的 25
  实际净空是 24；新画法把衬线收进灯体最后一格，43 就是净空）。

## 理由

- 尺度是「画面上的长度」，只有像素能证明它真的长在了该长的位置；常量只能证明数字被算对了。
- 遮挡分层、光池这类改动也同一个道理：可测的读数要落在**渲染产物**上，不是落在意图上。

## 后果

- 落地位：`scripts/check-setting-scale.mjs` 每张图都同时打「常量 / 扫描」两行；
  `test/setting-scale.test.ts` 钉住常量之间的关系；扫描钉住画面。
- 读数来源必须诚实：`scripts/check-setting-scale.mjs` 拿不到
  `window.Oracle.debugSettingScale` 实测值时，打印 `[判据前提不成立]` 并**非 0 退出**，
  不退回改前基线常量继续判定——否则「通过」可能只是基线在和自己比。「环境没有这个
  钩子」与「钩子在但读数非法」分开报，后者带实际返回值。
- `SCALE_LABEL=before` 的例外**锁在 JSON 里**，不只靠控制台喊一句：该跑落盘的
  `setting-scale-before.json` 必须同时满足 `"metrics": null`、
  `"metricsSource": "改前基线常量（非实测）"`、`"metricsFromBaselineConstant": true`。
  任何消费方要把它们当读数，必须走 `scripts/lib/setting-scale-probe.mjs` 的
  `assertMeasuredReading`：来源不是实测就抛 `[判据前提不成立] 读数非法`，
  不许静默比较。`check-setting-scale.mjs` 的并排图合成已用它守两拍：拿基线常量
  去和实测值做差直接 `[改前/改后对比] 判红`。反例见
  `test/check-setting-scale-probe.test.ts` 与 `test/fixtures/setting-scale-hook-probe.mjs`
  的「拿基线常量去和实测值做差」一条。
- 反例脚本的运行口径：`test/fixtures/setting-scale-hook-probe.mjs` 依赖浏览器，
  **不进 `npm test`**；由改动本脚本或其读数口径的人，在收工前于本工作树手动跑
  `node test/fixtures/setting-scale-hook-probe.mjs`（自带桩页，不要求 vite、不读基线目录）。
  判绿口径：5 条全 PASS 且末尾打印「全部通过」——无钩子 exit 1、非法值 exit 1、
  合法值 exit 0、无钩子 + 改前声明 exit 0、拿基线常量做差 exit 1。
- 2026-11-08 因读数口径变更重拍了 `eval/screens/setting-scale-after.{png,json}`：
  五个尺度常量与 `metrics` 五个值均**未变**（`shopfrontH 48` 等），但扫描读数与
  渲染统计随当期构建变化（`frameH 48→13`、`stoneH 4→3`、`totalCommands
  12363→30021`、`graphicsObjects 46→155`），图像非逐字节相同。此次**未**重拍
  `before`，它仍是基线常量口径；并排图合成会被 `assertMeasuredReading` 判红。
- 「改前 / 改后」必须是同一机位、同一冻结帧、只差尺度这一件事；改前那一拍要先
  `git stash` 掉 `src/` 的改动，再拍 `before`，恢复后拍 `after`。
- 这条不替代别的闸门（预算、调色板、单测），只补上「尺度类改动」这一格的证据口径。

## 备选

| 方案 | 为什么没选 |
| --- | --- |
| 只给常量读数 | 就是上面那次失败：常量 48、画面在原点 |
| 只给截图，不放常数 | 截图读不出「该是多少」，没法判断是画错还是设计就是如此 |
| 用单测钉像素期望值 | 像素断言脆、改画法就红；扫描 + 人工对照图更稳 |
