# 孤儿闸门检测

一句话：回答「仓库里哪些检查脚本没有任何东西在跑」，并在**新增**一个没人调用的检查时变红。

## 三关（判据）

### 关 1：什么算「检查」

两个判据，任一命中即算，不靠模糊匹配：

1. 路径是任意 `scripts/` 目录下的 `check-*` 或 `audit-*`，扩展名 `.mjs` / `.ts`。
   只认 `scripts/` 的直接子文件，不向下递归。
2. npm 脚本名以 `test:` / `audit:` / `fixture:` / `check:` / `baseline:` 开头。

不算检查：普通测试文件（`*.test.ts`）、不带这些前缀的 npm 脚本（如 `build`、`preview`、`worktrees:audit`）。

### 关 2：什么算「有消费方」

从 `.github/workflows/*.yml` 的 `run:` 出发，沿下面三条边可达即算：

1. workflow 的命令里出现 `npm run X` / `npm test` / `node scripts/...`。
   支持单行 `run:` 与 `- run: |` 多行块；`#` 开头的注释行不计。
2. 被调用 npm 脚本的体内再出现 `npm run Y` / `node scripts/...`。
3. 已到达的 JS/TS 文件用相对路径 `import` / `import()` / `require` 到的文件，逐跳追。

支持 job 级与 step 级 `working-directory`。不追：child_process 拼字符串的调用、composite action、仓库外脚本。

### 关 3：允许清单

`scripts/orphan-gates-allowlist.json`。每条必须写：

- `id`：`file:<相对路径>` 或 `npm:<包>#<脚本名>`；
- `reason`：这个检查是什么；
- `acceptedBecause`：为什么现在可以不接 CI。

以下四种情况直接红：

1. 有孤儿没登记；
2. 清单指向不存在的检查（防止清单自己烂掉）；
3. 清单条目已经有了消费方（说明该删了，不能让「临时接受」变成永久挡箭牌）；
4. 缺 `reason` / `acceptedBecause`，或重复登记。

## 命令与输出

```bash
npm run audit:orphan-gates
```

输出三桶：**有消费方**（附消费路径）、**已知孤儿（允许清单）**（附理由）、**新孤儿（未登记）**，再加**允许清单问题**。
没有未登记孤儿且清单自洽时退出 0，否则退出 1。

## CI

`.github/workflows/ci.yml` 的 `repo-harness` job 多一步。只用 node 内置模块，不需要 `npm ci`、不需要浏览器。

具体读数不写死在文档里（它会随检查数增长）：第一次运行的完整清单见引入这个闸门的提交说明。

## 新增一个检查时

- 要进闸：接进 workflow，或让一个已被调用的脚本 `import` 它；同一提交里把清单对应条目删掉。
- 暂不进闸：在清单加一条，写清 `reason` 与 `acceptedBecause`。
- 两件都没做：CI 红。
