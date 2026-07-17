import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

const dataRoot = resolve(process.env.GULU_DATA_DIR || 'data'); mkdirSync(dataRoot, { recursive: true });
const db = openDatabase(join(dataRoot, 'gulu-screening.sqlite')); migrate(db);
const app = createApp({ db, dataRoot }); const dist = resolve('dist');
app.use(express.static(dist)); app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
const port = Number(process.env.PORT || 4318);
app.listen(port, '127.0.0.1', () => console.log(`谷露筛选 MVP 已启动：http://127.0.0.1:${port}`));
