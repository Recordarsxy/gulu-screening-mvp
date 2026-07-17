import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { createRepositories } from '../src/server/db/repositories.js';

describe('SQLite model', () => {
  const databases: Array<{ close(): void }> = [];
  afterEach(() => databases.splice(0).forEach((db) => db.close()));

  it('creates all eight required business tables', () => {
    const db = openDatabase(':memory:'); databases.push(db);
    migrate(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['jobs','job_rule_versions','search_tasks','runs','candidates','assessments','human_reviews','audit_events']));
  });

  it('deletes dependent candidates and assessments with a job', () => {
    const db = openDatabase(':memory:'); databases.push(db); migrate(db);
    const repos = createRepositories(db);
    repos.jobs.create({ id: 'job-1', title: '演示岗位', sourceText: 'JD' });
    repos.candidates.upsert({ id: 'c1', jobId: 'job-1', dedupeKey: 'd1', name: '候选人甲', currentCompany: 'A', currentRole: '经理', experiences: [] });
    repos.assessments.create({ id: 'a1', jobId: 'job-1', candidateId: 'c1', ruleVersion: 1, label: 'review', reasonCode: 'MISSING_INFORMATION', evidence: ['信息不足'], model: 'rules', inputTokens: 0, outputTokens: 0 });
    repos.jobs.delete('job-1');
    expect(db.prepare('SELECT count(*) AS count FROM candidates').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT count(*) AS count FROM assessments').get()).toEqual({ count: 0 });
  });
});
