import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Chrome extension safety boundary', () => {
  it('uses the Chrome main world only as a hierarchical-filter fallback',async()=>{const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');expect(manifest.permissions).toContain('scripting');expect(source).toContain("world: 'MAIN'");expect(source).toContain('commitComtreeValueInMainWorld');});
  it('uses stable event IDs and reconstructs list state after restart', async () => {
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain('candidate:${task.id}:${task.currentRound}:${seed.guluId}');
    expect(source).toContain('async function restoreList');
    expect(source).toContain('async function waitListSettled');
    expect(source).toContain("state.state === 'loading'");
    expect(source).toContain('for (let current = 1; current < page; current += 1)');
    expect(source).toContain("task.mode === 'pilot' && totalRead >= 5");
    expect(source).toContain("tab?.url?.startsWith('http://121.43.105.7/')");
  });

  it('loads the page adapter synchronously before the diagnostic listener', async()=>{
    const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
    expect(source).toContain('globalThis.__GULU_ADAPTER__');
    expect(source).toContain('adapter_unavailable');
    expect(source).not.toContain('import(');
  });

  it('times out content-script messages instead of hanging forever',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain('throw new Error(`adapter_timeout:${operation}`)');
    expect(source).toContain('timeoutMs = 5000');
    expect(source).toContain('delay(timeoutMs)');
    expect(source).toContain('Promise.race');
    expect(source).toContain('gulu_tab_unavailable:${context}:');
  });

  it('keeps heartbeats alive while a long connector operation is active',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain("if (active) {");
    expect(source).toContain("status: 'online', busy: true");
    expect(source).toContain('extensionVersion: chrome.runtime.getManifest().version');
  });

  it('reloads an unpacked extension automatically after its revision changes',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    const revision=(await readFile(new URL('../extension/revision.txt',import.meta.url),'utf8')).trim();
    expect(revision).toMatch(/^v1\.3\.0-/);
    expect(source).toContain("chrome.runtime.getURL('revision.txt')");
    expect(source).toContain("cache: 'no-store'");
    expect(source).toContain('chrome.runtime.reload()');
    expect(source.indexOf('if (active) {')).toBeLessThan(source.indexOf('await reloadIfUpdated()'));
  });

  it('records round completion and resumes the role round immediately',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain("'round_started'");
    expect(source).toContain("'round_completed'");
    expect(source).toContain("chrome.alarms.create('gulu-resume'");
    expect(source).toContain('when: Date.now() + 1000');
    expect(source).toContain('resumeSoon();');
  });

  it('waits for a committed query and three stable observations',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain('state.queryReady');
    expect(source).toContain('stableCount >= 3');
    expect(source).toContain('minimumDelay: 2500');
    expect(source).toContain("const beforeQuery = await send(tabId, 'inspectListState');");
    expect(source).toContain('previousSignature: beforeQuery.signature');
    expect(source).not.toContain('|| expectedPage === 1');
  });

  it('waits up to sixty seconds for candidates or a verified zero total',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    expect(source).toContain('attempt < 150');
    expect(source).toContain('state.resultReady');
    expect(source).not.toContain('zeroCount >= 10');
    expect(source).not.toContain('inferredEmpty: true');
    expect(source).toContain('list_not_settled:page=');
    expect(source).toContain('queryReady=${Boolean(lastState?.queryReady)}');
  });

  it('reloads the neutral candidate list before applying each search plan',async()=>{
    const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    const restore=source.slice(source.indexOf('async function restoreList'),source.indexOf('async function runCampaignTask'));
    expect(restore).toContain("let state = await waitReady(tabId, 'restore');");
    expect(source).toContain("chrome.tabs.update(tabId, { url: GULU }).catch(() => {});");
    expect(source).not.toContain("await chrome.tabs.update(tabId, { url: GULU });");
    expect(source).toContain('chrome.tabs.reload(tabId).catch(() => {});');
    expect(source).not.toContain('await chrome.tabs.reload(tabId);');
    expect(restore.indexOf('chrome.tabs.reload(tabId)')).toBeLessThan(restore.indexOf("await waitReady(tabId, 'restore')"));
    expect(source.indexOf('chrome.tabs.reload(tabId).catch(() => {});')).toBeLessThan(source.indexOf("await send(tabId, 'applyFilters'"));
  });

  it('recognizes a new task id and resets semantic filters before applying it',async()=>{
    const background=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
    const content=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
    expect(background).toContain("'lastTaskId'");
    expect(background).toContain('saved.lastTaskId !== task.id');
    expect(background).toContain("chrome.storage.local.set({ lastTaskId: task.id })");
    expect(background).toContain("savedSearchId=94096");
    expect(background).not.toContain("savedSearchId=94094");
    expect(background.indexOf("await send(tabId, 'inspectForbiddenFilters')")).toBeLessThan(background.indexOf("await send(tabId, 'resetFilters')"));
    expect(background.indexOf("await send(tabId, 'inspectCandidateScope')")).toBeLessThan(background.indexOf("await send(tabId, 'resetFilters')"));
    expect(background).toContain("scopeChange.changed ? { scope: 'all_talent' }");
    expect(background).toContain("scope.scope !== 'all_talent'");
    expect(background.indexOf("await send(tabId, 'resetFilters')")).toBeLessThan(background.indexOf("await send(tabId, 'applyFilters'"));
    expect(content).toContain("message.operation === 'resetFilters'");
    const adapter=await readFile(new URL('../extension/gulu-adapter.js',import.meta.url),'utf8');
    const reset=adapter.slice(adapter.indexOf('async function resetFilters'),adapter.indexOf('async function applyFilters'));
    expect(reset).not.toContain('label?.click()');
    const apply=adapter.slice(adapter.indexOf('async function applyFilters'),adapter.indexOf('async function applyFilterValue'));
    expect(apply).not.toContain("new KeyboardEvent('keydown'");
  });

  it('uses Manifest V3 with no sensitive browser permissions', async () => {
    const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    for (const permission of ['cookies','downloads','history','webRequest']) expect(manifest.permissions || []).not.toContain(permission);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs','storage','alarms','scripting']));
    expect(manifest.host_permissions).toEqual(['http://121.43.105.7/*','http://127.0.0.1/*']);
    expect(manifest.content_scripts[0].matches).toEqual(['http://121.43.105.7/*']);
    expect(manifest.content_scripts[0].js).toEqual(['gulu-adapter.js','content.js']);
    expect(manifest.web_accessible_resources).toBeUndefined();
  });

  it('exposes only semantic read operations and strips forbidden fields', async () => {
    const adapter = await import('../extension/gulu-adapter-module.js');
    expect(adapter.SEMANTIC_OPERATIONS).toEqual(['inspectState','inspectCandidateScope','ensureAllTalentScope','inspectForbiddenFilters','inspectAppliedFilters','inspectListState','resetFilters','applyFilters','applyFilterValue','scanTaxonomyField','submitSearch','readList','openDetail','readDetail','nextPage']);
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
