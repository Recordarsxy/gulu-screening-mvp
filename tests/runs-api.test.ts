import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { approveVersion, createDraft } from '../src/server/services/job-pack.js';
import { ScreeningEngine } from '../src/server/services/screening.js';
import { demoCompanyRound, demoRoleRound } from '../src/server/demo/candidates.js';

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
});
