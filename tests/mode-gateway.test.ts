import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createModeGateway, parseAppMode } from '../src/server/modes.js';

function context(name: 'demo' | 'live') {
  const app = express();
  app.use(express.json());
  app.all('/api/{*path}', (req, res) => res.json({ context: name, path: req.path }));
  return app;
}

describe('application mode gateway', () => {
  it('accepts only explicit demo and live mode headers', () => {
    expect(parseAppMode('demo')).toBe('demo');
    expect(parseAppMode('live')).toBe('live');
    expect(() => parseAppMode(undefined)).toThrow('app_mode_required');
    expect(() => parseAppMode('staging')).toThrow('invalid_app_mode');
  });

  it('routes business APIs to isolated mode contexts', async () => {
    const app = createModeGateway({ demoApp: context('demo'), liveApp: context('live') });

    await request(app).get('/api/jobs').expect(400, { error: 'app_mode_required' });
    await request(app).get('/api/jobs').set('X-App-Mode', 'other').expect(400, { error: 'invalid_app_mode' });
    await request(app).get('/api/jobs').set('X-App-Mode', 'demo').expect(200, { context: 'demo', path: '/api/jobs' });
    await request(app).get('/api/jobs').set('X-App-Mode', 'live').expect(200, { context: 'live', path: '/api/jobs' });
  });

  it('always binds extension APIs to live and rejects a demo context', async () => {
    const app = createModeGateway({ demoApp: context('demo'), liveApp: context('live') });

    await request(app).get('/api/connector/gulu/tasks/next').expect(200, { context: 'live', path: '/api/connector/gulu/tasks/next' });
    await request(app).get('/api/connector/gulu/tasks/next').set('X-App-Mode', 'demo').expect(400, { error: 'demo_connector_forbidden' });
    await request(app).post('/api/connectors/gulu/pairing').set('X-App-Mode', 'demo').expect(403, { error: 'live_feature_unavailable_in_demo' });
  });
});
