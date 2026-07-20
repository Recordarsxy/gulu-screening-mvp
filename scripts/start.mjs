import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = process.env.PORT || '4318';
const localUrl = `http://127.0.0.1:${port}`;

async function isHealthy() {
  try {
    const response = await fetch(`${localUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function openLocalUrl() {
  const opener = spawn('explorer.exe', [localUrl], { detached: true, stdio: 'ignore', windowsHide: true });
  opener.once('error', () => {
    spawn('cmd.exe', ['/d', '/c', `start "" "${localUrl}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  });
  opener.unref();
}

if (await isHealthy()) {
  openLocalUrl();
  await delay(250);
  process.exit(0);
}

const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist-server/server/index.js'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, PORT: port } });
let ready = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await isHealthy()) { ready = true; break; }
  await delay(250);
}
if (!ready) { child.kill(); throw new Error('本机服务启动超时'); }
openLocalUrl();
child.on('exit', (code) => { process.exitCode = code ?? 0; });
