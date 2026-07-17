import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { approveVersion, createDraft, reviseDraft } from '../src/server/services/job-pack.js';
import { ScreeningEngine } from '../src/server/services/screening.js';
import { demoCompanyRound, demoRoleRound } from '../src/server/demo/candidates.js';
import { DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('resumable runs', () => {
  const dbs: Array<{ close(): void }> = [];
  afterEach(() => dbs.splice(0).forEach((db) => db.close()));

  it('refuses to start with an unapproved rule version', () => {
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    createDraft(db, { jobId: 'job-1', title: '销售经理', sourceText: '制造业大客户' });
    const engine = new ScreeningEngine(db);
    expect(() => engine.startRun('job-1', [demoCompanyRound, demoRoleRound])).toThrowError('rules_not_approved');
  });

  it('pauses and resumes from the persisted cursor', async () => {
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    const pack = createDraft(db, { jobId: 'job-1', title: '销售经理', sourceText: '制造业大客户' });
    pack.evidence.required = ['大型制造企业客户拓展'];
    pack.evidence.negative = ['仅零售门店销售'];
    db.prepare('UPDATE job_rule_versions SET pack_json=? WHERE job_id=? AND version=1').run(JSON.stringify(pack), 'job-1');
    approveVersion(db, 'job-1', 1);
    const engine = new ScreeningEngine(db);
    const run = engine.startRun('job-1', [demoCompanyRound, demoRoleRound]);
    await engine.processNext(run.id); await engine.processNext(run.id);
    engine.pauseRun(run.id);
    expect(engine.getRun(run.id)).toMatchObject({ status: 'paused', cursor: 2 });
    engine.resumeRun(run.id);
    await engine.processAll(run.id);
    const finished = engine.getRun(run.id);
    expect(finished.status).toBe('completed');
    expect(finished.cursor).toBe(finished.total);
    expect(db.prepare('SELECT count(*) count FROM assessments').get()).toEqual({ count: finished.total });
  });

  it('continues with the exact approved rule version after a newer draft is created', async () => {
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    const v1 = createDraft(db,{jobId:'job-v',title:'销售经理',sourceText:'JD'}); approveVersion(db,'job-v',1);
    const engine = new ScreeningEngine(db); const run = engine.startRun('job-v',[demoCompanyRound]);
    await engine.processNext(run.id); engine.pauseRun(run.id);
    reviseDraft(db,'job-v',{evidence:{...v1.evidence,negative:['不存在的反证']}});
    engine.resumeRun(run.id); await engine.processAll(run.id);
    expect(engine.getRun(run.id)).toMatchObject({status:'completed',ruleVersion:1});
    expect(db.prepare('SELECT DISTINCT rule_version FROM assessments').all()).toEqual([{rule_version:1}]);
  });

  it('preserves a pause requested while DeepSeek is responding', async () => {
    const db=openDatabase(':memory:');dbs.push(db);migrate(db);const pack=createDraft(db,{jobId:'job-pause',title:'无匹配职位',sourceText:'JD'});pack.evidence.required=['不存在证据'];db.prepare('UPDATE job_rule_versions SET pack_json=? WHERE job_id=? AND version=1').run(JSON.stringify(pack),'job-pause');approveVersion(db,'job-pause',1);
    let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>((resolve)=>{release=resolve});const started=new Promise<void>((resolve)=>{entered=resolve});
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async()=>{entered();await gate;return new Response(JSON.stringify({choices:[{message:{content:'{"label":"review","reasonCode":"AI_REVIEW","evidence":["待复核"]}'}}]}),{status:200})}});
    const engine=new ScreeningEngine(db,provider);const run=engine.startRun('job-pause',[[demoRoleRound[0]]]);const processing=engine.processNext(run.id);await started;engine.pauseRun(run.id);release();await processing;
    expect(engine.getRun(run.id)).toMatchObject({status:'paused',cursor:0});engine.resumeRun(run.id);await engine.processAll(run.id);expect(engine.getRun(run.id).status).toBe('completed');
  });

  it('reuses the canonical candidate id when a later run has the same dedupe key', async () => {
    const db=openDatabase(':memory:');dbs.push(db);migrate(db);const v1=createDraft(db,{jobId:'job-dedupe',title:'销售经理',sourceText:'JD'});approveVersion(db,'job-dedupe',1);const engine=new ScreeningEngine(db);
    let run=engine.startRun('job-dedupe',[[demoRoleRound[0]]]);await engine.processAll(run.id);
    const v2=reviseDraft(db,'job-dedupe',{summary:v1.summary+' v2'});approveVersion(db,'job-dedupe',v2.rule_version);
    run=engine.startRun('job-dedupe',[[{...demoRoleRound[0],id:'new-source-id'}]]);await expect(engine.processAll(run.id)).resolves.toMatchObject({status:'completed'});
    expect(db.prepare('SELECT count(*) count FROM candidates').get()).toEqual({count:1});expect(db.prepare('SELECT count(*) count FROM assessments').get()).toEqual({count:2});
  });
});
