import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = process.env.PORT || '4318';
const localUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist-server/server/index.js'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, PORT: port } });
let ready = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch(`${localUrl}/api/health`);
    if (response.ok) { ready = true; break; }
  } catch { /* server is still starting */ }
  await delay(250);
}
if (!ready) { child.kill(); throw new Error('本机服务启动超时'); }
spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', localUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
child.on('exit', (code) => { process.exitCode = code ?? 0; });
