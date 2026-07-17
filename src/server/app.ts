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
import { GuluService } from './services/gulu.js';

type AppDeps = { db: DatabaseSync; dataRoot: string; deepSeek?: DeepSeekProvider };

export function createApp({ db, dataRoot, deepSeek = new DeepSeekProvider() }: AppDeps) {
  const app = express(); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
  const engine = new ScreeningEngine(db, deepSeek);
  const gulu = new GuluService(db);
  const taskControllers=new Map<string,AbortController>();
  app.disable('x-powered-by'); app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, host: '127.0.0.1', mode: 'local-only', version: '1.1.0' }));

  app.post('/api/connectors/gulu/pairing', (_req,res,next) => { try { res.status(201).json(gulu.createPairing()); } catch(error){ next(error); } });
  app.get('/api/connectors/gulu/status', (_req,res) => res.json(gulu.getStatus()));
  app.post('/api/connector/gulu/pairing/redeem', (req,res,next) => { try { res.json(gulu.redeemPairing(String(req.body?.code??''),String(req.body?.extensionVersion??''))); } catch(error){ next(error); } });

  const connectorAuth:express.RequestHandler=(req,res,next)=>{
    const token=req.header('authorization')?.replace(/^Bearer\s+/i,'')??'';
    if (!gulu.authenticate(token)) return res.status(401).json({error:'connector_unauthorized'}); next();
  };
  app.post('/api/connector/gulu/heartbeat',connectorAuth,(req,res)=>{gulu.heartbeat(String(req.body?.status??'online'),req.body?.error?String(req.body.error):null);res.json({ok:true});});
  app.get('/api/connector/gulu/tasks/next',connectorAuth,(_req,res)=>{
    const row=db.prepare("SELECT id,job_id FROM gulu_tasks WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1").get() as {id:string;job_id:string}|undefined;
    if (!row) return res.json({task:null}); const task=gulu.getTask(row.id); const plan=gulu.getPlan(row.job_id); res.json({task,plan,pacingMs:{min:800,max:1500}});
  });
  app.post('/api/connector/gulu/tasks/:taskId/events',connectorAuth,async(req,res,next)=>{try{
    const type=String(req.body?.type??''); const eventId=String(req.body?.eventId??''); if(!eventId) return res.status(400).json({error:'event_id_required'});
    const taskId=String(req.params.taskId);
    const taskState=gulu.getTask(taskId);if(!['queued','running'].includes(taskState.status))return res.status(409).json({error:'task_not_running'});
    if(type==='candidate') {
      const recorded=gulu.recordCandidate(taskId,eventId,req.body.snapshot);
      const task=gulu.getTask(taskId);const snapshot=req.body.snapshot;
      const candidate={id:`${task.jobId}:gulu:${snapshot.guluId}`,jobId:task.jobId,dedupeKey:String(snapshot.guluId||snapshot.detailUrl),name:String(snapshot.name),guluId:String(snapshot.guluId),detailUrl:String(snapshot.detailUrl),currentCompany:String(snapshot.company??''),currentRole:String(snapshot.role??''),experiences:(snapshot.experiences??[]).map((item:Record<string,unknown>)=>({company:String(item.company??''),role:String(item.role??''),period:String(item.period??''),summary:String(item.summary??'')})),sourceRound:snapshot.sourceRound};
      const controller=new AbortController();taskControllers.set(taskId,controller);
      try{const assessed=await engine.assessCandidate(task.jobId,task.ruleVersion,candidate,controller.signal);const latest=gulu.getTask(taskId);if(!['queued','running'].includes(latest.status))return res.status(409).json({error:'task_not_running'});return res.json(assessed.created?gulu.recordAnalysis(taskId,assessed.decision.inputTokens,assessed.decision.outputTokens):recorded);}finally{if(taskControllers.get(taskId)===controller)taskControllers.delete(taskId);}
    }
    if(type==='failure') return res.json(gulu.recordFailure(taskId,String(req.body?.error??'connector_failure')));
    if(type==='checkpoint') return res.json(gulu.updateCheckpoint(taskId,req.body.checkpoint??{}));
    if(type==='completed') return res.json(gulu.setStatus(taskId,'completed'));
    if(type==='needs_attention') return res.json(gulu.pauseForReason(taskId,String(req.body?.error??'需要人工处理')));
    return res.status(400).json({error:'unsupported_connector_event'});
  }catch(error){next(error)}});

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

  app.post('/api/jobs/:jobId/gulu-plan/generate',async(req,res,next)=>{try{
    const pack=getCurrentVersion(db,req.params.jobId);if(!pack)return res.status(404).json({error:'job_not_found'});if(pack.approval.status!=='approved')return res.status(409).json({error:'rules_not_approved'});
    const generated=await deepSeek.generateGuluSearchPlan(pack);res.json(gulu.saveDraft(generated.data));
  }catch(error){next(error)}});
  app.put('/api/jobs/:jobId/gulu-plan/confirm',(req,res,next)=>{try{res.json(gulu.confirmPlan(req.params.jobId,req.body))}catch(error){next(error)}});
  app.get('/api/jobs/:jobId/gulu-plan',(req,res)=>{const plan=gulu.getPlan(req.params.jobId);if(!plan)return res.status(404).json({error:'gulu_plan_not_found'});res.json(plan)});
  app.post('/api/jobs/:jobId/runs/gulu',(req,res,next)=>{try{const requested=String(req.body?.mode??'dry-run');const mode=requested==='pilot'||requested==='formal'?requested:'dry-run';res.status(201).json(gulu.startTask(String(req.params.jobId),mode))}catch(error){if(error instanceof Error&&['gulu_plan_not_confirmed','gulu_dry_run_required','gulu_pilot_required','gulu_task_already_active'].includes(error.message))return res.status(409).json({error:error.message});next(error)}});

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
  app.get('/api/runs/:runId', (req, res, next) => { try { const task=db.prepare('SELECT 1 FROM gulu_tasks WHERE id=?').get(req.params.runId);res.json(task?gulu.getTask(String(req.params.runId)):engine.getRun(String(req.params.runId))); } catch (error) { next(error); } });
  app.post('/api/runs/:runId/process', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(50, Number(req.body?.limit) || 5)); let run = engine.getRun(req.params.runId);
      for (let i=0; i<limit && run.status==='running'; i+=1) run = await engine.processNext(run.id);
      res.json(run);
    } catch (error) { next(error); }
  });
  app.post('/api/runs/:runId/pause', (req, res, next) => { try { const task=db.prepare('SELECT 1 FROM gulu_tasks WHERE id=?').get(req.params.runId);if(task)taskControllers.get(String(req.params.runId))?.abort();res.json(task?gulu.setStatus(req.params.runId,'paused'):engine.pauseRun(req.params.runId)); } catch (error) { next(error); } });
  app.post('/api/runs/:runId/resume', (req, res, next) => { try { const task=db.prepare('SELECT 1 FROM gulu_tasks WHERE id=?').get(req.params.runId);res.json(task?gulu.setStatus(req.params.runId,'running'):engine.resumeRun(req.params.runId)); } catch (error) { next(error); } });
  app.post('/api/runs/:runId/stop', (req, res, next) => { try { taskControllers.get(String(req.params.runId))?.abort();res.json(gulu.setStatus(String(req.params.runId),'stopped')); } catch (error) { next(error); } });

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
    const known = ['job_not_found','run_not_found','rule_version_not_found','document_has_no_extractable_text','unsafe_source_path','protected_attribute_rule','confirmation_required','candidate_not_in_job','pairing_code_invalid','gulu_plan_not_confirmed','task_aborted'];
    res.status(known.includes(error.message) ? 400 : 500).json({ error: error.message || 'internal_error' });
  });
  return app;
}
