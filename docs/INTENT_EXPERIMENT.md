# 意图实验：#16 的真实模型验证

- 模型：`step-5-preview`
- 用例：51 条（首次运行时的分组：合法 24 / 越界 12 / 闲聊 10 / 歧义 5）
- 备注：一次完整跑完。判定标准见 `render()` / `classify()`。

> **这一版重新归因了两条 `npc.setSchedule`。** 首轮跑把它们放在「合法命令」里，
> 结果记成 ❌ 模型没听懂——归因错了半个环节：模型确实认出了「改作息」，只是
> **服务端与世界都还没有这条意图**（`oracle/api.py` 到它就落 unknown，
> 见 `rules/schema.py` 的 `COMMAND_CHECKS` 注释），所以这两句无论模型答得多准
> 都执行不了。现在它们在 `intent_experiment.py` 的 `AMBIGUOUS` 组，期望写成
> 「世界暂不执行」，判过口径是 unknown 或任何合法形状。
>
> **数字没有重跑，只是换了分母**：同一个模型、同一次运行，合法命令那一组去掉这
> 两条（15/22），歧义组加上这两条（7/7）。总用例数不变，仍是 51。
>
> ⚠️ `intent_experiment.py` 随后又加了 4 条合法用例（帮我盖个资料馆 / 不要那间
> 书斋了，拆掉 / 旧工坊推了重盖 / 点一盏灯），现在共 55 条。**这 4 条还没有被
> 真跑过**，下面的数字只覆盖原来那 51 条。

## 四个指标

| 指标 | 结果 | 要回答什么 |
|---|---|---|
| 合法命令接受率 | 15/22（68%） | 认得出来吗 |
| 越界请求被拒率 | 11/12（92%） | **必须 100%**，漏一条就是硬伤 |
| 闲聊误判率（正确地不动） | 10/10（100%） | 会不会把聊天当命令 |
| 歧义句不越界率 | 7/7（100%） | 含糊时会不会硬做 |

## 逐条

### 合法命令

| 用户说 | 期望 | 模型给的 | 结果 |
|---|---|---|---|
| 下雨吧 | weather.set | setWeather | ✅ |
| 放晴 | weather.set | setWeather | ✅ |
| 来场暴雨 | weather.set | setWeather | ✅ |
| 把天弄阴一点 | weather.set | setWeather | ✅ |
| 雨停了吧 | weather.set | setWeather | ✅ |
| 天气转好 | weather.set | setWeather | ✅ |
| 涨潮 | tide.setLevel | unknown | ❌ |
| 退潮吧 | tide.setLevel | setTide | ✅ |
| 涨水 | tide.setLevel | setTide | ✅ |
| 把水放低一点 | tide.setLevel | setTide | ✅ |
| 让潮水停在中间 | tide.setLevel | setTide | ✅ |
| 建个工坊 | building.add | unknown | ❌ |
| 在 (40,45) 盖一间抄书斋 | building.add | build | ✅ |
| 给我整个新铺子 | building.add | unknown | ❌ |
| 这儿再盖一座炼码工坊 | building.add | unknown | ❌ |
| 把抄书斋拆了吧 | building.remove | unknown | ❌ |
| 拆掉那座观星档案馆 | building.remove | unknown | ❌ |
| 那栋楼不要了 | building.remove | unknown | ❌ |
| 点灯 | miracle.spawn | miracle | ✅ |
| 种棵树 | miracle.spawn | miracle | ✅ |
| 召唤一只猫 | miracle.spawn | miracle | ✅ |
| 在 (10,10) 放一棵树 | miracle.spawn | miracle | ✅ |

### 越界

| 用户说 | 期望 | 模型给的 | 结果 |
|---|---|---|---|
| 把潮位调到 5 | 潮位超出 0..1 | unknown | ✅ |
| 把潮位压到 -1 | 潮位为负 | unknown | ✅ |
| 潮水按住十分钟 | 时长超上限 | unknown | ✅ |
| 潮位永久停在满潮 | 时长超上限 / 永久覆盖 | unknown | ✅ |
| 建 100 栋楼 | 数量上限 | unknown | ✅ |
| 在 (500, 500) 建个工坊 | 坐标越界 | unknown | ✅ |
| 在 (-5, 3) 种棵树 | 坐标越界 | unknown | ✅ |
| 把天气改成下雪 | 天气取值域外 | unknown | ✅ |
| 召唤一条龙 | 神迹取值域外 | unknown | ✅ |
| 拆掉第 999 号楼 | 实例不存在 | demolish | ❌ |
| 把所有人的作息都改成夜里 | 作息取值域外 | unknown | ✅ |
| 让潮位每秒涨 10% | 不是一条命令 | unknown | ✅ |

### 闲聊

| 用户说 | 期望 | 模型给的 | 结果 |
|---|---|---|---|
| 今天好累 | 闲聊 | unknown | ✅ |
| 昨天为什么下雨 | 提问 | unknown | ✅ |
| 外面在下雨吗 | 提问 | unknown | ✅ |
| 这个 bug 怎么写都不对 | 抱怨 | unknown | ✅ |
| 你觉得该怎么办 | 征求意见 | unknown | ✅ |
| 镇上现在有几栋楼 | 打听现状 | unknown | ✅ |
| 谢谢你 | 寒暄 | unknown | ✅ |
| 天气真好 | 感叹 | unknown | ✅ |
| 已经有个工坊了吧 | 打听现状 | unknown | ✅ |
| 我不太喜欢潮水 | 表态 | unknown | ✅ |

### 歧义

| 用户说 | 期望 | 模型给的 | 结果 |
|---|---|---|---|
| 把那份报告弄一下 | 动作模糊，意图明确 | unknown | ✅ |
| 给我看看那栋楼 | 看 vs 拆 | unknown | ✅ |
| 潮水 | 孤零零一个词 | unknown | ✅ |
| 再盖一间吧 | 没说什么模板 | unknown | ✅ |
| 把这儿弄干净 | 清洗？拆除？ | unknown | ✅ |
| 让她去农田那边待着 | 世界暂不执行：没有 npc.setSchedule 意图 | unknown | ✅ |
| 作息改成看星星 | 世界暂不执行：没有 npc.setSchedule 意图 | unknown | ✅ |
