import type { Express } from 'express';
import express from 'express';

export type AppMode = 'demo' | 'live';

export function parseAppMode(value: string | undefined): AppMode {
  if (value === undefined || value.trim() === '') throw new Error('app_mode_required');
  if (value !== 'demo' && value !== 'live') throw new Error('invalid_app_mode');
  return value;
}

type ModeGatewayDeps = {
  demoApp: Express;
  liveApp: Express;
};

export function createModeGateway({ demoApp, liveApp }: ModeGatewayDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/connector/gulu/')) {
      if (req.header('x-app-mode') === 'demo') return res.status(400).json({ error: 'demo_connector_forbidden' });
      return liveApp(req, res, next);
    }
    let mode: AppMode;
    try {
      mode = parseAppMode(req.header('x-app-mode'));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'invalid_app_mode' });
    }
    if (mode === 'demo' && (req.path.startsWith('/api/connectors/gulu') || req.path.startsWith('/api/integrations/liepin'))) {
      return res.status(403).json({ error: 'live_feature_unavailable_in_demo' });
    }
    return (mode === 'demo' ? demoApp : liveApp)(req, res, next);
  });

  return app;
}
