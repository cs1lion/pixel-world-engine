# 动画表现力线 · 162 张验收截图基线变更清单

规则：**不静默覆盖**。旧基线取 `git show ab9ac9d:world-client/eval/...`，
新基线是本次重录的结果；每张图都跑了对应的生产脚本（不是复制、不是跳过）。
像素差 = RGBA 逐像素不同的格子数 / 总格子数；`逐字节相同` 表示重录了但输出没变。

- 总计：162 张（`eval/screens` 157 + `eval/live` 5）
- 变化：150 张；重录后逐字节相同：12 张
- 对应提交：全部图属于同一个代码提交 `d05edc7`（三步一起落在 `feat/animation-express`）；
  变更原因里的「第一/二/三步」是变化归因，不是三个独立提交。

| # | 文件 | 旧基线 sha256(12) | 新基线 sha256(12) | 像素差 | 为什么变 | 对应提交 |
|---|------|-------------------|-------------------|--------|----------|----------|
| 1 | `01-online.png` | `5903f2142fbd` | `77cbf13654d8` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 2 | `02-built.png` | `811ad6a4be2c` | `0dd2ebb8149a` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 3 | `03-refused.png` | `fd18e2fd0a6d` | `360e4c325043` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 4 | `04-offline.png` | `c846b6d268fe` | `282e4ed50efb` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 5 | `05-dengchao-built.png` | `f861ed563fbe` | `4b5b51ab346b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 6 | `01-salute.png` | `b6d5d92c7b8d` | `07add1f53d2e` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 7 | `02-working.png` | `5f2214dfda8c` | `0d3c9d4b78b6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 8 | `03-deliver.png` | `2d86d5b52844` | `58c204e3ac12` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 9 | `04-rain.png` | `6b63f598e7be` | `6a306428368b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 10 | `05-build.png` | `d11cd2f7fab8` | `b685c704ff43` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 11 | `06-faith.png` | `43e50643bdee` | `36daa69321d6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 12 | `07-debug-panel-1s.png` | `f3a93c66c1f2` | `23a58685df67` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 13 | `07-debug-panel-400ms.png` | `82a50824117a` | `1ffdaf71449b` | 391545px / 41.241% / bbox 170x51 | 调试面板 DOM，不由画布动画驱动；重录后应逐字节相同 | `d05edc7` |
| 14 | `07-debug-panel-filtered.png` | `62b9a9848445` | `ff9650c7f03e` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 15 | `07-debug-panel.png` | `44b44a5a1768` | `2e85d93388df` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 16 | `08-overlay-100.png` | `a3a131c11306` | `ec1426bcd5ec` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 17 | `08-overlay-200.png` | `6d0c6bcab9d6` | `0d9baa7925fb` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 18 | `08-overlay-400.png` | `1199fbfadb94` | `a43ff85e096c` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 19 | `banner-smoke-banner-both-t.png` | `e7f7062e9e90` | `f2c3de673510` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 20 | `banner-smoke-banner-both-t1.png` | `638e2360954c` | `664f247f79be` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 21 | `banner-smoke-banner-off-t.png` | `910762d8d6b1` | `f7c910040b63` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 22 | `banner-smoke-banner-off-t1.png` | `910762d8d6b1` | `f7c910040b63` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 23 | `banner-smoke-banner-shadow-t.png` | `e7f7062e9e90` | `f2c3de673510` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 24 | `banner-smoke-banner-shadow-t1.png` | `0fdfa76a39d8` | `bcae0cd17360` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 25 | `banner-smoke-banner-sway-t.png` | `910762d8d6b1` | `f7c910040b63` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 26 | `banner-smoke-banner-sway-t1.png` | `4d41f9b05a46` | `5e8c4e79d110` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 27 | `banner-smoke-pause-a.png` | `8ba71eb8c778` | `6fd5f44e2e07` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 28 | `banner-smoke-pause-b.png` | `8ba71eb8c778` | `6fd5f44e2e07` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 29 | `banner-smoke-shadow-dusk.png` | `e7f7062e9e90` | `f2c3de673510` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 30 | `banner-smoke-shadow-night.png` | `e616cd543721` | `10f69cf2a20c` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 31 | `banner-smoke-shadow-noon.png` | `49a8e3b03401` | `2cc77c84de4b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 32 | `banner-smoke-smoke-high-off-t2.png` | `feeb400792a3` | `6cb7aab1b5e8` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 33 | `banner-smoke-smoke-high-off.png` | `feeb400792a3` | `6cb7aab1b5e8` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 34 | `banner-smoke-smoke-high-on.png` | `6430b25c3192` | `3e9b4b7d45d9` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 35 | `banner-smoke-smoke-high-pair-t.png` | `6430b25c3192` | `3e9b4b7d45d9` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 36 | `banner-smoke-smoke-high-pair-t1.png` | `4f02980ee5fd` | `f73460ef6d58` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 37 | `banner-smoke-smoke-low-off-t2.png` | `6125385741b2` | `3d80920da83d` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 38 | `banner-smoke-smoke-low-off.png` | `6125385741b2` | `3d80920da83d` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 39 | `banner-smoke-smoke-low-on.png` | `1eeb1f7bc705` | `ae6880de537b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 40 | `banner-smoke-smoke-low-pair-t.png` | `1eeb1f7bc705` | `ae6880de537b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 41 | `banner-smoke-smoke-low-pair-t1.png` | `01482eb4369b` | `2e86012bc166` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 42 | `creation-ghost.png` | `cbe7f844ffae` | `fa7db8270b73` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 43 | `creation-rejected.png` | `4273fbe27e31` | `4c9307237c1b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 44 | `dengchao-noon.png` | `4478435a1fa4` | `6a410ab5bed8` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 45 | `dengchao-tide-high.png` | `1fae930f4dbf` | `581a590d17bc` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 46 | `dengchao-tide-low.png` | `24207f24ba94` | `7e4799675bce` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 47 | `ground-shadow-closed-a.png` | `4c48a891e45b` | `2636e0dcfcc6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 48 | `ground-shadow-closed-b.png` | `4c48a891e45b` | `2636e0dcfcc6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 49 | `ground-shadow-closed-t.png` | `30beb2443bf8` | `30beb2443bf8` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 50 | `ground-shadow-closed-t1.png` | `4c48a891e45b` | `2636e0dcfcc6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 51 | `ground-shadow-foot-dusk-3x.png` | `fac20d4b083e` | `6e97da5e3af8` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 52 | `ground-shadow-foot-dusk-off-3x.png` | `2eeb96fb2103` | `b5c5bdf88e08` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 53 | `ground-shadow-foot-dusk.png` | `99efaf473f0d` | `e533ade02ab0` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 54 | `ground-shadow-pause-a.png` | `a92958f26f0b` | `a48e8c13057b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 55 | `ground-shadow-pause-b.png` | `a92958f26f0b` | `a48e8c13057b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 56 | `ground-shadow-stall-dusk-off.png` | `4c48a891e45b` | `2636e0dcfcc6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 57 | `ground-shadow-stall-dusk-on.png` | `a92958f26f0b` | `a48e8c13057b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 58 | `ground-shadow-stall-night-off.png` | `99a8e9d1619f` | `d4f9fae74315` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 59 | `ground-shadow-stall-night-on.png` | `99a8e9d1619f` | `d4f9fae74315` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 60 | `ground-shadow-stall-noon-off.png` | `aebde6b74868` | `4e3d4b782285` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 61 | `ground-shadow-stall-noon-on.png` | `ad688b831ef4` | `ec816f677eda` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 62 | `ground-shadow-villager-dusk-off-1x.png` | `6671556e5009` | `6671556e5009` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 63 | `ground-shadow-villager-dusk-off.png` | `bafcdf6d54b3` | `44f2c77ba832` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 64 | `ground-shadow-villager-dusk-on-1x.png` | `9f07830f5402` | `9f07830f5402` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 65 | `ground-shadow-villager-dusk-on.png` | `4cc252192d0f` | `fc9efc27c4cc` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 66 | `ground-shadow-villager-night-off.png` | `304f89ea3db4` | `33bf194d20b2` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 67 | `ground-shadow-villager-night-on.png` | `304f89ea3db4` | `33bf194d20b2` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 68 | `ground-shadow-villager-noon-off-1x.png` | `fde0a9c083cc` | `fde0a9c083cc` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 69 | `ground-shadow-villager-noon-off.png` | `d1ee5d8d18e4` | `da149f7e3f5b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 70 | `ground-shadow-villager-noon-on-1x.png` | `671fa99527e5` | `671fa99527e5` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 71 | `ground-shadow-villager-noon-on.png` | `b97e7aacfe98` | `7c0114eeb890` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 72 | `lamp-band-after-dark.png` | `347a1c252a92` | `ef0dc99f1f9b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 73 | `lamp-band-after-lit.png` | `ee8fd38b5b91` | `380e23d1660f` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 74 | `lamp-band-after.png` | `8f6288fd3512` | `8096d116ee7e` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 75 | `lamp-band-before-dark.png` | `d33eb1a8b52e` | `d33eb1a8b52e` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 76 | `lamp-band-before-lit.png` | `1c814de26e9a` | `1c814de26e9a` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 77 | `lamp-band-before-seed-pinned-dark.png` | `1d3ae353903d` | `1d3ae353903d` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 78 | `lamp-band-before-seed-pinned-lit.png` | `1dc3567c137f` | `1dc3567c137f` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 79 | `lamp-band-before-seed-pinned.png` | `da50b2c9e52e` | `da50b2c9e52e` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 80 | `lamp-band-before.png` | `fd201cae6d2a` | `fd201cae6d2a` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 81 | `lamp-pool-curve-dark.png` | `2d194d8210b4` | `23802fa24767` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 82 | `lamp-pool-curve-lit.png` | `ca08661dc882` | `553fc111d387` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 83 | `lamp-pool-dark.png` | `e57786f9fb43` | `3b29609513b8` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 84 | `lamp-pool-lit.png` | `a4fd0a6f591d` | `fc8c1dde5427` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 85 | `lamp-pool-tide-10.png` | `003af74a73f6` | `f926686d0ca6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 86 | `lamp-pool-tide-100.png` | `a9388b7a6ef0` | `a5d07433f644` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 87 | `lamp-pool.png` | `ab6bb9b86e0f` | `dd6e2495042d` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 88 | `phase-dawn.png` | `c3cf3275e491` | `c6b4ee2d5dff` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 89 | `phase-dusk.png` | `90dbbc2fc762` | `b6c95a7d3a49` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 90 | `phase-night-rain.png` | `5a993da8f055` | `1a629ce32604` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 91 | `phase-night.png` | `7161e813fe39` | `aa7a73d8a5e3` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 92 | `phase-noon.png` | `12ec330c461a` | `db18797cffbe` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 93 | `placement-behind.png` | `98ff507f5f47` | `8061450568ea` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 94 | `placement-front.png` | `f0ec7690950a` | `2537beab29e5` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 95 | `placement-stall.png` | `eb713d0fce5f` | `8f960033fb82` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 96 | `scene-motion-1759.png` | `3e73a72998a2` | `fe3e32d02baa` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 97 | `scene-motion-1800-10.png` | `35374905add7` | `e2d835bf3a2c` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 98 | `scene-motion-1800-30.png` | `76bcddaa3aad` | `300ca1fe8ef9` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 99 | `scene-motion-1800.png` | `7f7082196b86` | `2b5f0b4fab63` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 100 | `scene-motion-1801.png` | `3c69783a7344` | `b23dd85333b9` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 101 | `scene-motion-1802.png` | `910bb2662dfa` | `95848c976b15` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 102 | `scene-motion-1803.png` | `75a79fb05503` | `70df93c2a55a` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 103 | `scene-motion-1804.png` | `971a08051945` | `cf63568119b9` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 104 | `scene-motion-1805.png` | `147190a7e4f4` | `9b43b7e1128d` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 105 | `scene-motion-1806-20.png` | `5bebbeedb9eb` | `cc433be384d1` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 106 | `scene-motion-1806.png` | `7b8106d6b8a0` | `6ac4abeb986c` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 107 | `scene-motion-1810.png` | `b13fc44c7154` | `35f3477f65c1` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 108 | `scene-motion-1811.png` | `7fd73ea787f7` | `dbd7820236f7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 109 | `scene-motion-all-off-t.png` | `32fc301c552d` | `a107905e52dd` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 110 | `scene-motion-all-off-t1.png` | `32fc301c552d` | `a107905e52dd` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 111 | `scene-motion-all-on-t.png` | `b13fc44c7154` | `f157040d4a83` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 112 | `scene-motion-all-on-t1.png` | `7fd73ea787f7` | `938230a6c72c` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 113 | `scene-motion-breathe-only-t.png` | `5c5a2ffc2ec1` | `ddfc87a07b90` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 114 | `scene-motion-breathe-only-t1.png` | `4d29cd47e28a` | `ffcd32df5443` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 115 | `scene-motion-dark-t.png` | `691170d5b861` | `56c359a3fc7f` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 116 | `scene-motion-dark-t1.png` | `691170d5b861` | `56c359a3fc7f` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 117 | `scene-motion-ignite-off-t.png` | `32fc301c552d` | `a107905e52dd` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 118 | `scene-motion-ignite-off-t1.png` | `32fc301c552d` | `a107905e52dd` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 119 | `scene-motion-ignite-only-t.png` | `9ef3f7b987b1` | `7a34dfec2bb6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 120 | `scene-motion-ignite-only-t1.png` | `bbbdc7e79e31` | `c35fba9ddea3` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 121 | `scene-motion-pause-a.png` | `b13fc44c7154` | `f157040d4a83` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 122 | `scene-motion-pause-b.png` | `b13fc44c7154` | `f157040d4a83` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 123 | `scene-motion-residual-after-lit.png` | `543e56d323f6` | `f6f97a61cada` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 124 | `scene-motion-residual-lit.png` | `b13fc44c7154` | `f157040d4a83` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 125 | `scene-motion-residual-never.png` | `543e56d323f6` | `f6f97a61cada` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 126 | `scene-motion-run2-1759.png` | `3e73a72998a2` | `1e0fbb0e642a` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 127 | `scene-motion-run2-1800-10.png` | `35374905add7` | `ef2da38a202e` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 128 | `scene-motion-run2-1800-30.png` | `76bcddaa3aad` | `1d963b650cb6` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 129 | `scene-motion-run2-1800.png` | `7f7082196b86` | `4fc9f021018b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 130 | `scene-motion-run2-1801.png` | `3c69783a7344` | `cbc30227fb12` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 131 | `scene-motion-run2-1802.png` | `910bb2662dfa` | `7cc0547c2348` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 132 | `scene-motion-run2-1803.png` | `75a79fb05503` | `89441b5be084` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 133 | `scene-motion-run2-1804.png` | `971a08051945` | `c9ddbd548738` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 134 | `scene-motion-run2-1805.png` | `147190a7e4f4` | `4782151f1f70` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 135 | `scene-motion-run2-1806-20.png` | `5bebbeedb9eb` | `c5331b406de4` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 136 | `scene-motion-run2-1806.png` | `7b8106d6b8a0` | `6b71191c6ee7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 137 | `scene-motion-run2-1810.png` | `b13fc44c7154` | `f157040d4a83` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 138 | `scene-motion-run2-1811.png` | `7fd73ea787f7` | `938230a6c72c` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 139 | `scene-motion-sway-only-t.png` | `e2236664f22a` | `1c39ec2bf1e7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 140 | `scene-motion-sway-only-t1.png` | `0ecb5a4a8300` | `481a5541bec7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 141 | `setting-scale-after.png` | `8f890f093427` | `f7488506e36a` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 142 | `setting-scale-before.png` | `e0ad22c588ea` | `e0ad22c588ea` | 逐字节相同 | 重录后逐字节相同：这张图不采样村民像素，或动画相位落在同一帧；不是回归 | `d05edc7` |
| 143 | `setting-scale.png` | `225d694f6fb4` | `3b82a5f3616a` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 144 | `stall-motion-both-off-t.png` | `a433419527e4` | `775af0cf2ffc` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 145 | `stall-motion-both-off-t1.png` | `a433419527e4` | `775af0cf2ffc` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 146 | `stall-motion-both-on-t.png` | `1a0fe870536e` | `a2d23f59dec1` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 147 | `stall-motion-both-on-t1.png` | `d30d065029bd` | `f8bdee60df6b` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 148 | `stall-motion-cover-off-t.png` | `ec35b7814250` | `15f345fcfcf7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 149 | `stall-motion-cover-off-t1.png` | `ec35b7814250` | `15f345fcfcf7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 150 | `stall-motion-cover-on-t.png` | `253ab009451d` | `f141044a6d7e` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 151 | `stall-motion-cover-on-t1.png` | `5d88b9d8d2fc` | `fd4d292017d7` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 152 | `stall-motion-fire-off.png` | `a433419527e4` | `775af0cf2ffc` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 153 | `stall-motion-fire-on.png` | `8602b18754bc` | `de4d045f66f5` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 154 | `stall-motion-only-cloth-t.png` | `232af4addfbe` | `69ef044eda95` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 155 | `stall-motion-only-cloth-t1.png` | `a93b1ef4a012` | `1d529fe48ad3` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 156 | `stall-motion-only-fire-t.png` | `8602b18754bc` | `de4d045f66f5` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 157 | `stall-motion-only-fire-t1.png` | `5d5f20a17e56` | `8359e653c981` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 158 | `stall-motion-pause-a.png` | `1a0fe870536e` | `a2d23f59dec1` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 159 | `stall-motion-pause-b.png` | `1a0fe870536e` | `a2d23f59dec1` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 160 | `stall-motion-rain.png` | `9169d65bc9b8` | `05bcdfc08ec3` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 161 | `stall-motion-repeat-t.png` | `232af4addfbe` | `69ef044eda95` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
| 162 | `stall-motion-repeat-t1.png` | `a93b1ef4a012` | `1d529fe48ad3` | 像素 0 / 字节不同（PNG 编码/元数据） | 画面像素 0 差异；只有 PNG 编码/元数据不同，不是动画回归 | `d05edc7` |
