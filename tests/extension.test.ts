import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Chrome extension safety boundary', () => {
  it('uses stable event IDs and reconstructs list state after restart', async () => {
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain('candidate:${task.id}:${task.currentRound}:${seed.guluId}');
    expect(source).toContain('async function restoreList');
    expect(source).toContain('async function waitListSettled');
    expect(source).toContain('for (let current = 1; current < page; current += 1)');
    expect(source).toContain("task.mode === 'pilot' && totalRead >= 5");
  });

  it('uses Manifest V3 with no sensitive browser permissions', async () => {
    const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    for (const permission of ['cookies','downloads','history','webRequest','scripting']) expect(manifest.permissions || []).not.toContain(permission);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs','storage','alarms']));
    expect(manifest.host_permissions).toEqual(['http://121.43.105.7/*','http://127.0.0.1/*']);
    expect(manifest.content_scripts[0].matches).toEqual(['http://121.43.105.7/crm*']);
  });

  it('exposes only semantic read operations and strips forbidden fields', async () => {
    const adapter = await import('../extension/gulu-adapter.js');
    expect(adapter.SEMANTIC_OPERATIONS).toEqual(['inspectState','inspectListState','applyFilters','readList','openDetail','readDetail','nextPage']);
    const safe=adapter.sanitizeSnapshot({guluId:'1',name:'甲',detailUrl:'http://121.43.105.7/crm#candidate/detail?id=1',company:'示例',role:'经理',phone:'13800000000',email:'a@b.com',notes:'秘密',sourceRound:'role',page:1,capturedAt:new Date().toISOString()});
    expect(safe).not.toHaveProperty('phone');expect(safe).not.toHaveProperty('email');expect(safe).not.toHaveProperty('notes');
    expect(Object.keys(safe).sort()).toEqual(expect.arrayContaining(['guluId','name','detailUrl','company','role']));
  });

  it('contains no write-side Gulu actions or sensitive browser access', async()=>{
    const all=(await Promise.all(['background.js','content.js','gulu-adapter.js'].map((name)=>readFile(new URL(`../extension/${name}`,import.meta.url),'utf8')))).join('\n');
    expect(all).not.toMatch(/chrome\.(cookies|downloads|history)|document\.cookie/i);
    expect(all).not.toMatch(/加入项目|推荐客户|发送邮件|发送消息|删除人才|下载简历/);
    expect(all).not.toMatch(/eval\s*\(|new Function/);
  });
});
