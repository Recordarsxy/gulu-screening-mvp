import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { DemoAIProvider } from './demo/ai.js';
import { DeepSeekProvider } from './services/deepseek.js';
import { ensureDemoData, resetDemoData } from './demo/bootstrap.js';
import { createModeGateway } from './modes.js';

const dataRoot = resolve(process.env.GULU_DATA_DIR || 'data');
const demoRoot = join(dataRoot, 'demo');
mkdirSync(dataRoot, { recursive: true });
mkdirSync(demoRoot, { recursive: true });

const liveDb = openDatabase(join(dataRoot, 'gulu-screening.sqlite'));
const demoDb = openDatabase(join(demoRoot, 'gulu-screening.sqlite'));
migrate(liveDb);
migrate(demoDb);
ensureDemoData(demoDb);

const liveApp = createApp({ db: liveDb, dataRoot, mode: 'live' });
const demoApp = createApp({
  db: demoDb,
  dataRoot: demoRoot,
  mode: 'demo',
  deepSeek: new DemoAIProvider(),
  dynamicDeepSeek: new DeepSeekProvider(),
  resetDemo: () => resetDemoData(demoDb),
});
const app = createModeGateway({ liveApp, demoApp });
const dist = resolve('dist');
app.use(express.static(dist));
app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));

const port = Number(process.env.PORT || 4318);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`谷露筛选演示版 v1.4.0 已启动：http://127.0.0.1:${port}`);
});
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。请关闭已有实例，或设置其他 PORT 后重试。`);
  } else {
    console.error(`服务启动失败：${error.message}`);
  }
  process.exitCode = 1;
});

const shutdown = () => {
  server.close(() => {
    liveDb.close();
    demoDb.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
