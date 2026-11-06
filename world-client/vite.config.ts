import { defineConfig, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 独立原型：故意不接入主仓库的零构建前端（web/ 是原生 ES module + importmap）。
// 这里允许打包器存在，代价是原型目录自带 node_modules；主库一行不受影响。
//
// 端口与服务端地址可以用环境变量改：浏览器验收要开一份隔离实例
// （自己的事件库、自己的端口），不能去占开发时正在跑的那一份。
const apiTarget = process.env.PIXEL_WORLD_API ?? 'http://127.0.0.1:8000';
const clientPort = Number(process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211);

/**
 * 本工作树的绝对路径（vite.config.ts 所在目录的上一级）。
 *
 * 只读身份端点用它回答「这个服务是哪棵树起的」。`check-*` 拿它和自己的
 * 工作树比对：两棵树并行时，strictPort 只保证起不来会报错，保证不了
 * 测的对象是正确的那一棵。响应只有路径 / 端口 / 启动时间三样，不带别的。
 */
const worktree = dirname(dirname(fileURLToPath(import.meta.url)));

function treeIdentityPlugin(): Plugin {
  const handler = (startedAt: string) => {
    return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
      const pathname = (req.url ?? '').split('?')[0] ?? '';
      if (pathname !== '/__tree-id' && pathname !== '/__tree-id/') {
        next();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('allow', 'GET, HEAD');
        res.end();
        return;
      }
      const body = JSON.stringify({
        worktree,
        port: req.socket.localPort ?? 0,
        startedAt,
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(body);
    };
  };

  return {
    name: 'pwe-tree-identity',
    // 只挂 dev/preview：`build` 不触发这两个钩子，`apply` 再把「不进产物」
    // 写成显式约束，避免有人以后把配置改回 build 阶段。
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(handler(new Date().toISOString()));
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(new Date().toISOString()));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [treeIdentityPlugin()],
  server: {
    port: clientPort,
    strictPort: true,
    // 前端吃 `/api/events`（只增日志）与 `/api/world/intent`（意图）。
    // 走代理而不是直连 127.0.0.1:8000：浏览器看到的是同一个 origin，
    // 页面上不必为本地开发开 CORS，部署时换个反代也一样。
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
