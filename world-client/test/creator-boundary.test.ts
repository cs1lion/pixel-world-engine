import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 边界红线：**造物主没有旁路**。
 *
 * v1.0 §0 原文：
 *
 * > 造物主各角色（解读者/美术监督/地图师/史官/导演/审校）**严禁直接修改
 * > 底层记忆表或信念表**；所有对世界的修改必须封装为受校验的`创世指令`
 * > （如 `CreateRegion`、`PlaceBuilding`、`SpawnCharacter`、`SeedHistory`、
 * > `InjectEvent`），经引擎校验通过后转化为标准 `Event` 进入世界。
 *
 * 1027 迭代任务 2 的 README 把这条列为第 6 个要回答的问题，并且写明：
 * 「这条与仓库现有做法一致（`server/rules/schema.py` 是唯一闸门），
 * 落地时应有一条测试锁住『造物主没有旁路』」。
 *
 * 本文件就是那道锁。它不测行为，测**依赖形状**——因为行为测试只能覆盖
 * 想得到的路径，而一条 `import { MemoryWorld }` 就能让某人在任何地方写出旁路。
 *
 * 为什么用静态扫描而不是运行时断言：外环模块是纯函数与类，不必启动世界即可
 * 检查它们的可见面。静态面收窄之后，运行时再怎么写也只能在禁令范围内打转。
 */

const CREATOR_DIR = join(import.meta.dirname, '..', 'src', 'world', 'creator');
const CREATOR_ENTRY_FILES = [
  join(import.meta.dirname, '..', 'src', 'world', 'director.ts'),
];

/** 记忆层与信念层：造物主一个都不许直接碰。 */
const FORBIDDEN_MODULES = [
  'memory/world',
  'memory/runtime',
  'memory/types',
  'memory/observed',
  'memory/propagate',
  'memory/consolidate',
  'memory/recall',
  'memory/salience',
  'memory/legend',
  'memory/traces',
  'memory/written',
  'world-changes',
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** 取出一个文件里所有 `from '...'` / `import '...'` 的模块说明符。 */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    specs.push(match[1]!);
  }
  return specs;
}

const creatorFiles = [...listTsFiles(CREATOR_DIR), ...CREATOR_ENTRY_FILES];

test('扫描到了造物主的全部源文件——空扫描不能让这条测试变成假通过', () => {
  assert.ok(creatorFiles.length >= 5, `只扫到 ${creatorFiles.length} 个文件，扫描本身可能坏了`);
});

test('造物主模块不 import 记忆表、信念表或世界变更日志', () => {
  const offenders: string[] = [];

  for (const file of creatorFiles) {
    const source = readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      // 解析成相对 `src/world/` 的路径再比。只按最后一段比会把
      // `../types.ts`（`src/world/types.ts`，纯类型定义）误判成
      // `memory/types.ts`——那道闸门会因此永远响，最后被人关掉。
      const resolved = relative(
        join(import.meta.dirname, '..', 'src', 'world'),
        join(join(file, '..'), spec),
      )
        .replace(/\\/g, '/')
        .replace(/\.ts$/, '');

      if (FORBIDDEN_MODULES.includes(resolved)) {
        offenders.push(`${relative(process.cwd(), file)} → ${spec}（解析为 ${resolved}）`);
      }
    }
  }

  assert.deepEqual(offenders, [], `这些依赖是越界旁路：\n${offenders.join('\n')}`);
});

test('造物主不读写记忆层与信念层的字段名', () => {
  // 依赖收窄了还要防「拿了数据结构自己拼」。这几个词只属于记忆层：
  // `memoryId` 是记忆条目主键、`claimId` 是信念断言主键、`holderId` 是持有者。
  // 造物主能看见的是「角色」「建筑」「区域」，不是这三样。
  const forbiddenTokens = ['memoryId', 'claimId', 'holderId', 'MemoryEntry', 'Belief'];
  const offenders: string[] = [];

  for (const file of creatorFiles) {
    const source = readFileSync(file, 'utf8');
    for (const token of forbiddenTokens) {
      const re = new RegExp(`\\b${token}\\b`);
      if (re.test(source)) {
        offenders.push(`${relative(process.cwd(), file)} 出现 ${token}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `造物主碰了记忆层的字段：\n${offenders.join('\n')}`);
});

test('造物主能拿到的世界状态是只读视图，没有写入方法名', () => {
  // `WorldStateView` 是造物主向世界提问的唯一窗口。它必须是只读的：
  // 任何 write/commit/apply/persist 之类的方法名出现在这个接口里，
  // 都是「绕过创世指令直接改世界」的入口。
  const schema = readFileSync(join(CREATOR_DIR, 'schema.ts'), 'utf8');
  const viewMatch = schema.match(/export interface WorldStateView\s*\{([\s\S]*?)\n\}/);
  assert.ok(viewMatch !== null, '找不到 WorldStateView 接口');

  const body = viewMatch[1]!;
  const writeVerbs = /\b(write|commit|apply|persist|mutate|set|update|delete|remove|save)\w*\s*[(:]/gi;
  const hits = [...body.matchAll(writeVerbs)].map((m) => m[0]);
  assert.deepEqual(hits, [], `WorldStateView 上出现了写操作：${hits.join(', ')}`);
});

test('五条创世指令就是全部入口，没有第六种', () => {
  const schema = readFileSync(join(CREATOR_DIR, 'schema.ts'), 'utf8');
  const kinds = schema.match(/GENESIS_COMMAND_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  assert.ok(kinds !== null, '找不到 GENESIS_COMMAND_KINDS');

  const listed = [...kinds[1]!.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, [
    'CreateRegion',
    'PlaceBuilding',
    'SpawnCharacter',
    'SeedHistory',
    'InjectEvent',
  ]);
});

test('造物主没有 import 任何能直接改世界的运行时类', () => {
  // 这几个类是内环的写入方（`MemoryWorld` 持有订阅表与写入队列）。造物主
  // 拿到它们就等于拿到了旁路，哪怕只调用只读方法——接口一旦可见，
  // 下一次改动就会有人顺手用上写方法。
  const runtimeClasses = ['MemoryWorld', 'MemoryRuntime', 'WorldChanges', 'EmitBus'];
  const offenders: string[] = [];

  for (const file of creatorFiles) {
    const source = readFileSync(file, 'utf8');
    for (const cls of runtimeClasses) {
      if (new RegExp(`\\b${cls}\\b`).test(source)) {
        offenders.push(`${relative(process.cwd(), file)} 出现 ${cls}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `造物主拿到了内环写入方：\n${offenders.join('\n')}`);
});
