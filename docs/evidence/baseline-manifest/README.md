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
| `world-client/eval/screens/.baseline-manifest.json` | 166 个已跟踪文件的指纹，17,174 字节；文本按 LF 归一、二进制按原字节 |
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
| 5 | `--update` 连跑两次 | 记录逐字节相同 | sha256 都是 `c04a30bf11a3…`（v2 记录） | 0 |

第 3 步前先跑过一次「只拷 `*.png` 不拷 `.json`/`.html`」的残缺拷贝，闸门**正确点名了
12 个 missing**（`banner-smoke.json`、`setting-scale-after.json`、`scene-motion.html` …）
——那次是我的拷贝漏了文件，不是闸门的错，但正好当了一次「missing 真的会点名」的实证。

## 读数

- 规模：166 个文件（154 PNG + 9 JSON + 3 HTML）/ 8.1 MB；记录 17,174 字节（sha256 `c04a30bf11a3…`）。
- 耗时（各 3 次，含 node 启动）：校验 604–662 ms，`--update` 664–702 ms（全量 sha256，没有缓存）。
  同一份代码在更快的机器上 review 复现为 334–401 ms——这是机器读数，不是方法开销。
- 单测：`test/baseline-manifest.test.ts` 11 条（diff 三类、排序确定性、解析三种坏输入、跨平台指纹、
  「另有 N 个」的截断回归、加载器只吞「文件不在」（语法错必须原样抛）、
  排除记录自身、端到端改一字节定位）。
- **基线字节未变**：`git diff --stat -- eval/screens/` 为空——这一笔只加记录，不碰底片。

## 跨平台：第一次跑 CI 就红了

PR #37 的 `world-client` job 24 秒红在 `npm run audit:baseline`：**12 个文本文件**
（`setting-scale-*.json`、`stall-motion.json`、`scene-motion.html` …）全被判「字节变了」，
而 154 个 PNG 一个没动。

根因不是闸门坏了，是**我记错了「字节」**：本仓 `core.autocrlf=true`，`.json` / `.html`
在库里是 `i/lf w/crlf`——Windows 工作区读到 CRLF，Linux runner checkout 出 LF。
我拿 Windows 磁盘字节取 sha256，等于把「平台的行尾」当成了「基线的身份」。

修法（记录版本 1 → 2）：

- **文本按 LF 归一后取指纹**，二进制按原字节；
- 文本/二进制不按扩展名猜，用 **git 自己的判据**：前 8000 字节里出现 NUL 即二进制。
  PNG 里本来就有 2 个 `\r\n` 字节对，无条件替换会把它算出第三个指纹；
- `--update` 顺带修了一个实现缺陷：记录版本不符时校验该红，但**换基路径**不该被自己
  拦住——现在 `--update` 会声明「按重建处理，没有逐条 old→new」后继续。

验证：把 12 个文本文件转成 LF 的**拷贝**上跑校验 → `记录 166 / 已跟踪 0 / 全部一致`；
PNG 指纹不变（`01-salute.png` 仍是 `a5b6deda189a…`），`setting-scale-after.json` 变成 CI
看到的那个值 `3720ae2c3ba5…`。第一次红是它自己的跨平台误报，不是基线被覆盖——
但那句「字节与记录不符」正是它该说的话，只是这次说给了作者听。

## 没做什么

- **不在闸门里自动 `--update`**：闸门只能保证「变了就红」，不能保证「红之后没人乱点
  `--update`」，但那已经是逐条 `old→new` 的显式动作，不再无声。
- **不覆盖 `docs/evidence/`**：那里是给人看的证据图，靠各自 README 的读数说话，
  不是逐字节比较的输入。
- **不覆盖 `eval/live/`**：那儿有 5 张已跟踪的验收图（`01-online.png` … `05-dengchao-built.png`），
  而写入路径更松——`scripts/accept-live.mjs:36` 的 `OUT` 是
  `process.env.EVAL_LIVE_OUT ?? resolveShotDir('accept-live')`，**环境变量一设就整条绕过
  `resolveShotDir`**，连「这是仓库基线」的提示都不会出现。它们算不算必须自证的基线，
  要单独定；在那之前，重拍 `eval/live/` 仍然是无声的。
- **没有让 `check-setting-scale` 进 browser job**：这条闸门管字节，不管「那个脚本
  有没有被跑过」，两件事不混。
