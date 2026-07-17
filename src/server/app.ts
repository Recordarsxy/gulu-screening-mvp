import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express from 'express';
import multer from 'multer';
import { approveVersion, createDraft, getCurrentVersion, makeDefaultJobPack, reviseDraft } from './services/job-pack.js';
import { generateHumanGuide, parseSource } from './services/documents.js';
import { ScreeningEngine } from './services/screening.js';
import { demoCompanyRound, demoRoleRound } from './demo/candidates.js';
import { buildCsv, buildWorkbook, deleteJobData } from './services/exports.js';
import { DeepSeekProvider } from './services/deepseek.js';
import { sanitizeTextForCloud } from './services/redaction.js';

type AppDeps = { db: DatabaseSync; dataRoot: string; deepSeek?: DeepSeekProvider };

export function createApp({ db, dataRoot, deepSeek = new DeepSeekProvider() }: AppDeps) {
  const app = express(); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
  const engine = new ScreeningEngine(db, deepSeek);
  app.disable('x-powered-by'); app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, host: '127.0.0.1', mode: 'local-only', version: '1.0.0' }));

  app.get('/api/jobs', (_req, res) => {
    const jobs = db.prepare(`SELECT j.id,j.title,j.current_rule_version,j.created_at,v.status
      FROM jobs j LEFT JOIN job_rule_versions v ON v.job_id=j.id AND v.version=j.current_rule_version ORDER BY j.created_at DESC`).all();
    res.json({ items: jobs });
  });

  app.post('/api/jobs', async (req, res, next) => {
    try {
      const title = String(req.body?.title || '').trim(); const sourceText = String(req.body?.sourceText || '').trim();
      if (!title || !sourceText) return res.status(400).json({ error: 'title_and_source_required' });
      const jobId = randomUUID(); const safeSource=sanitizeTextForCloud(sourceText);const base=makeDefaultJobPack(jobId,title,safeSource);
      const generated=deepSeek.isConfigured()?await deepSeek.generateJobPack(base,safeSource):base;
      const pack = createDraft(db, { jobId, title, sourceText,pack:generated });
      db.prepare('UPDATE jobs SET source_hash=? WHERE id=?').run(createHash('sha256').update(sourceText).digest('hex'), jobId);
      res.status(201).json(pack);
    } catch (error) { next(error); }
  });

  app.post('/api/jobs/import', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file_required' });
      const title = String(req.body.title || req.file.originalname.replace(/\.(docx|pdf|txt)$/i, '')).trim();
      const parsed = await parseSource({ filename: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer });
      const jobId = randomUUID(); const directory = join(dataRoot, 'uploads', jobId); await mkdir(directory, { recursive: true });
      const sourcePath = join(directory, req.file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')); await writeFile(sourcePath, req.file.buffer);
      const safeSource=sanitizeTextForCloud(parsed.text);const base=makeDefaultJobPack(jobId,title,safeSource);
      const generated=deepSeek.isConfigured()?await deepSeek.generateJobPack(base,safeSource):base;
      const pack = createDraft(db, { jobId, title, sourceText: parsed.text,pack:generated });
      db.prepare('UPDATE jobs SET source_hash=?,source_path=? WHERE id=?').run(parsed.sha256, sourcePath, jobId);
      res.status(201).json(pack);
    } catch (error) { next(error); }
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    res.json({ job, pack: getCurrentVersion(db, req.params.jobId) });
  });

  app.put('/api/jobs/:jobId/rules', (req, res, next) => {
    try { res.json(reviseDraft(db, req.params.jobId, req.body)); } catch (error) { next(error); }
  });
  app.post('/api/jobs/:jobId/rules/:version/approve', (req, res, next) => {
    try { res.json(approveVersion(db, req.params.jobId, Number(req.params.version))); } catch (error) { next(error); }
  });

  app.get('/api/jobs/:jobId/job-pack.json', (req, res) => {
    const pack = getCurrentVersion(db, req.params.jobId); if (!pack) return res.status(404).end();
    res.setHeader('content-disposition', 'attachment; filename="job-pack.json"'); res.type('json').send(JSON.stringify(pack, null, 2));
  });
  app.get('/api/jobs/:jobId/guide.docx', async (req, res, next) => {
    try {
      const pack = getCurrentVersion(db, req.params.jobId); if (!pack) return res.status(404).end();
      const file = await generateHumanGuide(pack); res.setHeader('content-disposition', 'attachment; filename="job-guide.docx"');
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(file);
    } catch (error) { next(error); }
  });

  app.post('/api/jobs/:jobId/runs/demo', async (req, res, next) => {
    try {
      res.status(201).json(engine.startRun(req.params.jobId, [demoCompanyRound, demoRoleRound]));
    } catch (error) {
      if (error instanceof Error && error.message === 'rules_not_approved') return res.status(409).json({ error: error.message });
      next(error);
    }
  });
  app.get('/api/runs/:runId', (req, res, next) => { try { res.json(engine.getRun(req.params.runId)); } catch (error) { next(error); } });
  app.post('/api/runs/:runId/process', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(50, Number(req.body?.limit) || 5)); let run = engine.getRun(req.params.runId);
      for (let i=0; i<limit && run.status==='running'; i+=1) run = await engine.processNext(run.id);
      res.json(run);
    } catch (error) { next(error); }
  });
  app.post('/api/runs/:runId/pause', (req, res, next) => { try { res.json(engine.pauseRun(req.params.runId)); } catch (error) { next(error); } });
  app.post('/api/runs/:runId/resume', (req, res, next) => { try { res.json(engine.resumeRun(req.params.runId)); } catch (error) { next(error); } });

  app.get('/api/jobs/:jobId/results', (req, res) => {
    const items = db.prepare(`SELECT c.id candidateId,c.name,c.gulu_id guluId,c.detail_url detailUrl,c.current_company currentCompany,
      c.current_role currentRole,c.source_round sourceRound,a.label,a.reason_code reasonCode,a.evidence_json evidence,
      a.rule_version ruleVersion,a.assessed_at assessedAt,COALESCE(h.status,'未审核') reviewStatus,COALESCE(h.note,'') note
      FROM candidates c JOIN assessments a ON a.candidate_id=c.id
      LEFT JOIN human_reviews h ON h.candidate_id=c.id AND h.rule_version=a.rule_version
      WHERE c.job_id=? ORDER BY CASE a.label WHEN 'recommend' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,c.name`).all(req.params.jobId)
      .map((row: any) => ({ ...row, evidence: JSON.parse(row.evidence) }));
    res.json({ items });
  });

  app.put('/api/jobs/:jobId/reviews/:candidateId', (req, res, next) => {
    try {
      const candidateId = req.params.candidateId; const current = getCurrentVersion(db, req.params.jobId);
      if (!current) return res.status(404).json({ error: 'job_not_found' });
      const ruleVersion = Number(req.body?.ruleVersion || current.rule_version);
      const belongs = db.prepare(`SELECT 1 ok FROM candidates c JOIN assessments a ON a.candidate_id=c.id
        WHERE c.id=? AND c.job_id=? AND a.rule_version=?`).get(candidateId, req.params.jobId, ruleVersion);
      if (!belongs) return res.status(404).json({ error: 'candidate_not_in_job' });
      const status = String(req.body?.status || '未审核').slice(0, 30); const note = String(req.body?.note || '').slice(0, 1000);
      db.prepare(`INSERT INTO human_reviews(candidate_id,rule_version,status,note) VALUES (?,?,?,?)
        ON CONFLICT(candidate_id,rule_version) DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=CURRENT_TIMESTAMP`)
        .run(candidateId,ruleVersion,status,note);
      res.json({ candidateId, ruleVersion, status, note });
    } catch (error) { next(error); }
  });

  app.get('/api/jobs/:jobId/export.csv', async (req, res, next) => {
    try { res.setHeader('content-disposition', 'attachment; filename="screening-results.csv"'); res.type('text/csv').send(await buildCsv(db, req.params.jobId)); } catch (error) { next(error); }
  });
  app.get('/api/jobs/:jobId/export.xlsx', async (req, res, next) => {
    try { res.setHeader('content-disposition', 'attachment; filename="screening-results.xlsx"'); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await buildWorkbook(db, req.params.jobId)); } catch (error) { next(error); }
  });

  app.post('/api/settings/test-deepseek', async (req, res) => {
    const provider = new DeepSeekProvider({ baseUrl: req.body?.baseUrl, model: req.body?.model });
    res.json(await provider.testConnection());
  });

  app.delete('/api/jobs/:jobId', async (req, res, next) => {
    try { res.json(await deleteJobData(db, req.params.jobId, dataRoot)); } catch (error) { next(error); }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const known = ['job_not_found','run_not_found','rule_version_not_found','document_has_no_extractable_text','unsafe_source_path','protected_attribute_rule','confirmation_required','candidate_not_in_job'];
    res.status(known.includes(error.message) ? 400 : 500).json({ error: error.message || 'internal_error' });
  });
  return app;
}
