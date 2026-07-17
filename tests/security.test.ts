import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('Windows delivery', () => {
  it('starts through npm.cmd and opens only localhost', async () => {
    const launcher = await readFile(new URL('../启动谷露筛选MVP.cmd', import.meta.url), 'utf8');
    expect(launcher).toContain('npm.cmd');
    expect(launcher).toContain('set PORT=4318');
    expect(launcher).toContain('127.0.0.1:%PORT%');
    expect(launcher).toContain('NODE_MAJOR');
    expect(launcher).not.toContain('0.0.0.0');
    const start = await readFile(new URL('../scripts/start.mjs', import.meta.url), 'utf8');
    expect(start).toContain('--env-file-if-exists=.env');
  });

  it('is parsed by Windows cmd without truncating commands', async () => {
    const launcherUrl=new URL('../启动谷露筛选MVP.cmd',import.meta.url);const bytes=await readFile(launcherUrl);
    expect(bytes.every((byte)=>byte<128)).toBe(true);
    expect(bytes.toString('ascii').replace(/\r\n/g,'')).not.toContain('\n');
    const result=spawnSync('cmd.exe',['/d','/c',fileURLToPath(launcherUrl),'--check'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:15000,input:'\n'});
    expect(result.status,`${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/not recognized|版本过低/i);
  });
});
