import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express from 'express';
import multer from 'multer';
import { approveVersion, createDraft, getCurrentVersion, makeDefaultJobPack, restoreDraft, reviseDraft } from './services/job-pack.js';
import { generateHumanGuide, parseSource } from './services/documents.js';
import { ScreeningEngine } from './services/screening.js';
import { demoCompanyRound, demoRoleRound } from './demo/candidates.js';
import { buildCsv, buildWorkbook, deleteJobData } from './services/exports.js';
import { DeepSeekProvider } from './services/deepseek.js';
import { sanitizeCandidate, sanitizeTextForCloud } from './services/redaction.js';
import { GuluService } from './services/gulu.js';
import { JobChangeService } from './services/job-changes.js';
import { archiveJob, restoreJob } from './services/job-archive.js';
import { resetJobSection, type JobResetSection } from './services/job-reset.js';
import { safeGuluCandidateUrl } from '../shared/gulu-link.js';

type AppDeps = { db: DatabaseSync; dataRoot: string; deepSeek?: DeepSeekProvider; jobPackTimeoutMs?:number };

export function createApp({ db, dataRoot, deepSeek = new DeepSeekProvider(),jobPackTimeoutMs=Number(process.env.JOB_PACK_TIMEOUT_MS||60_000) }: AppDeps) {
  const app = express(); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
  const engine = new ScreeningEngine(db, deepSeek);
  const gulu = new GuluService(db);
  const jobChanges = new JobChangeService(db);
  const taskControllers=new Map<string,AbortController>();
  const candidateRequests=new Map<string,Promise<unknown>>();
  const generateInitialPack=async(base:ReturnType<typeof makeDefaultJobPack>,safeSource:string)=>{
    if(!deepSeek.isConfigured())throw new Error('job_pack_generation_failed');
    const controller=new AbortController();
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('job_pack_generation_timeout'))},Math.max(1,jobPackTimeoutMs));});
    try{
      return await Promise.race([deepSeek.generateJobPack(base,safeSource,controller.signal),deadline]);
    }catch(error){
      if(controller.signal.aborted||(error instanceof Error&&error.message==='job_pack_generation_timeout'))throw new Error('job_pack_generation_timeout');
      throw new Error('job_pack_generation_failed');
    }finally{if(timeout)clearTimeout(timeout);}
  };
  app.disable('x-powered-by'); app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, host: '127.0.0.1', mode: 'local-only', version: '1.3.0' }));

  app.post('/api/connectors/gulu/pairing', (_req,res,next) => { try { res.status(201).json(gulu.createPairing()); } catch(error){ next(error); } });
  app.get('/api/connectors/gulu/status', (_req,res) => res.json(gulu.getStatus()));
  app.post('/api/connector/gulu/pairing/redeem', (req,res,next) => { try { res.json(gulu.redeemPairing(String(req.body?.code??''),String(req.body?.extensionVersion??''))); } catch(error){ next(error); } });

  const connectorAuth:express.RequestHandler=(req,res,next)=>{
    const token=req.header('authorization')?.replace(/^Bearer\s+/i,'')??'';
    if (!gulu.authenticate(token)) return res.status(401).json({error:'connector_unauthorized'}); next();
  };
  app.post('/api/connector/gulu/heartbeat',connectorAuth,(req,res)=>{gulu.heartbeat(String(req.body?.status??'online'),req.body?.error?String(req.body.error):null,String(req.body?.extensionVersion??''));res.json({ok:true});});
  app.get('/api/connector/gulu/tasks/next',connectorAuth,(_req,res)=>{
    const row=db.prepare("SELECT id,job_id FROM gulu_tasks WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1").get() as {id:string;job_id:string}|undefined;
    if (!row) return res.json({task:null}); const task=gulu.getTask(row.id);if(task.campaignId){const strategy=gulu.getTaskStrategy(row.id);return res.json({...strategy,step:gulu.getCurrentCampaignStep(row.id),pacingMs:{min:800,max:1500}})}const plan=gulu.getTaskPlan(row.id); res.json({task,plan,pacingMs:{min:800,max:1500}});
  });
  app.post('/api/connector/gulu/tasks/:taskId/candidates/check',connectorAuth,(req,res,next)=>{try{const ids=Array.isArray(req.body?.guluIds)?req.body.guluIds.map(String):[];res.json({unseen:gulu.filterUnseen(String(req.params.taskId),ids)})}catch(error){next(error)}});
  app.post('/api/connector/gulu/tasks/:taskId/events',connectorAuth,async(req,res,next)=>{try{
    const type=String(req.body?.type??''); const eventId=String(req.body?.eventId??''); if(!eventId) return res.status(400).json({error:'event_id_required'});
    const taskId=String(req.params.taskId);
    const taskState=gulu.getTask(taskId);if(!['queued','running'].includes(taskState.status))return res.status(409).json({error:'task_not_running'});
    if(type==='candidate') {
      const requestKey=`${taskId}:${eventId}`;const existing=candidateRequests.get(requestKey);if(existing)return res.json(await existing);
      const processing=(async()=>{const recorded=gulu.recordCandidate(taskId,eventId,req.body.snapshot);
        const task=gulu.getTask(taskId);const snapshot=req.body.snapshot;
        const candidate={id:`${task.jobId}:gulu:${snapshot.guluId}`,jobId:task.jobId,dedupeKey:String(snapshot.guluId||snapshot.detailUrl),name:String(snapshot.name),guluId:String(snapshot.guluId),detailUrl:String(snapshot.detailUrl),currentCompany:String(snapshot.company??''),currentRole:String(snapshot.role??''),experiences:(snapshot.experiences??[]).map((item:Record<string,unknown>)=>({company:String(item.company??''),role:String(item.role??''),period:String(item.period??''),summary:String(item.summary??'')})),sourceRound:snapshot.sourceRound??'campaign'};
        const controller=new AbortController();taskControllers.set(taskId,controller);
        try{const assessed=await engine.assessCandidate(task.jobId,task.ruleVersion,candidate,controller.signal);const latest=gulu.getTask(taskId);if(!['queued','running'].includes(latest.status))throw new Error('task_not_running');gulu.linkCandidate(taskId,assessed.candidateId);if(latest.campaignId){const fit=await deepSeek.scoreSearchFit(getCurrentVersion(db,task.jobId)!,sanitizeCandidate(candidate),controller.signal);gulu.recordSearchFit(taskId,assessed.candidateId,String(snapshot.sourceStepId??latest.currentStepId),fit)}return assessed.created?gulu.recordAnalysis(taskId,assessed.decision.inputTokens,assessed.decision.outputTokens):recorded;}finally{if(taskControllers.get(taskId)===controller)taskControllers.delete(taskId);}
      })();candidateRequests.set(requestKey,processing);
      try{return res.json(await processing);}finally{if(candidateRequests.get(requestKey)===processing)candidateRequests.delete(requestKey);}
    }
    if(type==='failure') return res.json(gulu.recordFailure(taskId,String(req.body?.error??'connector_failure')));
    if(type==='preflight_completed')return res.json(gulu.completePreflight(taskId));
    if(type==='step_probed'){const stepId=String(req.body?.stepId??'');const resultCount=Number(req.body?.resultCount);if(!stepId||stepId!==gulu.getTask(taskId).currentStepId||!Number.isInteger(resultCount)||resultCount<0)return res.status(400).json({error:'invalid_probe'});return res.json(gulu.recordStepProbe(taskId,stepId,resultCount));}
    if(type==='filter_unavailable'){const stepId=String(req.body?.stepId??''),field=String(req.body?.field??''),value=String(req.body?.value??'');if(!stepId||stepId!==gulu.getTask(taskId).currentStepId||!['cities','industries','functions'].includes(field)||!value.trim())return res.status(400).json({error:'invalid_filter_unavailable'});return res.json(gulu.recordFilterUnavailable(taskId,stepId,field,value));}
    if(type==='step_started'){const stepId=String(req.body?.stepId??'');if(!stepId||stepId!==gulu.getTask(taskId).currentStepId)return res.status(400).json({error:'invalid_step'});return res.json(gulu.startStep(taskId,stepId));}
    if(type==='step_calibrated'){
      const stepId=String(req.body?.stepId??'');const task=gulu.getTask(taskId);const progress=task.stepProgress.find(item=>item.stepId===stepId);if(!progress)return res.status(400).json({error:'invalid_step'});
      const metrics={read:progress.readCount,unique:progress.uniqueCount,highFit:progress.highFitCount,duplicateRate:progress.duplicateRate};
      const action=req.body?.exhausted?'next_step':'continue';const rationale=action==='next_step'?'当前结果已遍历完，切换搜索方向':'已有候选，继续遍历当前搜索结果';gulu.recordStrategyDecision(taskId,stepId,action,metrics,rationale);return res.json(action==='next_step'?gulu.completeStep(taskId,stepId,false):gulu.finishCalibration(taskId,stepId));
    }
    if(type==='step_completed'){const stepId=String(req.body?.stepId??'');if(!stepId)return res.status(400).json({error:'invalid_step'});return res.json(gulu.completeStep(taskId,stepId,Boolean(req.body?.empty)))}
    if(type==='round_started'||type==='round_completed'){
      const round=String(req.body?.round??'');if(round!=='company'&&round!=='role')return res.status(400).json({error:'invalid_round'});
      return res.json(type==='round_started'?gulu.startRound(taskId,round):gulu.completeRound(taskId,round,Boolean(req.body?.empty)));
    }
    if(type==='checkpoint') return res.json(gulu.updateCheckpoint(taskId,req.body.checkpoint??{}));
    if(type==='completed') return res.json(gulu.setStatus(taskId,'completed'));
    if(type==='needs_attention') return res.json(gulu.pauseForReason(taskId,String(req.body?.error??'需要人工处理')));
    return res.status(400).json({error:'unsupported_connector_event'});
  }catch(error){next(error)}});

  app.get('/api/jobs', (req, res) => {
    const archiveFilter=req.query.archived==='true'?'IS NOT NULL':'IS NULL';
    const jobs = db.prepare(`SELECT j.id,j.title,j.current_rule_version,j.created_at,j.archived_at,v.status
      FROM jobs j LEFT JOIN job_rule_versions v ON v.job_id=j.id AND v.version=j.current_rule_version
      WHERE j.archived_at ${archiveFilter} ORDER BY j.created_at DESC`).all();
    res.json({ items: jobs });
  });

  const archiveError=(error:unknown,res:express.Response,next:express.NextFunction)=>{
    if(error instanceof Error&&error.message==='job_not_found')return res.status(404).json({error:error.message});
    if(error instanceof Error&&error.message==='job_has_active_task')return res.status(409).json({error:error.message});
    next(error);
  };
  app.post('/api/jobs/:jobId/archive',(req,res,next)=>{try{res.json(archiveJob(db,req.params.jobId));}catch(error){archiveError(error,res,next);}});
  app.post('/api/jobs/:jobId/restore',(req,res,next)=>{try{res.json(restoreJob(db,req.params.jobId));}catch(error){archiveError(error,res,next);}});
  app.post('/api/jobs/:jobId/reset/:section',(req,res,next)=>{try{
    const section=String(req.params.section) as JobResetSection;
    if(!['rules','runs','results'].includes(section))return res.status(404).json({error:'reset_section_not_found'});
    const active=db.prepare("SELECT id FROM gulu_tasks WHERE job_id=? AND status IN ('queued','running','paused','needs_attention')").all(req.params.jobId) as Array<{id:string}>;
    active.forEach(({id})=>taskControllers.get(id)?.abort());
    const result=resetJobSection(db,req.params.jobId,section);
    if(!result)return res.status(404).json({error:'job_not_found'});
    res.json(result);
  }catch(error){next(error)}});

  app.post('/api/jobs', async (req, res, next) => {
    try {
      const title = String(req.body?.title || '').trim(); const sourceText = String(req.body?.sourceText || '').trim();
      if (!title || !sourceText) return res.status(400).json({ error: 'title_and_source_required' });
      const jobId = randomUUID(); const safeSource=sanitizeTextForCloud(sourceText);const base=makeDefaultJobPack(jobId,title,safeSource);
      const generated=await generateInitialPack(base,safeSource);
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
      const generated=await generateInitialPack(base,safeSource);
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
  app.post('/api/jobs/:jobId/rules/regenerate',async(req,res,next)=>{try{
    const job=db.prepare('SELECT title,source_text,current_rule_version FROM jobs WHERE id=?').get(req.params.jobId) as {title:string;source_text:string;current_rule_version:number}|undefined;
    if(!job)return res.status(404).json({error:'job_not_found'});
    if(job.current_rule_version!==0)return res.status(409).json({error:'rules_already_exist'});
    const safeSource=sanitizeTextForCloud(job.source_text);const base=makeDefaultJobPack(req.params.jobId,job.title,safeSource);
    const generated=await generateInitialPack(base,safeSource);res.status(201).json(restoreDraft(db,req.params.jobId,generated));
  }catch(error){next(error)}});

  app.get('/api/jobs/:jobId/changes',(req,res,next)=>{try{res.json({items:jobChanges.list(req.params.jobId)})}catch(error){next(error)}});
  app.post('/api/jobs/:jobId/changes',async(req,res,next)=>{try{
    const current=getCurrentVersion(db,req.params.jobId);if(!current)return res.status(404).json({error:'job_not_found'});
    const text=String(req.body?.text??'').trim();if(!text)throw new Error('job_change_required');
    const safeText=sanitizeTextForCloud(text);const analysis=await deepSeek.analyzeJobChange(current,safeText);
    res.status(201).json(jobChanges.create(req.params.jobId,text,analysis));
  }catch(error){next(error)}});
  app.post('/api/jobs/:jobId/changes/integrate',async(req,res,next)=>{try{
    const jobId=req.params.jobId;const current=getCurrentVersion(db,jobId);if(!current)return res.status(404).json({error:'job_not_found'});
    if(current.approval.status!=='approved')return res.status(409).json({error:'rules_not_approved'});
    const ids=Array.isArray(req.body?.changeIds)?req.body.changeIds.map(String):[];const notes=jobChanges.getSelected(jobId,ids);
    const job=db.prepare('SELECT source_text FROM jobs WHERE id=?').get(jobId) as {source_text:string};
    const merged=await deepSeek.integrateJobChanges(current,sanitizeTextForCloud(job.source_text),notes.map((note)=>({text:sanitizeTextForCloud(note.text),analysis:note.analysis})));
    const nextPack=reviseDraft(db,jobId,merged);jobChanges.markApplied(jobId,ids,nextPack.rule_version);res.json(nextPack);
  }catch(error){next(error)}});

  app.post('/api/jobs/:jobId/gulu-plan/generate',async(req,res,next)=>{try{
    const pack=getCurrentVersion(db,req.params.jobId);if(!pack)return res.status(404).json({error:'job_not_found'});if(pack.approval.status!=='approved')return res.status(409).json({error:'rules_not_approved'});
    const generated=await deepSeek.generateGuluSearchPlan(pack);res.json(gulu.saveDraft(generated.data));
  }catch(error){next(error)}});
  app.post('/api/jobs/:jobId/gulu-plan/import',async(req,res,next)=>{try{
    const pack=getCurrentVersion(db,req.params.jobId);if(!pack)return res.status(404).json({error:'job_not_found'});if(pack.approval.status!=='approved')return res.status(409).json({error:'rules_not_approved'});
    const sourceNotes=String(req.body?.sourceNotes??'').trim();if(!sourceNotes)return res.status(400).json({error:'source_notes_required'});
    const generated=await deepSeek.generateGuluSearchPlan(pack,sanitizeTextForCloud(sourceNotes));
    res.json(gulu.saveDraft({...generated.data,sourceNotes}));
  }catch(error){next(error)}});
  app.put('/api/jobs/:jobId/gulu-plan',(req,res,next)=>{try{res.json(gulu.saveDraft({...req.body,jobId:req.params.jobId}))}catch(error){next(error)}});
  app.put('/api/jobs/:jobId/gulu-plan/confirm',(req,res,next)=>{try{res.json(gulu.confirmPlan(req.params.jobId,req.body))}catch(error){next(error)}});
  app.get('/api/jobs/:jobId/gulu-plan',(req,res)=>{const plan=gulu.getPlan(req.params.jobId);if(!plan)return res.status(404).json({error:'gulu_plan_not_found'});res.json(plan)});
  app.post('/api/jobs/:jobId/gulu-campaigns/generate',async(req,res,next)=>{try{
    const jobId=req.params.jobId;const pack=getCurrentVersion(db,jobId);if(!pack)return res.status(404).json({error:'job_not_found'});if(pack.approval.status!=='approved')return res.status(409).json({error:'rules_not_approved'});
    const sourceNotes=sanitizeTextForCloud(String(req.body?.sourceNotes??'').trim());const history=db.prepare(`SELECT read_count uniqueCount,shortlisted_count highFit,completion_reason completionReason FROM gulu_tasks WHERE job_id=? AND campaign_id IS NOT NULL ORDER BY created_at DESC LIMIT 5`).all(jobId) as Array<Record<string,unknown>>;
    const generated=await deepSeek.generateGuluCampaign(pack,sourceNotes,history);const versionRow=db.prepare('SELECT COALESCE(MAX(version),0)+1 version FROM gulu_search_campaigns WHERE job_id=?').get(jobId) as {version:number};res.json(gulu.saveCampaign({...generated.data,version:versionRow.version}));
  }catch(error){next(error)}});
  app.put('/api/jobs/:jobId/gulu-campaigns/:campaignId',(req,res,next)=>{try{res.json(gulu.saveCampaign({...req.body,id:req.params.campaignId,jobId:req.params.jobId}))}catch(error){next(error)}});
  app.put('/api/jobs/:jobId/gulu-campaigns/:campaignId/confirm',(req,res,next)=>{try{res.json(gulu.confirmCampaign(req.params.jobId,req.params.campaignId,req.body))}catch(error){next(error)}});
  app.get('/api/jobs/:jobId/gulu-campaigns/:campaignId',(req,res,next)=>{try{res.json(gulu.getCampaign(req.params.jobId,req.params.campaignId))}catch(error){if(error instanceof Error&&error.message==='campaign_not_found')return res.status(404).json({error:error.message});next(error)}});
  app.get('/api/jobs/:jobId/runs/gulu',(req,res)=>res.json({items:gulu.listTasks(String(req.params.jobId))}));
  app.post('/api/jobs/:jobId/runs/gulu',(req,res,next)=>{try{
    if(req.body?.fresh!==undefined&&typeof req.body.fresh!=='boolean')return res.status(400).json({error:'fresh_must_be_boolean'});
    const campaignId=String(req.body?.campaignId??'').trim();if(campaignId)return res.status(201).json(gulu.startCampaignTask(String(req.params.jobId),campaignId));
    const requested=String(req.body?.mode??'dry-run');const mode=requested==='pilot'||requested==='formal'?requested:'dry-run';
    if(req.body?.fresh===true&&mode!=='formal')return res.status(400).json({error:'fresh_requires_formal'});
    res.status(201).json(gulu.startTask(String(req.params.jobId),mode));
  }catch(error){if(error instanceof Error&&['gulu_plan_not_confirmed','rules_not_approved','gulu_plan_outdated','gulu_dry_run_required','gulu_pilot_required','gulu_task_already_active','campaign_not_confirmed','campaign_outdated'].includes(error.message))return res.status(409).json({error:error.message});next(error)}});
  app.get('/api/runs/:runId/strategy',(req,res,next)=>{try{res.json(gulu.getTaskStrategy(req.params.runId))}catch(error){if(error instanceof Error&&['run_not_found','campaign_not_found'].includes(error.message))return res.status(404).json({error:error.message});next(error)}});

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
    const runId=typeof req.query.runId==='string'?req.query.runId:'';
    if(runId){
      const bucket=req.query.bucket==='verification'?'verification':'high_fit';
      const scopedTask=db.prepare('SELECT campaign_id campaignId FROM gulu_tasks WHERE id=? AND job_id=?').get(runId,req.params.jobId) as {campaignId:string|null}|undefined;
      if(!scopedTask)return res.status(404).json({error:'run_not_found'});
      const items=db.prepare(`SELECT c.id candidateId,c.name,c.gulu_id guluId,c.detail_url detailUrl,c.current_company currentCompany,
        c.current_role currentRole,c.source_round sourceRound,a.label,a.reason_code reasonCode,a.evidence_json evidence,
        a.rule_version ruleVersion,a.assessed_at assessedAt,COALESCE(h.status,'未复核') reviewStatus,COALESCE(h.note,'') note,
        sf.score searchFit,sf.evidence_json fitEvidence,sf.gaps_json gaps,sf.dimensions_json dimensions,
        sf.verification_questions_json verificationQuestions,sf.policy_version policyVersion
        FROM candidates c JOIN gulu_task_candidates tc ON tc.candidate_id=c.id
        JOIN gulu_tasks t ON t.id=tc.task_id AND t.job_id=c.job_id
        JOIN assessments a ON a.candidate_id=c.id AND a.rule_version=t.rule_version
        LEFT JOIN gulu_search_fits sf ON sf.task_id=t.id AND sf.candidate_id=c.id
        LEFT JOIN human_reviews h ON h.candidate_id=c.id AND h.rule_version=a.rule_version
        WHERE c.job_id=? AND t.id=? AND
          (?=0 OR (a.label<>'exclude' AND ((?='high_fit' AND sf.score>=70) OR (?='verification' AND sf.score BETWEEN 55 AND 69))))
        ORDER BY sf.score DESC,CASE a.label WHEN 'recommend' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,c.name`)
        .all(req.params.jobId,runId,scopedTask.campaignId?1:0,bucket,bucket).map((row:any)=>({
          ...row,
          evidence:JSON.parse(row.fitEvidence||row.evidence||'[]'),
          gaps:JSON.parse(row.gaps||'[]'),
          dimensions:JSON.parse(row.dimensions||'[]'),
          verificationQuestions:JSON.parse(row.verificationQuestions||'[]'),
          guluUrl:safeGuluCandidateUrl(row.detailUrl,row.guluId),
        }));
      return res.json({items});
    }
    const items = db.prepare(`SELECT c.id candidateId,c.name,c.gulu_id guluId,c.detail_url detailUrl,c.current_company currentCompany,
      c.current_role currentRole,c.source_round sourceRound,a.label,a.reason_code reasonCode,a.evidence_json evidence,
      a.rule_version ruleVersion,a.assessed_at assessedAt,COALESCE(h.status,'未审核') reviewStatus,COALESCE(h.note,'') note
      FROM candidates c JOIN jobs j ON j.id=c.job_id
      JOIN assessments a ON a.candidate_id=c.id AND a.rule_version=j.current_rule_version
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
    if(['job_pack_generation_timeout','job_pack_generation_failed'].includes(error.message))return res.status(503).json({error:error.message});
    const known = ['job_not_found','run_not_found','rule_version_not_found','document_has_no_extractable_text','unsafe_source_path','protected_attribute_rule','confirmation_required','candidate_not_in_job','pairing_code_invalid','gulu_plan_not_confirmed','task_aborted'];
    res.status(known.includes(error.message) ? 400 : 500).json({ error: error.message || 'internal_error' });
  });
  return app;
}
