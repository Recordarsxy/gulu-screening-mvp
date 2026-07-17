import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { approveVersion, createDraft, getVersion, reviseDraft } from '../src/server/services/job-pack.js';

describe('versioned job packs', () => {
  const dbs: Array<{ close(): void }> = [];
  afterEach(() => dbs.splice(0).forEach((db) => db.close()));

  it('creates draft v1, revises to draft v2, and approves only v2', () => {
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    const v1 = createDraft(db, { jobId: 'job-1', title: '销售经理', sourceText: '负责制造业大客户销售' });
    expect(v1.rule_version).toBe(1); expect(v1.approval.status).toBe('draft');
    const v2 = reviseDraft(db, 'job-1', { constraints: { ...v1.constraints, hard: ['制造业大客户经验'] } });
    expect(v2.rule_version).toBe(2); expect(v2.constraints.hard).toContain('制造业大客户经验');
    const approved = approveVersion(db, 'job-1', 2);
    expect(approved.approval.status).toBe('approved');
    expect(getVersion(db, 'job-1', 1)?.approval.status).toBe('draft');
  });
});
