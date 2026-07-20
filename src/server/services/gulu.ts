import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GuluCandidateSnapshotSchema, GuluConnectorTaskSchema, GuluSearchPlanSchema, type GuluConnectorTask, type GuluSearchPlan } from '../../shared/contracts.js';
import { getCurrentVersion } from './job-pack.js';

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

  startTask(jobId:string,mode:'dry-run'|'pilot'|'formal'='dry-run'):GuluConnectorTask {
    const plan=this.getPlan(jobId); if (!plan || plan.status!=='confirmed') throw new Error('gulu_plan_not_confirmed');
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
    return GuluConnectorTaskSchema.parse({id:row.id,jobId:row.job_id,ruleVersion:row.rule_version,planVersion:row.plan_version,status:row.status,mode:row.mode,currentRound:row.current_round,page:row.page,candidateCursor:row.candidate_cursor,readCount:row.read_count,roundReadCount:row.round_read_count,dedupedCount:row.deduped_count,analyzedCount:row.analyzed_count,inputTokens:row.input_tokens,outputTokens:row.output_tokens,companyStatus:row.company_status,roleStatus:row.role_status,companyReadCount:row.company_read_count,roleReadCount:row.role_read_count,lastError:row.last_error});
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
    return this.getTask(id);
  }

  recordCandidate(id:string,eventId:string,input:unknown):{task:GuluConnectorTask;duplicateEvent:boolean} & GuluConnectorTask {
    const snapshot=GuluCandidateSnapshotSchema.parse(input); this.getTask(id);
    const event=this.db.prepare('INSERT OR IGNORE INTO gulu_task_events(event_id,task_id,event_type,payload_json) VALUES (?,?,?,?)').run(eventId,id,'candidate',JSON.stringify(snapshot));
    if (Number(event.changes)===0) { const task=this.getTask(id); return {...task,task,duplicateEvent:true}; }
    const dedupeKey=snapshot.guluId||snapshot.detailUrl;const contentHash=sha256(JSON.stringify({company:snapshot.company,role:snapshot.role,city:snapshot.city,industry:snapshot.industry,function:snapshot.function,salary:snapshot.salary,experiences:snapshot.experiences,education:snapshot.education,tags:snapshot.tags}));
    const inserted=this.db.prepare('INSERT OR IGNORE INTO gulu_snapshots(task_id,dedupe_key,content_hash,snapshot_json,first_round) VALUES (?,?,?,?,?)').run(id,dedupeKey,contentHash,JSON.stringify(snapshot),snapshot.sourceRound);
    this.db.prepare(`UPDATE gulu_tasks SET read_count=read_count+1,round_read_count=round_read_count+1,deduped_count=deduped_count+?,
      company_read_count=company_read_count+CASE WHEN ?='company' THEN 1 ELSE 0 END,
      role_read_count=role_read_count+CASE WHEN ?='role' THEN 1 ELSE 0 END,
      consecutive_failures=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(Number(inserted.changes),snapshot.sourceRound,snapshot.sourceRound,id);
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

  heartbeat(status:string,error:null|string=null):void {
    this.db.prepare('UPDATE gulu_connector SET last_seen_at=CURRENT_TIMESTAMP,gulu_status=?,last_error=? WHERE singleton=1').run(status.slice(0,40),error?.slice(0,300)??null);
  }

  getStatus() {
    const row=this.db.prepare('SELECT paired_at,last_seen_at,extension_version,gulu_status,last_error FROM gulu_connector WHERE singleton=1').get() as Record<string,unknown>;
    const lastSeen=row.last_seen_at?Date.parse(String(row.last_seen_at).replace(' ','T')+'Z'):0;
    const online=Date.now()-lastSeen<45_000;if(row.paired_at&&!online)this.db.prepare("UPDATE gulu_tasks SET status='needs_attention',last_error='Chrome 已关闭或扩展离线',updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','running')").run();
    return {paired:Boolean(row.paired_at),extensionOnline:online,chromeOnline:online,guluStatus:row.gulu_status,extensionVersion:row.extension_version,lastError:row.last_error};
  }
}
