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

  it('blocks protected attributes and requires confirmation for sensitive hard constraints', () => {
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    const pack = createDraft(db, { jobId:'job-safe',title:'销售经理',sourceText:'JD' });
    expect(() => reviseDraft(db, 'job-safe', { constraints:{...pack.constraints,hard:['年龄 35 岁以下']} })).toThrowError('protected_attribute_rule');
    expect(() => reviseDraft(db, 'job-safe', { constraints:{...pack.constraints,hard:['本科以上']} })).toThrowError('confirmation_required');
    expect(reviseDraft(db, 'job-safe', { constraints:{...pack.constraints,hard:['[已确认]本科以上']} }).constraints.hard).toContain('[已确认]本科以上');
  });

  it('also blocks protected attributes hidden in role match rules', () => {
    const db=openDatabase(':memory:');dbs.push(db);migrate(db);const pack=createDraft(db,{jobId:'job-role',title:'销售',sourceText:'JD'});
    expect(()=>reviseDraft(db,'job-role',{roles:{...pack.roles,synonyms:['女性销售']}})).toThrowError('protected_attribute_rule');
    expect(()=>reviseDraft(db,'job-role',{roles:{...pack.roles,exact:['30 周岁以下']}})).toThrowError('protected_attribute_rule');
  });
});
