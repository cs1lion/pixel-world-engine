import { defineConfig } from 'vite';

// 独立原型：故意不接入主仓库的零构建前端（web/ 是原生 ES module + importmap）。
// 这里允许打包器存在，代价是原型目录自带 node_modules；主库一行不受影响。
//
// 端口与服务端地址可以用环境变量改：浏览器验收要开一份隔离实例
// （自己的事件库、自己的端口），不能去占开发时正在跑的那一份。
const apiTarget = process.env.PIXEL_WORLD_API ?? 'http://127.0.0.1:8000';
const clientPort = Number(process.env.PIXEL_WORLD_CLIENT_PORT ?? 5188);

export default defineConfig({
  base: './',
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
