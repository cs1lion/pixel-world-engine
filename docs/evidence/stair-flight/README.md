# 台阶收敛交付报告（P2 · 2026-11-06）

本报告按当年的交付报告规范写。机器可读块在文末；正文只讲结论、口径和人工检查点。
> 2026-11-15 补记：本次只合入 stairFlight 核心代码，配套的交付报告审计脚本未接线，
> 文末机器可读块目前**没有自动审计者**；该闸门另起一单先定 R6 时间判据。

<!-- delivery
{
  "artifacts": [
    { "path": "docs/evidence/stair-flight/before-street.png", "bytes": 37319,
      "sha256": "afee1acaa91b87009ab8bd5db5ea41476a948231d65dd1035300adc109359ed7" },
    { "path": "docs/evidence/stair-flight/after-street.png", "bytes": 37319,
      "sha256": "afee1acaa91b87009ab8bd5db5ea41476a948231d65dd1035300adc109359ed7" },
    { "path": "docs/evidence/stair-flight/before-ferry.png", "bytes": 33298,
      "sha256": "abad5f30a06ab8b68d05112e7aeb883337e8849fd1ca3ccd07ab89d1b6a38b81" },
    { "path": "docs/evidence/stair-flight/after-ferry.png", "bytes": 33298,
      "sha256": "abad5f30a06ab8b68d05112e7aeb883337e8849fd1ca3ccd07ab89d1b6a38b81" },
    { "path": "docs/evidence/stair-flight/reverse-diff.json", "bytes": 4050,
      "sha256": "ee0f2a4c68da05ff0d4e27fe1f55cba489f091a264a217ec0d242e1ff81c60c2" }
  ],
  "checks": [
    { "name": "npm run check", "exit": 0 },
    { "name": "npm test", "exit": 0 },
    { "name": "node scripts/red-first.ts --base a03a1cb", "exit": 0 },
    { "name": "python scripts/screens-diff.py --old before --new after", "exit": 0 }
  ],
  "diff": { "method": "byte-exact", "threshold": 0, "size": "961x641", "shots": 4,
            "scope": "整幅 canvas（设备像素 961×641）；街面机位（世界 352,505）与渡口机位（世界 120,121）；改前/改后各一次" },
  "status": { "state": "local-commit", "sha": "b351244d86d5fc3fe043211255e51a2e30627cef",
              "branch": "feat/stair-flight", "pushed": false, "pr": false },
  "reportedAt": "2026-11-07T12:40:00+08:00",
  "inferences": [
    { "claim": "只钉时刻/潮位时街面出现的 26 个竖直细条来自切换天气后的残雨",
      "basis": "形状为 2–4 × 10–14px 的竖直条、只出现在未钉 weather 的两跑，补 pinWeather(0,0) 后完全消失" },
    { "claim": "渡口只钉两值时整体 ±1 色阶来自压暗层 alpha 回落",
      "basis": "R/G 中位偏移 +1、B 为 0、16.2% 像素未变，方向与 weatherIntensity 回落一致；未单独插桩读数" }
  ]
}
-->

## 交付内容

- 台阶几何收敛成一个纯生成器 `render/stair-flight.ts`（不 import Phaser），街面 4 级与渡口 3 级两个调用点都改喂它，原来两段 `step <` 写死循环已删。
- 形制写回数据：`street_steps` = 4 级 × 4px、`ferry_quay` = 3 级 × 4px；渲染层不再用 `?? 0` 兜底，缺 `treads`/`rise` 由 `stairFlight()` 点名抛错。
- 本报告原是交付报告规范的第一个符合样例；审计脚本未随本次合入，样例留作后续接线时的真实输入。

## 实测（命令 + 原始输出）

```
npm run check
check-types：语法 0 处 / 语义 0 处
```

```
npm test
# tests 2469
# pass 2460
# fail 0
# skipped 9
```

```
node scripts/red-first.ts --base a03a1cb
red-first: PASS base 上按预期红（断言失败，exit=1）
red-first: RESULT=RED elapsed=4989ms
```

改前/改后四张截图 **逐字节相同**（同 sha256、同字节数）；`screens-diff` 精确差 0.0000%、结构块 0。
反向用例 `rise 4→5` 的截图差异在 `reverse-diff.json`：`street.png` 变 1000 像素 / 0.1623%，
bbox `[417,335,544,344]`，2 个结构块；`ferry.png` 完全不变（只改了街面数据）。

## 推断（不是实测）

两条推断都以 `basis` 写进块里：残雨细条、压暗层 ±1。它们没有插桩读数，
依据是形状/幅度/单调性；**不能当成实测引用**。

## 提交与推送

`feat/stair-flight` 上 `b351244d86d5fc3fe043211255e51a2e30627cef`，**本地提交，未 push、无 PR**。
本报告文件随下一个提交入库，其自身 sha 见 git 历史（`status` 描述的是被报告的工作，不是报告文件）。

## 人工检查点（lint 查不了，本报告逐条核过）

1. R1：哈希对应的是这一次采集的产物（同名文件未被后续运行覆盖）。人工核对：`before/` 与 `after/` mtime 相差 7 分钟，且 after 两跑与 before 两跑 sha 相同。
2. R2：命令确实在这次交付里跑过。人工核对：`npm test` 与 `red-first` 的输出是当次终端回显。
3. R3：两组图分辨率一致（961×641），`scope` 未漏掉变化区。尺寸来自 `reverse-diff.json` 的 `oldSize/newSize`。
4. R4：实测/推断归类。人工核对：细条与 ±1 的成因是推断，其余计数与哈希是实测。
5. R5：远端是否真的没有该分支。人工核对 `git ls-remote --heads origin feat/stair-flight` 输出为空；PR 未创建。
6. R6：已跟踪产物（入库后）的时间戳不可信，以本文件记录的产物 mtime 与 `reportedAt` 为准。
