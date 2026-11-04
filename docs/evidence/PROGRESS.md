# 进入室内 · 分块进度

分支 `feat/interior-view`（基于 `feat/env-frame` 的 `d353c26`）。每块独立证据目录，
基线先落盘再改；下文三档分开写：**做到的 / 没做到的 / 未验证的**。

---

## 块 1 · 拆屋顶层 + 进门推进过渡 + 单层内景 + 门退出

- 证据目录：`docs/evidence/interior-view/`（`INDEX.md`、`shots/`、`readings.json`、`analysis.json`）
- 改动：
  - `src/render/buildings.ts`：屋顶/烟囱拆成独立 `roof` Graphics（绘制顺序不变）
  - `src/render/interior-layout.ts`：纯函数——房间尺寸、`wallSeed`、家具布局、过渡进度（固定 18 帧）
  - `src/render/interior-view.ts`：烘焙内景 + 暗场，屏幕坐标（`scrollFactor 0`、`scale=2/zoom`），深度 20000+
  - `src/ui/interior-view-store.ts`：视图状态只写 `pwe.interior.view`，读档只清不还原
  - `src/scenes/SandboxScene.ts`：进门/退出状态机、相机推进、门与楼梯命中、街景 DOM 浮层隐藏、`?interior=instant|step`
  - `scripts/interior-capture.mjs`、`scripts/interior-analyze.py`：取证与读数
  - `test/interior-view.test.ts`：9 条布局/种子/过渡用例

### 验收读数

| 项 | 读数 |
| --- | --- |
| 街景 → 室内 Graphics / 指令 | 27 / 16130 → 30 / 16152（**+3 / +22**） |
| 过渡 | 18 帧；中点帧 `frames=9`、`mode=entering`、相机 `484/352` |
| 往返位姿 | 1 次与 10 次都读到 `528/416/zoom 2`，逐字相同 |
| 真点门退出 | `mode=street`，位姿与进门前逐字相同 |
| 真点楼梯 | 反馈帧数 60（截图时剩 29） |
| 内景唯一色数 | 13（≤ 24）；调色板外 **0** |
| 冻结 1 秒 | **0 像素差**（573 476 px 全同） |
| 三枚指纹 | `trace:record` / `trace:replay` 两次逐字相同、与录制一致 |
| 存档 | v5、`3ca5663faee59423` 未动 |

### 真问题（已修）

1. 内景「缩在左上角」= 世界相机 zoom 下的**裁切**，不是摆歪 → 改屏幕坐标。
2. `cameraCenter` 原本按 `width/(2·zoom)` 算错：Phaser 的中心是 `scroll + width/2`（与 zoom 无关）。
3. 室内点击全灭：`pointerdown` 在室内提前 return，没清 `pressMoved`。
4. 冻结帧 1032 px 差：DOM 人名/小地图压在内景上并继续动 → 进屋隐藏。
5. 唯一色数 321：半透明叠色产出调色板外 RGB → 内景改全不透明。
6. 指令增量读 0：Graphics 塞进 Container 后 `renderStats()` 数不到 → 改数组。
7. 取证点门点空：`locator.screenshot()` 滚动视口 → 每次点击前重读 `boundingBox()`。

### 没做到的

- 楼梯不切层（下一块）。
- 只目视验了 `code_forge` 的内景；民居/档案楼只有单测覆盖布局，没拍图。

### 未验证的

- `npm run test:browser`：第 31 项后「等交付」超时。该流程不经过内景；实测 120 s 只走
  1.81 M ms 世界时间，而 code 活需 1.8 M ms，**预算卡在边界**（既有用例的时间余量问题）。
- `npm run test:buttons`：`/api/memory/list` 回 404，数据源缺，按纪律标未验证。

### 闸门

`check` ✅ / `test` 2099 通过 0 失败 ✅ / `build` ✅ / `audit-palette` ✅ /
`audit-references` ✅ / `audit-sections` ✅ / `audit-citations` ✅ / `audit-claims` ✅（README 测试文件数 223→224）/
`adr-schema` ✅ / `test:persistence` ✅ / `test:phases` ✅ / `test:render-budget` ✅ /
`trace:record` + `trace:replay` ✅ / `test:browser` ❌（见上） / `test:buttons` ⚠️ 未验证

### 阻塞

无阻塞。块 2 的入口：楼梯坐标已登记在 `interiorLayoutFor`（`stairs` 矩形），
点击已经在 `InteriorView.hitTest` 里分流；切层只要把 `floor` 变成状态、用
`interior:<instanceId>:f<floor>` 再烘一张即可——不需要动世界状态与 v5。
