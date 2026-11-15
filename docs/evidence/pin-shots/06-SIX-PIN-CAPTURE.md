# 06 · 改前/改后像素对比的拍照口径（六钉）

分支 `feat/stair-flight`。本文只回答一件事：**让同一份代码两跑 PNG 逐字节相同，必须钉住哪几个值**，以及每根钉各挡哪一类漂移。它不是 eval 基线口径（见 `01-REPRO-MATRIX.md`），也不替代 `04-RENDER-INPUT-TABLE.md` 的字段全集——那张表回答「哪些字段进画面」，这张表回答「拍对比图时怎么钉」。

## 一、六钉与三条前置

「钉」= 把某个渲染输入固定成常量；「前置」= 本身不产生像素值、但不做就拍不准的动作。

| # | 钉住的值 | 松开会怎么漂 | 本轮实测 |
| --- | --- | --- | --- |
| 1 | `nowMs`（`pinShotState`，钉 00:35） | 日相、灯启闭、鸟、暗角随世界时刻走 | 见 §二 |
| 2 | `tideLevel`（同一次 `pinShotState`，钉 0） | 水线高度与水面着色 | 见 §二 |
| 3 | `actors`（`pinActors`，显式 `frame: 0`） | 站位/朝向/步态随等待时长走；`frame` 不钉则走相位随机 | 见 §二 |
| 4 | `trails`（`pinTrails`，整张表） | 痕迹只增不减，晚冻多几条脚印 | 见 §二 |
| 5 | 雨幕强度（`pinWeather(0, 0)` 的第一个参数） | 雨条数与整体压暗随时间回落 | §二 渡口 ±1 色阶 |
| 6 | 雨幕相位（`pinWeather` 的第二个参数） | 残雨细条按帧累积，位置逐帧换 | §二 街面 26 个细条区 |

三条前置：

1. 先把天气切到目标值并等它稳定（`debugSetWeather('clear')`），不要拿默认雨天直接拍。
2. `jumpWorldClock(35)` + `freezeWorldClock()`：先跳再冻，让世界时刻不再进入画面。
3. `waitVillagersSettled` → **上钉** → `waitFadeSettled` → 两帧 `requestAnimationFrame` → 隐藏 HUD → 只截 canvas。

顺序有两个硬要求：**钉必须在 `waitFadeSettled` 之前**（否则淡入淡出层会先按旧值画；等完再钉，第一帧已经脏了）；**截屏前至少两帧 rAF**（保证钉的值已经进入呈现）。相机也要固定：`centerCameraOn` 在 zoom≠1 时按屏幕半宽取景，要补 `width/2 * (1 - 1/zoom)`；本轮 zoom=1、设备比 2，截出来是 961×641 的 canvas 设备像素。

## 二、实测：只钉 now/tide 时，同码两跑不一致

夹具：`?world=dengchao&ledger=off&time=noon&debug=1&debugPinSeed=20261106`，晴天，街面机位（世界 352,505）、渡口机位（世界 120,121）。同一份代码连跑两轮，只钉 `nowMs` + `tideLevel` + 冻钟：

| 机位 | PNG 字节 | `screens-diff` 精确差 | 形态 |
| --- | --- | --- | --- |
| 街面 | 38351 vs 38361 | 0.15% | 26 个 2–4 × 10–14 px 的竖直细条，散布整幅画面 |
| 渡口 | 34697 vs 33294 | 83.83% | 整体 R/G 中位偏移 +1、B 为 0（16.2% 像素没变）；另有水面上的水平条带 |

补上 `pinActors` / `pinTrails` / `pinWeather(0, 0)`（六钉齐上）后，同码两跑：

| 机位 | 两跑 sha256（前 8 位） | 字节 |
| --- | --- | --- |
| 街面 | `afee1aca…` 两跑相同 | 37319 |
| 渡口 | `abad5f30…` 两跑相同 | 33298 |

`screens-diff` 精确差 0.0000%、结构块 0。

**推断（不是实测）**：细条归因为天气切换后的残雨、整体 ±1 归因为压暗层 alpha 还在回落，依据是形状、幅度与 `weatherIntensity` 的回落曲线；没有单独插桩读数。**实测**只有两条：只钉两类值时同码两跑不一致；钉满六类值时完全相同。

这就是今晚第二次「看起来钉住了、其实没钉住」——上一次是 eval 线的世界钟。共同点是**钉的是快照里的静态值，松的却是渲染路径上按帧累积的量**。

## 三、和 `04-RENDER-INPUT-TABLE.md` 的关系：`weather = stable` 有前提

04 把 `weather` 判成 `stable`，依据是那套夹具**从头到尾都是晴天**、`weatherIntensity()` 恒 0。本口径要在同一会话里从默认雨天切到晴天，切换后 intensity 仍在下落，残幕继续按帧画。所以：`weather` 的 `stable` 只在「天气从未变过」时成立；**拍图前切过天气，就必须显式钉 intensity 与相位**。反过来拍雨景要钉目标强度与固定帧数（`smoke` 的雨景口径是 0.86 / 24 帧）。

## 四、怎么复用

```js
// 1) 机位 → 天气 → 等角色站定
const box = await page.locator('canvas').first().boundingBox();
await page.evaluate(() => Oracle.setCameraMode('free'));
await page.evaluate(([x, y]) => {
  // zoom≠1 时 centerOn 按屏幕半宽取景，补偿量：width/2 * (1 - 1/zoom)
  const camera = Oracle.camera();
  const off = camera.width / 2 * (1 - 1 / camera.zoom);
  Oracle.centerCameraOn(x + off, y + off);
}, [cx, cy]);
await page.evaluate(() => Oracle.debugSetWeather('clear'));
await waitVillagersSettled(page);

// 2) 六钉：时刻/潮位/角色/痕迹/雨幕强度/雨幕相位
const now = await page.evaluate(() => {
  Oracle.jumpWorldClock(35);
  return Oracle.freezeWorldClock();
});
await page.evaluate((now) => {
  const snapshot = Oracle.view();
  Oracle.pinShotState(now, 0);
  Oracle.pinActors(snapshot.villagers.map((v) => ({
    id: v.id, pos: { x: v.pos.x, y: v.pos.y }, facing: v.facing,
    mode: v.mode, walking: v.walking, frame: 0, visible: v.visible,
  })));
  Oracle.pinTrails(snapshot.trails.map((t) => ({
    at: { x: t.at.x, y: t.at.y }, strength: t.strength,
  })));
  Oracle.pinWeather(0, 0);
}, now);

// 3) 前置：等淡入淡出 → 两帧 → 藏 HUD → 只截 canvas
await waitFadeSettled(page, box);
await page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
await page.locator('canvas').first().screenshot();
```

生产侧的同一套钉法见 `scripts/check-shot-actor-pin.mjs`、`scripts/smoke.mjs`（`PIN_SHOTS=1`）；一次性证据拍图可以直接照上面这段。

## 五、判据

- **钉住的判据是字节**：同一份代码两跑 sha256 相同才算钉住，差一个字节都不算。
- **改前/改后的判据也是字节**：`screens-diff` 精确差 0.0000% 才算「像素不变」；有差必须给出 bbox、像素数与原因，不调阈值。
- 做不到 0 差时，先找「哪根钉漏了」，不要先怀疑渲染本身。
