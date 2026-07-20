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
    expect(start).toContain("spawn('explorer.exe', [localUrl]");
    expect(start).toContain('if (await isHealthy())');
    expect(start).toContain("const expectedVersion = '1.2.0'");
    expect(start).toContain('payload.version === expectedVersion');
    expect(start).toContain('请先关闭旧版本服务窗口');
    expect(start).toContain('openLocalUrl();');
  });

  it('is parsed by Windows cmd without truncating commands', async () => {
    const launcherUrl=new URL('../启动谷露筛选MVP.cmd',import.meta.url);const bytes=await readFile(launcherUrl);
    expect(bytes.every((byte)=>byte<128)).toBe(true);
    expect(bytes.toString('ascii').replace(/\r\n/g,'')).not.toContain('\n');
    const result=spawnSync('cmd.exe',['/d','/c',fileURLToPath(launcherUrl),'--check'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:15000,input:'\n'});
    expect(result.status,`${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/not recognized|版本过低/i);
  });

  it('uses v1.2.0 consistently across the product and extension',async()=>{
    expect(JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version).toBe('1.2.0');
    expect(JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8')).version).toBe('1.2.0');
    expect(await readFile(new URL('../src/server/app.ts',import.meta.url),'utf8')).toContain("version: '1.2.0'");
    expect(await readFile(new URL('../src/client/App.tsx',import.meta.url),'utf8')).toContain('GULU SCREENING v1.2.0');
  });
});
