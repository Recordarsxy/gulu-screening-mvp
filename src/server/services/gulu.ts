import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GuluCandidateSnapshotSchema, GuluConnectorTaskSchema, GuluSearchCampaignSchema, GuluSearchFitSchema, GuluSearchPlanSchema, GuluSearchStepSchema, GuluStepProgressSchema, type GuluConnectorTask, type GuluSearchCampaign, type GuluSearchPlan, type GuluSearchStep, type GuluStepProgress } from '../../shared/contracts.js';
import { getCurrentVersion } from './job-pack.js';
import {lintCampaign,searchFingerprint} from './gulu-campaign.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const constantEqual = (left:string,right:string) => {
  const a=Buffer.from(left); const b=Buffer.from(right); return a.length===b.length && timingSafeEqual(a,b);
};

type TaskRow = Record<string,string|number|null>;
export class GuluService {
  constructor(private readonly db: DatabaseSync) {}

  private writePlan(plan:GuluSearchPlan):GuluSearchPlan {
    this.db.prepare(`INSERT INTO gulu_search_plans(job_id,rule_version,status,plan_json,confirmed_at) VALUES (?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET rule_version=excluded.rule_version,status=excluded.status,plan_json=excluded.plan_json,confirmed_at=excluded.confirmed_at,updated_at=CURRENT_TIMESTAMP`)
      .run(plan.jobId,plan.ruleVersion,plan.status,JSON.stringify(plan),plan.confirmedAt);
    this.db.prepare(`INSERT INTO gulu_search_plan_versions(job_id,version,rule_version,status,plan_json,confirmed_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(job_id,version) DO UPDATE SET rule_version=excluded.rule_version,status=excluded.status,plan_json=excluded.plan_json,confirmed_at=excluded.confirmed_at,updated_at=CURRENT_TIMESTAMP`)
      .run(plan.jobId,plan.version,plan.ruleVersion,plan.status,JSON.stringify(plan),plan.confirmedAt);
    return plan;
  }

  saveDraft(input: unknown): GuluSearchPlan {
    const plan=GuluSearchPlanSchema.parse(input);
    const current=getCurrentVersion(this.db,plan.jobId);
    if (!current) throw new Error('job_not_found');
    if (current.rule_version!==plan.ruleVersion) throw new Error('rule_version_unavailable');
    const previous=this.getPlan(plan.jobId); const now=new Date().toISOString();
    const changed=previous?.status==='confirmed' && JSON.stringify({rounds:previous.rounds,sourceNotes:previous.sourceNotes})!==JSON.stringify({rounds:plan.rounds,sourceNotes:plan.sourceNotes});
    const version=previous ? (changed ? previous.version+1 : Math.max(previous.version,plan.version)) : plan.version;
    const draft=GuluSearchPlanSchema.parse({...plan,version,status:'draft',confirmedAt:null,rollout:{dryRunCompleted:false,pilotCompleted:false},createdAt:version===previous?.version?previous.createdAt:now,updatedAt:now});
    return this.writePlan(draft);
  }

  confirmPlan(jobId:string,input:unknown): GuluSearchPlan {
    const parsed=GuluSearchPlanSchema.parse({...((input && typeof input==='object') ? input : {}),jobId});
    const pack=getCurrentVersion(this.db,jobId);
    if (!pack) throw new Error('job_not_found');
    if (pack.approval.status!=='approved') throw new Error('rules_not_approved');
    if (pack.rule_version!==parsed.ruleVersion) throw new Error('rule_version_unavailable');
    const now=new Date().toISOString();
    const plan=GuluSearchPlanSchema.parse({...parsed,status:'confirmed',confirmedAt:now,rollout:{dryRunCompleted:false,pilotCompleted:false},updatedAt:now});
    return this.writePlan(plan);
  }

  getPlan(jobId:string):GuluSearchPlan|null {
    const row=this.db.prepare('SELECT plan_json FROM gulu_search_plans WHERE job_id=?').get(jobId) as {plan_json:string}|undefined;
    return row?GuluSearchPlanSchema.parse(JSON.parse(row.plan_json)):null;
  }

  saveCampaign(input:unknown):GuluSearchCampaign {
    const parsed=lintCampaign(input);const pack=getCurrentVersion(this.db,parsed.jobId);if(!pack)throw new Error('job_not_found');if(pack.rule_version!==parsed.ruleVersion)throw new Error('rule_version_unavailable');
    const now=new Date().toISOString();const campaign=GuluSearchCampaignSchema.parse({...parsed,status:'draft',confirmedAt:null,updatedAt:now});
    this.db.prepare(`INSERT INTO gulu_search_campaigns(id,job_id,version,rule_version,status,campaign_json,confirmed_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version,rule_version=excluded.rule_version,status=excluded.status,campaign_json=excluded.campaign_json,confirmed_at=NULL,updated_at=CURRENT_TIMESTAMP`)
      .run(campaign.id,campaign.jobId,campaign.version,campaign.ruleVersion,campaign.status,JSON.stringify(campaign),null);return campaign;
  }

  confirmCampaign(jobId:string,campaignId:string,input:unknown):GuluSearchCampaign {
    const pack=getCurrentVersion(this.db,jobId);if(!pack)throw new Error('job_not_found');if(pack.approval.status!=='approved')throw new Error('rules_not_approved');
    const parsed=lintCampaign({...((input&&typeof input==='object')?input:{}),id:campaignId,jobId});if(parsed.ruleVersion!==pack.rule_version)throw new Error('rule_version_unavailable');
    const now=new Date().toISOString();const campaign=GuluSearchCampaignSchema.parse({...parsed,status:'confirmed',confirmedAt:now,updatedAt:now});
    this.db.prepare(`INSERT INTO gulu_search_campaigns(id,job_id,version,rule_version,status,campaign_json,confirmed_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version,rule_version=excluded.rule_version,status=excluded.status,campaign_json=excluded.campaign_json,confirmed_at=excluded.confirmed_at,updated_at=CURRENT_TIMESTAMP`)
      .run(campaign.id,campaign.jobId,campaign.version,campaign.ruleVersion,campaign.status,JSON.stringify(campaign),campaign.confirmedAt);return campaign;
  }

  getCampaign(jobId:string,campaignId:string):GuluSearchCampaign {
    const row=this.db.prepare('SELECT campaign_json FROM gulu_search_campaigns WHERE id=? AND job_id=?').get(campaignId,jobId) as {campaign_json:string}|undefined;if(!row)throw new Error('campaign_not_found');return GuluSearchCampaignSchema.parse(JSON.parse(row.campaign_json));
  }

  startCampaignTask(jobId:string,campaignId:string):GuluConnectorTask {
    const campaign=this.getCampaign(jobId,campaignId);if(campaign.status!=='confirmed')throw new Error('campaign_not_confirmed');const pack=getCurrentVersion(this.db,jobId);if(!pack||pack.approval.status!=='approved')throw new Error('rules_not_approved');if(pack.rule_version!==campaign.ruleVersion)throw new Error('campaign_outdated');
    const active=this.db.prepare("SELECT 1 ok FROM gulu_tasks WHERE job_id=? AND status IN ('queued','running','paused','needs_attention')").get(jobId);if(active)throw new Error('gulu_task_already_active');
    const enabled=campaign.steps.filter(step=>step.enabled).sort((a,b)=>a.order-b.order);const id=randomUUID();
    this.db.exec('BEGIN');try{this.db.prepare(`INSERT INTO gulu_tasks(id,job_id,rule_version,plan_version,plan_json,status,mode,campaign_id,campaign_version,phase,current_step_index) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,jobId,campaign.ruleVersion,campaign.version,JSON.stringify(campaign),'queued','formal',campaign.id,campaign.version,'preflight',0);const insert=this.db.prepare('INSERT INTO gulu_task_steps(task_id,step_id,position,step_json) VALUES (?,?,?,?)');enabled.forEach((step,index)=>insert.run(id,step.id,index,JSON.stringify(step)));this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}return this.getTask(id);
  }

  startTask(jobId:string,mode:'dry-run'|'pilot'|'formal'='dry-run'):GuluConnectorTask {
    const plan=this.getPlan(jobId); if (!plan || plan.status!=='confirmed') throw new Error('gulu_plan_not_confirmed');
    const pack=getCurrentVersion(this.db,jobId);if(!pack)throw new Error('job_not_found');
    if(pack.approval.status!=='approved')throw new Error('rules_not_approved');
    if(pack.rule_version!==plan.ruleVersion)throw new Error('gulu_plan_outdated');
    if(mode==='pilot'&&!plan.rollout.dryRunCompleted)throw new Error('gulu_dry_run_required');
    if(mode==='formal'&&!plan.rollout.pilotCompleted)throw new Error('gulu_pilot_required');
    const active=this.db.prepare("SELECT 1 ok FROM gulu_tasks WHERE job_id=? AND status IN ('queued','running','paused','needs_attention')").get(jobId);
    if(active)throw new Error('gulu_task_already_active');
    const id=randomUUID(); this.db.prepare('INSERT INTO gulu_tasks(id,job_id,rule_version,plan_version,plan_json,status,mode) VALUES (?,?,?,?,?,?,?)').run(id,jobId,plan.ruleVersion,plan.version,JSON.stringify(plan),'queued',mode);
    return this.getTask(id);
  }

  getTask(id:string):GuluConnectorTask {
    const row=this.db.prepare('SELECT * FROM gulu_tasks WHERE id=?').get(id) as TaskRow|undefined;
    if (!row) throw new Error('run_not_found');
    const stepProgress=row.campaign_id?this.getTaskSteps(String(row.id)):[];const current=stepProgress[Number(row.current_step_index??0)];
    return GuluConnectorTaskSchema.parse({id:row.id,jobId:row.job_id,ruleVersion:row.rule_version,planVersion:row.plan_version,status:row.status,mode:row.mode,currentRound:row.current_round,page:row.page,candidateCursor:row.candidate_cursor,readCount:row.read_count,roundReadCount:row.round_read_count,dedupedCount:row.deduped_count,analyzedCount:row.analyzed_count,inputTokens:row.input_tokens,outputTokens:row.output_tokens,companyStatus:row.company_status,roleStatus:row.role_status,companyReadCount:row.company_read_count,roleReadCount:row.role_read_count,lastError:row.last_error,campaignId:row.campaign_id??null,campaignVersion:row.campaign_version??null,phase:row.phase??'preflight',currentStepIndex:row.current_step_index??0,currentStepId:current?.stepId??null,shortlistedCount:row.shortlisted_count??0,completionReason:row.completion_reason??null,stepProgress,createdAt:row.created_at,updatedAt:row.updated_at});
  }

  getTaskSteps(id:string):GuluStepProgress[]{const rows=this.db.prepare('SELECT step_id,status,page,candidate_cursor,read_count,unique_count,high_fit_count,last_error FROM gulu_task_steps WHERE task_id=? ORDER BY position').all(id) as Array<Record<string,unknown>>;return rows.map(row=>GuluStepProgressSchema.parse({stepId:row.step_id,status:row.status,page:row.page,candidateCursor:row.candidate_cursor,readCount:row.read_count,uniqueCount:row.unique_count,duplicateRate:Number(row.read_count)?1-Number(row.unique_count)/Number(row.read_count):0,highFitCount:row.high_fit_count,lastError:row.last_error}));}
  getTaskStrategy(id:string){const task=this.getTask(id);if(!task.campaignId)throw new Error('campaign_not_found');const campaign=this.getCampaign(task.jobId,task.campaignId);const rows=this.db.prepare('SELECT step_json FROM gulu_task_steps WHERE task_id=? ORDER BY position').all(id) as Array<{step_json:string}>;const steps=rows.map(row=>GuluSearchStepSchema.parse(JSON.parse(row.step_json)));const decisions=this.db.prepare('SELECT id,step_id stepId,action,metrics_json metrics,rationale,patch_json patch,created_at createdAt FROM gulu_strategy_decisions WHERE task_id=? ORDER BY created_at,rowid').all(id).map((row:any)=>({...row,metrics:JSON.parse(row.metrics),patch:JSON.parse(row.patch)}));return{task,campaign,steps,progress:task.stepProgress,decisions};}
  getCurrentCampaignStep(id:string):GuluSearchStep|null {const task=this.getTask(id);if(!task.campaignId||!task.currentStepId)return null;const row=this.db.prepare('SELECT step_json FROM gulu_task_steps WHERE task_id=? AND step_id=?').get(id,task.currentStepId) as {step_json:string}|undefined;return row?GuluSearchStepSchema.parse(JSON.parse(row.step_json)):null;}
  completePreflight(id:string):GuluConnectorTask {const task=this.getTask(id);if(!task.campaignId)throw new Error('campaign_not_found');this.db.prepare("UPDATE gulu_tasks SET status='running',phase='calibration',page=1,candidate_cursor=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);return this.getTask(id);}
  filterUnseen(id:string,input:string[]):string[]{this.getTask(id);const values=[...new Set(input.map(String).map(value=>value.trim()).filter(Boolean))];if(!values.length)return[];const placeholders=values.map(()=>'?').join(',');const rows=this.db.prepare(`SELECT dedupe_key FROM gulu_snapshots WHERE task_id=? AND dedupe_key IN (${placeholders})`).all(id,...values) as Array<{dedupe_key:string}>;const seen=new Set(rows.map(row=>row.dedupe_key));return values.filter(value=>!seen.has(value));}
  startStep(id:string,stepId:string):GuluConnectorTask {this.db.prepare("UPDATE gulu_task_steps SET status='calibrating',updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND step_id=?").run(id,stepId);this.db.prepare("UPDATE gulu_tasks SET status='running',phase='calibration',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);return this.getTask(id);}
  finishCalibration(id:string,stepId:string):GuluConnectorTask {this.db.prepare("UPDATE gulu_task_steps SET status='running',updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND step_id=?").run(id,stepId);this.db.prepare("UPDATE gulu_tasks SET phase='search',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);return this.getTask(id);}
  recordStrategyDecision(id:string,stepId:string,action:string,metrics:Record<string,unknown>,rationale:string,patch:Record<string,unknown>={}):void {this.db.prepare('INSERT INTO gulu_strategy_decisions(id,task_id,step_id,action,metrics_json,rationale,patch_json) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),id,stepId,action,JSON.stringify(metrics),rationale.slice(0,1000),JSON.stringify(patch));}
  stopCampaign(id:string,reason:string):GuluConnectorTask {this.db.prepare("UPDATE gulu_tasks SET status='completed',phase='completed',completion_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reason.slice(0,500),id);return this.getTask(id);}
  recordSearchFit(id:string,candidateId:string,stepId:string,input:unknown):GuluConnectorTask {const fit=GuluSearchFitSchema.parse(input);const existing=this.db.prepare('SELECT score FROM gulu_search_fits WHERE task_id=? AND candidate_id=?').get(id,candidateId) as {score:number}|undefined;this.db.prepare(`INSERT INTO gulu_search_fits(task_id,candidate_id,step_id,score,evidence_json,gaps_json,model,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,candidate_id) DO UPDATE SET step_id=excluded.step_id,score=excluded.score,evidence_json=excluded.evidence_json,gaps_json=excluded.gaps_json,model=excluded.model,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens`).run(id,candidateId,stepId,fit.score,JSON.stringify(fit.evidence),JSON.stringify(fit.gaps),fit.model,fit.inputTokens,fit.outputTokens);if(fit.score>=70&&(!existing||existing.score<70)){this.db.prepare('UPDATE gulu_tasks SET shortlisted_count=shortlisted_count+1 WHERE id=?').run(id);this.db.prepare('UPDATE gulu_task_steps SET high_fit_count=high_fit_count+1 WHERE task_id=? AND step_id=?').run(id,stepId)}return this.getTask(id);}
  completeStep(id:string,stepId:string,empty=false):GuluConnectorTask {const task=this.getTask(id);const campaign=task.campaignId?this.getCampaign(task.jobId,task.campaignId):null;this.db.prepare('UPDATE gulu_task_steps SET status=?,updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND step_id=?').run(empty?'empty':'completed',id,stepId);if(campaign&&task.shortlistedCount>=campaign.targetShortlist){this.db.prepare("UPDATE gulu_tasks SET status='completed',phase='completed',completion_reason='target_reached',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);return this.getTask(id)}const next=task.currentStepIndex+1;const count=this.getTaskSteps(id).length;if(next>=count){this.db.prepare("UPDATE gulu_tasks SET status='completed',phase='completed',completion_reason='search_exhausted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)}else{this.db.prepare("UPDATE gulu_tasks SET current_step_index=?,phase='search',page=1,candidate_cursor=0,round_read_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(next,id)}return this.getTask(id);}
  appendCompanyStep(id:string,input:{name:string;source:'deepseek'|'candidate_company';reason:string}):GuluSearchStep {const task=this.getTask(id);if(!task.campaignId)throw new Error('campaign_not_found');const campaign=this.getCampaign(task.jobId,task.campaignId);const rows=this.db.prepare('SELECT step_json FROM gulu_task_steps WHERE task_id=? ORDER BY position').all(id) as Array<{step_json:string}>;if(rows.length>=campaign.maxSteps)throw new Error('campaign_step_limit');const existing=rows.map(row=>GuluSearchStepSchema.parse(JSON.parse(row.step_json)));const filters={keywords:[],companies:[input.name.trim()],roles:[],cities:[],industries:[],functions:[]};if(existing.some(step=>searchFingerprint(step.filters)===searchFingerprint(filters)))throw new Error('campaign_step_duplicate');const used=existing.reduce((sum,step)=>sum+step.limit,0);const limit=Math.min(20,campaign.maxUniqueCandidates-used);if(limit<5)throw new Error('campaign_budget_exceeded');const step=GuluSearchStepSchema.parse({id:randomUUID(),order:rows.length,type:'company_expansion',title:`公司扩展：${input.name}`,objective:'沿高潜人才公司继续搜索',rationale:input.reason,expectedSignals:[],limit,enabled:true,filters,sources:[{kind:input.source,field:'companies',value:input.name.trim(),reason:input.reason}]});this.db.prepare('INSERT INTO gulu_task_steps(task_id,step_id,position,step_json) VALUES (?,?,?,?)').run(id,step.id,rows.length,JSON.stringify(step));return step;}

  listTasks(jobId:string):GuluConnectorTask[] {
    const rows=this.db.prepare('SELECT id FROM gulu_tasks WHERE job_id=? ORDER BY created_at DESC,rowid DESC').all(jobId) as Array<{id:string}>;
    return rows.map((row)=>this.getTask(row.id));
  }

  linkCandidate(taskId:string,candidateId:string):void {
    const task=this.getTask(taskId);
    const candidate=this.db.prepare('SELECT job_id FROM candidates WHERE id=?').get(candidateId) as {job_id:string}|undefined;
    if(!candidate)throw new Error('candidate_not_found');
    if(candidate.job_id!==task.jobId)throw new Error('candidate_job_mismatch');
    this.db.prepare('INSERT OR IGNORE INTO gulu_task_candidates(task_id,candidate_id) VALUES (?,?)').run(taskId,candidateId);
  }

  getTaskPlan(id:string):GuluSearchPlan {
    const row=this.db.prepare('SELECT plan_json FROM gulu_tasks WHERE id=?').get(id) as {plan_json:string}|undefined;if(!row)throw new Error('run_not_found');
    return GuluSearchPlanSchema.parse(JSON.parse(row.plan_json));
  }

  startRound(id:string,round:'company'|'role'):GuluConnectorTask {
    this.getTask(id); const column=round==='company'?'company_status':'role_status';
    this.db.prepare(`UPDATE gulu_tasks SET ${column}='running',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
    return this.getTask(id);
  }

  completeRound(id:string,round:'company'|'role',empty=false):GuluConnectorTask {
    this.getTask(id); const column=round==='company'?'company_status':'role_status';
    this.db.prepare(`UPDATE gulu_tasks SET ${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(empty?'empty':'completed',id);
    return this.getTask(id);
  }

  updateCheckpoint(id:string,patch:{currentRound?:'company'|'role';page?:number;candidateCursor?:number;status?:GuluConnectorTask['status']}):GuluConnectorTask {
    const current=this.getTask(id);
    const nextRound=patch.currentRound??current.currentRound;
    this.db.prepare('UPDATE gulu_tasks SET current_round=?,page=?,candidate_cursor=?,status=?,round_read_count=CASE WHEN current_round<>? THEN 0 ELSE round_read_count END,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(nextRound,patch.page??current.page,patch.candidateCursor??current.candidateCursor,patch.status??current.status,nextRound,id);
    if(current.campaignId&&current.currentStepId)this.db.prepare('UPDATE gulu_task_steps SET page=?,candidate_cursor=?,updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND step_id=?').run(patch.page??current.page,patch.candidateCursor??current.candidateCursor,id,current.currentStepId);
    return this.getTask(id);
  }

  recordCandidate(id:string,eventId:string,input:unknown):{task:GuluConnectorTask;duplicateEvent:boolean} & GuluConnectorTask {
    const snapshot=GuluCandidateSnapshotSchema.parse(input); this.getTask(id);
    const event=this.db.prepare('INSERT OR IGNORE INTO gulu_task_events(event_id,task_id,event_type,payload_json) VALUES (?,?,?,?)').run(eventId,id,'candidate',JSON.stringify(snapshot));
    if (Number(event.changes)===0) { const task=this.getTask(id); return {...task,task,duplicateEvent:true}; }
    const dedupeKey=snapshot.guluId||snapshot.detailUrl;const contentHash=sha256(JSON.stringify({company:snapshot.company,role:snapshot.role,city:snapshot.city,industry:snapshot.industry,function:snapshot.function,salary:snapshot.salary,experiences:snapshot.experiences,education:snapshot.education,tags:snapshot.tags}));
    const source=String(snapshot.sourceStepId??snapshot.sourceRound??'legacy');const inserted=this.db.prepare('INSERT OR IGNORE INTO gulu_snapshots(task_id,dedupe_key,content_hash,snapshot_json,first_round) VALUES (?,?,?,?,?)').run(id,dedupeKey,contentHash,JSON.stringify(snapshot),source);
    this.db.prepare(`UPDATE gulu_tasks SET read_count=read_count+1,round_read_count=round_read_count+1,deduped_count=deduped_count+?,
      company_read_count=company_read_count+CASE WHEN ?='company' THEN 1 ELSE 0 END,
      role_read_count=role_read_count+CASE WHEN ?='role' THEN 1 ELSE 0 END,
      consecutive_failures=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(Number(inserted.changes),snapshot.sourceRound??'campaign',snapshot.sourceRound??'campaign',id);
    const taskState=this.getTask(id);if(taskState.campaignId&&snapshot.sourceStepId)this.db.prepare('UPDATE gulu_task_steps SET read_count=read_count+1,unique_count=unique_count+?,updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND step_id=?').run(Number(inserted.changes),id,snapshot.sourceStepId);
    const task=this.getTask(id); return {...task,task,duplicateEvent:false};
  }

  recordFailure(id:string,message:string):GuluConnectorTask {
    this.getTask(id); this.db.prepare(`UPDATE gulu_tasks SET consecutive_failures=consecutive_failures+1,last_error=?,
      status=CASE WHEN consecutive_failures+1>=3 THEN 'needs_attention' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(message.slice(0,300),id);
    return this.getTask(id);
  }

  recordAnalysis(id:string,inputTokens:number,outputTokens:number):GuluConnectorTask {
    this.db.prepare('UPDATE gulu_tasks SET analyzed_count=analyzed_count+1,input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(inputTokens,outputTokens,id);return this.getTask(id);
  }

  setStatus(id:string,status:'running'|'paused'|'stopped'|'completed'|'needs_attention'):GuluConnectorTask {
    const current=this.getTask(id);const allowed:Record<string,string[]>={running:['queued','paused','needs_attention'],paused:['queued','running'],stopped:['queued','running','paused','needs_attention'],completed:['queued','running'],needs_attention:['queued','running']};
    if(!allowed[status]?.includes(current.status))return current;
    this.db.prepare('UPDATE gulu_tasks SET status=?,last_error=CASE WHEN ?=? THEN NULL ELSE last_error END,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,status,'completed',id);
    if(status==='completed'){
      const row=this.db.prepare('SELECT job_id,mode FROM gulu_tasks WHERE id=?').get(id) as {job_id:string;mode:string};const plan=this.getPlan(row.job_id);
      if(plan){if(row.mode==='dry-run')plan.rollout.dryRunCompleted=true;if(row.mode==='pilot')plan.rollout.pilotCompleted=true;plan.updatedAt=new Date().toISOString();this.writePlan(plan);}
    }
    return this.getTask(id);
  }

  pauseForReason(id:string,reason:string):GuluConnectorTask {
    this.db.prepare("UPDATE gulu_tasks SET status='needs_attention',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reason.slice(0,300),id);return this.getTask(id);
  }

  createPairing():{code:string;expiresAt:string} {
    const code=String(randomInt(0,1_000_000)).padStart(6,'0'); const expiresAt=new Date(Date.now()+10*60_000).toISOString();
    this.db.prepare(`UPDATE gulu_connector SET pairing_code_hash=?,pairing_expires_at=?,gulu_status='awaiting_pairing',last_error=NULL WHERE singleton=1`)
      .run(sha256(code),expiresAt); return {code,expiresAt};
  }

  redeemPairing(code:string,extensionVersion:string):{token:string} {
    const row=this.db.prepare('SELECT pairing_code_hash,pairing_expires_at FROM gulu_connector WHERE singleton=1').get() as {pairing_code_hash:string|null;pairing_expires_at:string|null};
    if (!row.pairing_code_hash || !row.pairing_expires_at || Date.parse(row.pairing_expires_at)<Date.now() || !constantEqual(row.pairing_code_hash,sha256(code))) throw new Error('pairing_code_invalid');
    const token=randomBytes(32).toString('base64url');
    this.db.prepare(`UPDATE gulu_connector SET pairing_code_hash=NULL,pairing_expires_at=NULL,token_hash=?,paired_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP,extension_version=?,gulu_status='paired' WHERE singleton=1`)
      .run(sha256(token),extensionVersion.slice(0,30)); return {token};
  }

  authenticate(token:string):boolean {
    const row=this.db.prepare('SELECT token_hash FROM gulu_connector WHERE singleton=1').get() as {token_hash:string|null};
    return Boolean(row.token_hash && constantEqual(row.token_hash,sha256(token)));
  }

  heartbeat(status:string,error:null|string=null,extensionVersion=''):void {
    this.db.prepare(`UPDATE gulu_connector SET last_seen_at=CURRENT_TIMESTAMP,gulu_status=?,last_error=?,
      extension_version=CASE WHEN ?<>'' THEN ? ELSE extension_version END WHERE singleton=1`)
      .run(status.slice(0,40),error?.slice(0,300)??null,extensionVersion,extensionVersion.slice(0,30));
  }

  getStatus() {
    const row=this.db.prepare('SELECT paired_at,last_seen_at,extension_version,gulu_status,last_error FROM gulu_connector WHERE singleton=1').get() as Record<string,unknown>;
    const lastSeen=row.last_seen_at?Date.parse(String(row.last_seen_at).replace(' ','T')+'Z'):0;
    const online=Date.now()-lastSeen<45_000;if(row.paired_at&&!online)this.db.prepare("UPDATE gulu_tasks SET status='needs_attention',last_error='Chrome 已关闭或扩展离线',updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','running')").run();
    return {paired:Boolean(row.paired_at),extensionOnline:online,chromeOnline:online,guluStatus:row.gulu_status,extensionVersion:row.extension_version,lastError:row.last_error};
  }
}
