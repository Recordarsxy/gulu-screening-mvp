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

  saveDraft(input: unknown): GuluSearchPlan {
    const plan=GuluSearchPlanSchema.parse(input);
    const current=getCurrentVersion(this.db,plan.jobId);
    if (!current) throw new Error('job_not_found');
    if (current.rule_version!==plan.ruleVersion) throw new Error('rule_version_unavailable');
    const draft={...plan,status:'draft' as const,confirmedAt:null};
    this.db.prepare(`INSERT INTO gulu_search_plans(job_id,rule_version,status,plan_json,confirmed_at) VALUES (?,?,?,?,NULL)
      ON CONFLICT(job_id) DO UPDATE SET rule_version=excluded.rule_version,status='draft',plan_json=excluded.plan_json,confirmed_at=NULL,updated_at=CURRENT_TIMESTAMP`)
      .run(plan.jobId,plan.ruleVersion,'draft',JSON.stringify(draft));
    return draft;
  }

  confirmPlan(jobId:string,input:unknown): GuluSearchPlan {
    const parsed=GuluSearchPlanSchema.parse({...((input && typeof input==='object') ? input : {}),jobId});
    const pack=getCurrentVersion(this.db,jobId);
    if (!pack) throw new Error('job_not_found');
    if (pack.approval.status!=='approved') throw new Error('rules_not_approved');
    if (pack.rule_version!==parsed.ruleVersion) throw new Error('rule_version_unavailable');
    const plan={...parsed,status:'confirmed' as const,confirmedAt:new Date().toISOString()};
    this.db.prepare(`INSERT INTO gulu_search_plans(job_id,rule_version,status,plan_json,confirmed_at) VALUES (?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET rule_version=excluded.rule_version,status=excluded.status,plan_json=excluded.plan_json,confirmed_at=excluded.confirmed_at,updated_at=CURRENT_TIMESTAMP`)
      .run(jobId,plan.ruleVersion,'confirmed',JSON.stringify(plan),plan.confirmedAt);
    return plan;
  }

  getPlan(jobId:string):GuluSearchPlan|null {
    const row=this.db.prepare('SELECT plan_json FROM gulu_search_plans WHERE job_id=?').get(jobId) as {plan_json:string}|undefined;
    return row?GuluSearchPlanSchema.parse(JSON.parse(row.plan_json)):null;
  }

  startTask(jobId:string,mode:'dry-run'|'pilot'|'formal'='dry-run'):GuluConnectorTask {
    const plan=this.getPlan(jobId); if (!plan || plan.status!=='confirmed') throw new Error('gulu_plan_not_confirmed');
    const id=randomUUID(); this.db.prepare('INSERT INTO gulu_tasks(id,job_id,rule_version,status,mode) VALUES (?,?,?,?,?)').run(id,jobId,plan.ruleVersion,'queued',mode);
    return this.getTask(id);
  }

  getTask(id:string):GuluConnectorTask {
    const row=this.db.prepare('SELECT * FROM gulu_tasks WHERE id=?').get(id) as TaskRow|undefined;
    if (!row) throw new Error('run_not_found');
    return GuluConnectorTaskSchema.parse({id:row.id,jobId:row.job_id,ruleVersion:row.rule_version,status:row.status,mode:row.mode,currentRound:row.current_round,page:row.page,candidateCursor:row.candidate_cursor,readCount:row.read_count,roundReadCount:row.round_read_count,dedupedCount:row.deduped_count,analyzedCount:row.analyzed_count,inputTokens:row.input_tokens,outputTokens:row.output_tokens,lastError:row.last_error});
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
    this.db.prepare(`UPDATE gulu_tasks SET read_count=read_count+1,round_read_count=round_read_count+1,deduped_count=deduped_count+?,consecutive_failures=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(Number(inserted.changes),id);
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
    this.db.prepare('UPDATE gulu_tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,id); return this.getTask(id);
  }

  pauseForReason(id:string,reason:string):GuluConnectorTask {
    this.db.prepare("UPDATE gulu_tasks SET status='needs_attention',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reason.slice(0,300),id);return this.getTask(id);
  }

  createPairing():{code:string;expiresAt:string} {
    const code=String(randomInt(0,1_000_000)).padStart(6,'0'); const expiresAt=new Date(Date.now()+10*60_000).toISOString();
    this.db.prepare(`UPDATE gulu_connector SET pairing_code_hash=?,pairing_expires_at=?,token_hash=NULL,paired_at=NULL,gulu_status='awaiting_pairing',last_error=NULL WHERE singleton=1`)
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
