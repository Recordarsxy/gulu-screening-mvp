import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/server/db/migrate.js';
import { createDraft, approveVersion, makeDefaultJobPack } from '../src/server/services/job-pack.js';
import { GuluService } from '../src/server/services/gulu.js';

const dbs: DatabaseSync[] = [];
function setup() {
  const db = new DatabaseSync(':memory:'); dbs.push(db); migrate(db);
  const pack = makeDefaultJobPack('job-1','示例岗位','寻找产品经理');
  createDraft(db,{jobId:'job-1',title:'示例岗位',sourceText:'寻找产品经理',pack}); approveVersion(db,'job-1',1);
  return { db, service:new GuluService(db) };
}
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const draft = { jobId:'job-1',ruleVersion:1,status:'draft' as const,confirmedAt:null,rounds:[
  {kind:'company' as const,limit:50,filters:{companies:['示例科技'],keywords:[],roles:[],cities:[],industries:[],functions:[]}},
  {kind:'role' as const,limit:50,filters:{roles:['产品经理'],keywords:[],companies:[],cities:[],industries:[],functions:[]}},
] as const };

describe('Gulu service', () => {
  it('blocks real runs until the plan is manually confirmed', () => {
    const {service}=setup(); service.saveDraft(draft);
    expect(() => service.startTask('job-1')).toThrow('gulu_plan_not_confirmed');
    service.confirmPlan('job-1',draft);
    expect(service.startTask('job-1').status).toBe('queued');
  });

  it('creates one-time pairing codes and stores only token hashes', () => {
    const {db,service}=setup(); const pairing=service.createPairing();
    const redeemed=service.redeemPairing(pairing.code,'1.1.0');
    expect(redeemed.token.length).toBeGreaterThan(30);
    expect(() => service.redeemPairing(pairing.code,'1.1.0')).toThrow('pairing_code_invalid');
    const row=db.prepare('SELECT token_hash FROM gulu_connector').get() as {token_hash:string};
    expect(row.token_hash).not.toContain(redeemed.token);
    expect(service.authenticate(redeemed.token)).toBe(true);
    service.createPairing();
    expect(service.authenticate(redeemed.token)).toBe(true);
  });

  it('deduplicates snapshots across rounds and persists a restartable cursor', async () => {
    const {service}=setup(); service.confirmPlan('job-1',draft); const task=service.startTask('job-1');
    const snapshot={guluId:'G-1',name:'候选人甲',detailUrl:'http://121.43.105.7/crm#candidate/detail?id=G-1',company:'示例科技',role:'产品经理',sourceRound:'company' as const,page:2,capturedAt:new Date().toISOString()};
    service.recordCandidate(task.id,'event-1',snapshot);
    service.recordCandidate(task.id,'event-2',{...snapshot,sourceRound:'role'});
    service.updateCheckpoint(task.id,{currentRound:'role',page:3,candidateCursor:7});
    const restored=service.getTask(task.id);
    expect(restored).toMatchObject({readCount:2,dedupedCount:1,currentRound:'role',page:3,candidateCursor:7,companyReadCount:1,roleReadCount:1});
    expect(service.recordCandidate(task.id,'event-1',snapshot).duplicateEvent).toBe(true);
  });

  it('stores an immutable plan version and explicit round completion', () => {
    const {db,service}=setup(); const saved=service.saveDraft(draft); const confirmed=service.confirmPlan('job-1',saved); const task=service.startTask('job-1');
    expect(task).toMatchObject({planVersion:confirmed.version,companyStatus:'pending',roleStatus:'pending'});
    expect(JSON.parse((db.prepare('SELECT plan_json FROM gulu_tasks WHERE id=?').get(task.id) as {plan_json:string}).plan_json).version).toBe(confirmed.version);
    expect(service.startRound(task.id,'company').companyStatus).toBe('running');
    expect(service.completeRound(task.id,'company',false).companyStatus).toBe('completed');
    expect(service.startRound(task.id,'role').roleStatus).toBe('running');
    expect(service.completeRound(task.id,'role',true).roleStatus).toBe('empty');
  });

  it('pauses after three consecutive connector failures', () => {
    const {service}=setup(); service.confirmPlan('job-1',draft); const task=service.startTask('job-1');
    service.recordFailure(task.id,'读取失败'); service.recordFailure(task.id,'读取失败');
    expect(service.recordFailure(task.id,'页面结构变化').status).toBe('needs_attention');
  });

  it('makes emergency stop terminal',()=>{
    const {service}=setup();service.confirmPlan('job-1',draft);const task=service.startTask('job-1');service.setStatus(task.id,'running');
    expect(service.setStatus(task.id,'stopped').status).toBe('stopped');
    expect(service.setStatus(task.id,'running').status).toBe('stopped');
  });

  it('enforces dry-run then pilot before a formal run',()=>{
    const {service}=setup();service.confirmPlan('job-1',draft);
    expect(()=>service.startTask('job-1','pilot')).toThrow('gulu_dry_run_required');
    const dry=service.startTask('job-1','dry-run');service.setStatus(dry.id,'running');service.setStatus(dry.id,'completed');
    expect(()=>service.startTask('job-1','formal')).toThrow('gulu_pilot_required');
    const pilot=service.startTask('job-1','pilot');service.setStatus(pilot.id,'running');service.setStatus(pilot.id,'completed');
    expect(service.startTask('job-1','formal').mode).toBe('formal');
  });

  it('allows only one active connector task per job',()=>{
    const {service}=setup();service.confirmPlan('job-1',draft);service.startTask('job-1','dry-run');
    expect(()=>service.startTask('job-1','dry-run')).toThrow('gulu_task_already_active');
  });

  it('clears a recovered connector error when the task completes',()=>{
    const {service}=setup();service.confirmPlan('job-1',draft);const task=service.startTask('job-1','dry-run');
    service.recordFailure(task.id,'temporary_adapter_error');
    expect(service.setStatus(task.id,'completed').lastError).toBeNull();
  });
});
