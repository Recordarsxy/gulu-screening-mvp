import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { DemoAIProvider } from '../src/server/demo/ai.js';
import { DEMO_JOB_ID, ensureDemoData, resetDemoData } from '../src/server/demo/bootstrap.js';
import { createModeGateway } from '../src/server/modes.js';
import { DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('portable offline demo API', () => {
  const closers: Array<() => void> = [];
  afterEach(() => closers.splice(0).forEach((close) => close()));

  async function setup(dynamicDeepSeek?: DeepSeekProvider) {
    const live = openDatabase(':memory:'); const demo = openDatabase(':memory:');
    migrate(live); migrate(demo); ensureDemoData(demo);
    live.prepare("INSERT INTO jobs(id,title,source_text,current_rule_version) VALUES ('live-safe','真实数据库哨兵','JD',0)").run();
    const app = createModeGateway({
      liveApp: createApp({ db: live, dataRoot: process.cwd(), mode: 'live' }),
      demoApp: createApp({ db: demo, dataRoot: process.cwd(), mode: 'demo', deepSeek: new DemoAIProvider(), dynamicDeepSeek, resetDemo: () => resetDemoData(demo) }),
    });
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
    closers.push(() => { server.close(); live.close(); demo.close(); });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (path: string, mode: 'demo' | 'live', init: RequestInit = {}) => fetch(`${origin}${path}`, { ...init, headers: { 'content-type': 'application/json', 'X-App-Mode': mode, ...init.headers } });
    return { live, demo, request };
  }

  it('runs, deduplicates, reviews, exports and resets without touching live data', async () => {
    const { live, request } = await setup();
    const jobs = await (await request('/api/jobs', 'demo')).json() as any;
    expect(jobs.items).toHaveLength(1);
    expect(jobs.items[0].id).toBe(DEMO_JOB_ID);
    expect((await request('/api/jobs', 'demo', { method: 'POST', body: '{}' })).status).toBe(403);

    const started = await (await request(`/api/jobs/${DEMO_JOB_ID}/runs/demo`, 'demo', { method: 'POST' })).json() as any;
    expect(started.total).toBe(10);
    expect((await (await request(`/api/runs/${started.id}/pause`, 'demo', { method: 'POST' })).json() as any).status).toBe('paused');
    expect((await (await request(`/api/runs/${started.id}/resume`, 'demo', { method: 'POST' })).json() as any).status).toBe('running');
    let run = started;
    while (run.status === 'running') run = await (await request(`/api/runs/${started.id}/process`, 'demo', { method: 'POST', body: JSON.stringify({ limit: 3 }) })).json();
    const results = await (await request(`/api/jobs/${DEMO_JOB_ID}/results`, 'demo')).json() as any;
    expect(results.items).toHaveLength(10);
    expect(new Set(results.items.map((item: any) => item.label))).toEqual(new Set(['recommend', 'review', 'exclude']));
    const candidate = results.items.find((item: any) => item.label === 'review');
    await request(`/api/jobs/${DEMO_JOB_ID}/reviews/${encodeURIComponent(candidate.candidateId)}`, 'demo', { method: 'PUT', body: JSON.stringify({ ruleVersion: 1, status: '已复核', note: '虚构演示人工备注' }) });
    const csv = await request(`/api/jobs/${DEMO_JOB_ID}/export.csv`, 'demo');
    expect(csv.headers.get('content-disposition')).toContain('fictional-demo');
    expect(await csv.text()).toContain('虚构演示数据');

    await request('/api/demo/reset', 'demo', { method: 'POST', body: JSON.stringify({ confirmation: 'RESET_DEMO' }) });
    expect(live.prepare("SELECT title FROM jobs WHERE id='live-safe'").get()).toEqual({ title: '真实数据库哨兵' });
    expect((await (await request('/api/jobs', 'demo')).json() as any).items).toHaveLength(1);
  });

  it('does not expose live connector features to demo mode', async () => {
    const { request } = await setup();
    expect((await request('/api/connectors/gulu/pairing', 'demo', { method: 'POST' })).status).toBe(403);
    const preflight = await request('/api/live/preflight', 'live');
    expect(JSON.stringify(await preflight.json())).not.toMatch(/token|apiKey|secret/i);
  });

  it('falls back to a pre-generated campaign when dynamic AI fails', async () => {
    const failing = new DeepSeekProvider({ apiKey: 'personal-test-key', fetcher: async () => { throw new TypeError('network failed'); } });
    const { request } = await setup(failing);
    const response = await request('/api/demo/dynamic/campaign', 'demo', { method: 'POST', body: JSON.stringify({ jobId: DEMO_JOB_ID, confirmation: 'DYNAMIC_GENERATE' }) });
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.fallback).toBe(true);
    expect(result.campaign.summary).toContain('虚构演示数据');
  });
});
