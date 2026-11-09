# 基线字节自证（E13）

**一句话**：给 `eval/screens/` 的 166 个已跟踪文件记一份 sha256；字节一变就红，
换基线必须显式 `--update` 并把记录和图放进同一个提交。

## 为什么

这个仓库的像素证据全部建立在「拿这一次的截图去和一份固定的底片比」之上。
底片与运行产物**同名同址**（`setting-scale-after.png` 既是量测输入，又是
`--write-baseline` 的落盘目标），授权写入之后直接覆盖，**没有任何机关会发现**。

后果不是「这一次读数错了」，是：之后每一次比较都拿新字节当基准，而旧字节只能
翻 git 历史才拿得回来。「基线是 2026-11-08 那次重拍的已跟踪字节」这个前提，
会在无声无息中失效。

`shot-output.mjs` 已经解决了「写哪儿」（缺省 `tmp/screens/`，显式授权才写基线），
缺的是「**字节还是不是那一份**」。

## 修法

| 文件 | 做什么 |
| --- | --- |
| `world-client/eval/screens/.baseline-manifest.json` | 166 个已跟踪文件的 sha256，17,061 字节 |
| `world-client/scripts/lib/baseline-manifest.mjs` | 指纹、三分法 diff、确定性序列化、解析校验（纯函数） |
| `world-client/scripts/audit-baseline.mjs` | 闸门：默认校验、`--update` 换基、`--dir` 供红证 |
| `world-client/package.json` | `npm run audit:baseline` |
| `.github/workflows/ci.yml` | `world-client` job 第 8 步（`audit:ports` 之后） |
| `scripts/lib/shot-output.mjs` | 授权写基线时提示「写完必须 `--update` 并同提交」 |
| `scripts/check-setting-scale.mjs` | 删掉 `setting-scale-*.json` 里写死的 `"file"` 死字段 |

三类漂移**分开报**，因为对应三种不同的错：

| 类别 | 含义 | 该做什么 |
| --- | --- | --- |
| `changed` | 记过、在、字节变了 | **有人换掉了基线**（本条要抓的就是这个） |
| `missing` | 记过、文件没了 | 基线被删或改名 |
| `unlisted` | 在、没记过 | 新基线没进记录，等于它从来不可自证 |

两条「不许算通过」：**记录不存在**判红（「没有记录」只等于「从来不可自证」）；
**记录读不懂**（版本不符 / 指纹不是 64 位）也判红，不退回空表。

确定性：键排序、两空格、末尾换行。同样的输入必须写出逐字节相同的记录，
否则「记录自己有没有被改过」又要靠人看 diff。

## 红证 [实测]

全部在 `world-client/tmp/baseline-proof/` 的**拷贝**上做，没动仓库里的任何一个字节。

| # | 场景 | 期望 | 实测 | exit |
| --- | --- | --- | --- | --- |
| 1 | 完整拷贝，原样 | 通过 | `记录 166 / 已跟踪 0 / 全部一致` | 0 |
| 2 | 追加一个 `\x00` 到 `01-salute.png` | 只报 1 个 changed | `changed 1 / missing 0 / unlisted 0`，点名 `a5b6deda189a… → dd023d3d060d…` | 1 |
| 3 | 删掉 `02-working.png` | 报 missing | `missing 1`，点名 `02-working.png` | 1 |
| 4 | 对未跟踪目录 `--update` | 拒绝 | `下没有已跟踪文件，没有可入账的基线` | 1 |
| 5 | `--update` 连跑两次 | 记录逐字节相同 | sha256 都是 `678077bb0100…` | 0 |

第 3 步前先跑过一次「只拷 `*.png` 不拷 `.json`/`.html`」的残缺拷贝，闸门**正确点名了
12 个 missing**（`banner-smoke.json`、`setting-scale-after.json`、`scene-motion.html` …）
——那次是我的拷贝漏了文件，不是闸门的错，但正好当了一次「missing 真的会点名」的实证。

## 读数

- 规模：166 个文件 / 8.1 MB；记录 17,061 字节。
- 耗时（各 3 次，含 node 启动）：校验 604–662 ms，`--update` 664–702 ms（全量 sha256，没有缓存）。
- 单测：`test/baseline-manifest.test.ts` 8 条（diff 三类、排序确定性、解析三种坏输入、
  排除记录自身、端到端改一字节定位）。
- **基线字节未变**：`git diff --stat -- eval/screens/` 为空——这一笔只加记录，不碰底片。

## 没做什么

- **不在闸门里自动 `--update`**：闸门只能保证「变了就红」，不能保证「红之后没人乱点
  `--update`」，但那已经是逐条 `old→new` 的显式动作，不再无声。
- **不覆盖 `docs/evidence/`**：那里是给人看的证据图，靠各自 README 的读数说话，
  不是逐字节比较的输入。
- **没有让 `check-setting-scale` 进 browser job**：这条闸门管字节，不管「那个脚本
  有没有被跑过」，两件事不混。
