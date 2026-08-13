import type { DatabaseSync } from 'node:sqlite';
import { JobPackSchema, type JobPack } from '../../shared/contracts.js';

export const DEMO_JOB_ID = 'demo-industrial-sales-director';
export const DEMO_TITLE = '工业自动化大客户销售总监（演示）';
export const DEMO_SOURCE = `虚构演示数据
某工业自动化企业希望招聘一名大客户销售总监，负责制造业企业客户拓展、复杂项目推进和团队协作。
重点观察大型制造企业客户拓展、投标和可量化业绩。仅有零售门店销售经历属于明确反证。`;

function fixedPack(): JobPack {
  return JobPackSchema.parse({
    job_id: DEMO_JOB_ID,
    rule_version: 1,
    approval: { status: 'approved', approved_at: new Date().toISOString() },
    constraints: { hard: [], soft: ['具备复杂项目推进或投标经验'], ignore: ['年龄', '性别', '婚育'] },
    industries: { target: ['工业自动化', '装备制造'], adjacent: ['企业软件', '工业咨询'], excluded: [] },
    companies: { target: ['启明制造', '远航工业', '宏达机械'] },
    roles: { exact: ['大客户销售总监'], synonyms: ['行业销售经理', '区域销售经理'], adjacent: ['商务经理', '增长顾问'], excluded: [] },
    evidence: {
      required: ['大型制造企业客户拓展'],
      transferable: ['企业级解决方案销售', '投标', '团队管理'],
      negative: ['仅零售门店销售'],
    },
    search_plan: ['公司轮：工业自动化与装备制造目标公司', '职位轮：大客户销售及相邻岗位'],
    decision_policy: { labels: ['recommend', 'review', 'exclude'], missing_information: 'review' },
    questions: ['候选人的业绩规模是否有证据支持？', '相邻行业经验是否可迁移？'],
    summary: '虚构演示数据：工业自动化大客户销售总监固定案例。',
    ideal_candidate: '拥有制造业企业客户拓展、复杂销售项目和可核验成果证据。',
  });
}

function insertFixedJob(db: DatabaseSync): void {
  const pack = fixedPack();
  db.prepare('INSERT INTO jobs(id,title,source_text,current_rule_version) VALUES (?,?,?,1)')
    .run(DEMO_JOB_ID, DEMO_TITLE, DEMO_SOURCE);
  db.prepare('INSERT INTO job_rule_versions(job_id,version,pack_json,status,approved_at) VALUES (?,?,?,?,?)')
    .run(DEMO_JOB_ID, 1, JSON.stringify(pack), 'approved', pack.approval.approved_at);
}

export function ensureDemoData(db: DatabaseSync): void {
  const existing = db.prepare('SELECT 1 ok FROM jobs WHERE id=?').get(DEMO_JOB_ID);
  if (existing) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    insertFixedJob(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function resetDemoData(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM jobs').run();
    db.prepare('DELETE FROM gulu_taxonomy_syncs').run();
    db.prepare('DELETE FROM gulu_taxonomy_values').run();
    db.prepare(`UPDATE gulu_connector SET pairing_code_hash=NULL,pairing_expires_at=NULL,token_hash=NULL,
      paired_at=NULL,last_seen_at=NULL,extension_version=NULL,gulu_status='unpaired',last_error=NULL WHERE singleton=1`).run();
    insertFixedJob(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getDemoStatus(db: DatabaseSync): { initialized: boolean; jobId: string; fictional: true } {
  return {
    initialized: Boolean(db.prepare('SELECT 1 ok FROM jobs WHERE id=?').get(DEMO_JOB_ID)),
    jobId: DEMO_JOB_ID,
    fictional: true,
  };
}
