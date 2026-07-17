import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

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
});
