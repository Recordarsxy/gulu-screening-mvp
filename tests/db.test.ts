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
    expect(names).toEqual(expect.arrayContaining(['schema_migrations','jobs','job_rule_versions','search_tasks','runs','candidates','assessments','human_reviews','audit_events']));
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

  it('upgrades an existing runs table without losing it', () => {
    const db = openDatabase(':memory:'); databases.push(db);
    db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY,job_id TEXT,rule_version INTEGER,status TEXT,cursor INTEGER DEFAULT 0,total INTEGER DEFAULT 0,input_tokens INTEGER DEFAULT 0,output_tokens INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    migrate(db);
    const columns = db.prepare('PRAGMA table_info(runs)').all() as Array<{name:string}>;
    expect(columns.map((column)=>column.name)).toContain('input_json');
  });
});
