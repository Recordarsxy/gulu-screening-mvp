import type { DatabaseSync } from 'node:sqlite';
import { JobPackSchema, type JobPack } from '../../shared/contracts.js';

export function validateRulePolicy(pack: JobPack): void {
  const decisive = [...pack.constraints.hard, ...pack.evidence.required, ...pack.evidence.negative, ...pack.roles.exact, ...pack.roles.synonyms, ...pack.roles.excluded, ...pack.industries.excluded];
  const protectedPattern = /年龄|周岁|\d+\s*岁|性别|男性|女性|婚育|婚姻|已婚|未婚|生育|gender|(^|[^a-zA-Z])(?:男|女)(?=$|[^a-zA-Z])/i;
  if (decisive.some((rule) => protectedPattern.test(rule))) throw new Error('protected_attribute_rule');
  const confirmationPattern = /学历|本科|硕士|博士|城市|地区|\d+\s*年(?:经验|以上)/;
  if (decisive.some((rule) => confirmationPattern.test(rule) && !rule.startsWith('[已确认]'))) throw new Error('confirmation_required');
}

export function makeDefaultJobPack(jobId: string, title: string, sourceText: string): JobPack {
  return JobPackSchema.parse({
    job_id: jobId,
    rule_version: 1,
    approval: { status: 'draft', approved_at: null },
    constraints: { hard: [], soft: [], ignore: ['年龄', '性别', '婚育'] },
    industries: { target: [], adjacent: [], excluded: [] },
    companies: { target: [] },
    roles: { exact: title ? [title] : [], synonyms: [], adjacent: [], excluded: [] },
    evidence: { required: [], transferable: [], negative: [] },
    search_plan: title ? [`职位轮：${title}`] : [],
    decision_policy: { labels: ['recommend', 'review', 'exclude'], missing_information: 'review' },
    questions: ['哪些条件可以作为明确排除依据？', '目标公司和相邻行业有哪些？'],
    summary: sourceText.slice(0, 280),
    ideal_candidate: title ? `具有明确${title}相关经历且无硬性反证的人选` : '具有明确目标经历且无硬性反证的人选',
  });
}

export function createDraft(db: DatabaseSync, input: { jobId: string; title: string; sourceText: string; pack?: JobPack }): JobPack {
  const pack = input.pack ? JobPackSchema.parse({...input.pack,job_id:input.jobId,rule_version:1,approval:{status:'draft',approved_at:null}}) : makeDefaultJobPack(input.jobId, input.title, input.sourceText);
  validateRulePolicy(pack);
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO jobs (id,title,source_text,current_rule_version) VALUES (?,?,?,1)')
      .run(input.jobId, input.title, input.sourceText);
    db.prepare('INSERT INTO job_rule_versions (job_id,version,pack_json,status) VALUES (?,?,?,?)')
      .run(input.jobId, 1, JSON.stringify(pack), 'draft');
    db.exec('COMMIT');
    return pack;
  } catch (error) {
    db.exec('ROLLBACK'); throw error;
  }
}

export function getVersion(db: DatabaseSync, jobId: string, version: number): JobPack | null {
  const row = db.prepare('SELECT pack_json FROM job_rule_versions WHERE job_id=? AND version=?').get(jobId, version) as { pack_json: string } | undefined;
  return row ? JobPackSchema.parse(JSON.parse(row.pack_json)) : null;
}

export function getCurrentVersion(db: DatabaseSync, jobId: string): JobPack | null {
  const row = db.prepare('SELECT current_rule_version FROM jobs WHERE id=?').get(jobId) as { current_rule_version: number } | undefined;
  return row ? getVersion(db, jobId, row.current_rule_version) : null;
}

export function reviseDraft(db: DatabaseSync, jobId: string, patch: Partial<JobPack>): JobPack {
  const current = getCurrentVersion(db, jobId);
  if (!current) throw new Error('job_not_found');
  const next = JobPackSchema.parse({
    ...current,
    ...patch,
    job_id: jobId,
    rule_version: current.rule_version + 1,
    approval: { status: 'draft', approved_at: null },
  });
  validateRulePolicy(next);
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO job_rule_versions (job_id,version,pack_json,status) VALUES (?,?,?,?)')
      .run(jobId, next.rule_version, JSON.stringify(next), 'draft');
    db.prepare('UPDATE jobs SET current_rule_version=? WHERE id=?').run(next.rule_version, jobId);
    db.exec('COMMIT'); return next;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function approveVersion(db: DatabaseSync, jobId: string, version: number): JobPack {
  const pack = getVersion(db, jobId, version);
  if (!pack) throw new Error('rule_version_not_found');
  validateRulePolicy(pack);
  const approved = JobPackSchema.parse({ ...pack, approval: { status: 'approved', approved_at: new Date().toISOString() } });
  db.prepare('UPDATE job_rule_versions SET pack_json=?, status=?, approved_at=? WHERE job_id=? AND version=?')
    .run(JSON.stringify(approved), 'approved', approved.approval.approved_at, jobId, version);
  return approved;
}
