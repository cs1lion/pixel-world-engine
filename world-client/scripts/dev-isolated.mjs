#!/usr/bin/env node
// 起一份**隔离**的前端实例：自己的端口、自己的 API 指向。
//
// `vite.config.ts` 从 `PIXEL_WORLD_API` / `PIXEL_WORLD_CLIENT_PORT` 读这两个值，
// 而 `.claude/launch.json` 的条目没法设环境变量。浏览器验收要的正是隔离实例——
// 自己的事件库、自己的记忆目录——不能去占开发时正在跑的那一份（端口 5188 的
// 那份吃的是 `data/events.db`，验收时往里写一条就把演示数据弄脏了）。
//
// 所以这个脚本只做一件事：把命令行上的两个值塞进 env，再原样调 vite。
// 它不认识 vite 的任何参数，全部转发。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..');
const viteBin = path.join(clientRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const args = process.argv.slice(2);

function valueOf(flag) {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const value = args[at + 1];
  // 吃掉这一对，剩下的原样转给 vite。
  args.splice(at, 2);
  return value;
}

const api = valueOf('--api');
const port = valueOf('--port');

if (api !== undefined) process.env.PIXEL_WORLD_API = api;
if (port !== undefined) process.env.PIXEL_WORLD_CLIENT_PORT = port;

// vite 的根必须是 world-client/：不带这个参数它会把**仓库根**当根，
// 于是找不到 world-client/vite.config.ts，端口与代理两条都退回默认值——
// 表现是「明明起了隔离实例，浏览器却连到了开发那一份」。
const child = spawn(process.execPath, [viteBin, clientRoot, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 1);
});
