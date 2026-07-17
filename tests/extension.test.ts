import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Chrome extension safety skeleton', () => {
  it('uses Manifest V3 with no sensitive browser permissions', async () => {
    const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    for (const permission of ['cookies','downloads','history','webRequest','storage']) expect(manifest.permissions || []).not.toContain(permission);
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('keeps the unconfigured Gulu adapter disabled', async () => {
    const source = await readFile(new URL('../extension/gulu-adapter.js', import.meta.url), 'utf8');
    expect(source).toContain('enabled: false');
    expect(source).toContain('adapter_not_configured');
    expect(source).not.toMatch(/cookie|localStorage|sessionStorage/i);
  });
});
