import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { DEMO_JOB_ID, ensureDemoData, resetDemoData } from '../src/server/demo/bootstrap.js';

describe('offline demo bootstrap', () => {
  it('creates one fixed fictional approved job idempotently', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    ensureDemoData(db);
    ensureDemoData(db);

    const jobs = db.prepare('SELECT id,title,current_rule_version FROM jobs').all() as Array<Record<string, unknown>>;
    expect(jobs).toEqual([{ id: DEMO_JOB_ID, title: '工业自动化大客户销售总监（演示）', current_rule_version: 1 }]);
    const rule = db.prepare('SELECT status,pack_json FROM job_rule_versions WHERE job_id=?').get(DEMO_JOB_ID) as { status: string; pack_json: string };
    expect(rule.status).toBe('approved');
    expect(rule.pack_json).toContain('虚构演示数据');
    db.close();
  });

  it('resets only the provided demo database in one transaction', () => {
    const live = openDatabase(':memory:');
    const demo = openDatabase(':memory:');
    migrate(live); migrate(demo);
    live.prepare("INSERT INTO jobs(id,title,source_text,current_rule_version) VALUES ('live-job','真实岗位','JD',0)").run();
    ensureDemoData(demo);
    demo.prepare("INSERT INTO human_reviews(candidate_id,rule_version,status,note) VALUES ('missing',1,'x','x')");
    resetDemoData(demo);

    expect(live.prepare('SELECT title FROM jobs WHERE id=?').get('live-job')).toEqual({ title: '真实岗位' });
    expect(demo.prepare('SELECT COUNT(*) count FROM jobs').get()).toEqual({ count: 1 });
    expect(demo.prepare('SELECT id FROM jobs').get()).toEqual({ id: DEMO_JOB_ID });
    expect(demo.prepare('SELECT token_hash FROM gulu_connector WHERE singleton=1').get()).toEqual({ token_hash: null });
    live.close(); demo.close();
  });
});
