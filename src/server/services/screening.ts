import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Assessment, Candidate, JobPack } from '../../shared/contracts.js';
import { getCurrentVersion, getVersion } from './job-pack.js';
import { sanitizeCandidate } from './redaction.js';
import type { DeepSeekProvider } from './deepseek.js';

export type Decision = Pick<Assessment, 'label' | 'reasonCode' | 'evidence' | 'model' | 'inputTokens' | 'outputTokens'>;

export function deduplicateCandidates(rounds: Candidate[][]): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const candidate of rounds.flat()) {
    const key = candidate.guluId || candidate.detailUrl || candidate.dedupeKey;
    if (seen.has(key)) continue;
    seen.add(key); result.push(candidate);
  }
  return result;
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

function candidateText(candidate: Candidate): string {
  return normalize([candidate.currentCompany,candidate.currentRole,...candidate.experiences.flatMap((e) => [e.company,e.role,e.period,e.summary])].join(' '));
}

export function classifyDeterministically(pack: JobPack, candidate: Candidate): Decision {
  const text = candidateText(candidate);
  const negative = [...pack.evidence.negative, ...pack.roles.excluded, ...pack.industries.excluded].find((rule) => rule && text.includes(normalize(rule)));
  if (negative) return { label: 'exclude', reasonCode: 'EXPLICIT_NEGATIVE', evidence: [`明确反证：${negative}`], model: 'rules', inputTokens: 0, outputTokens: 0 };
  const positive = [...pack.evidence.required, ...pack.constraints.hard].find((rule) => rule && text.includes(normalize(rule)));
  if (positive) return { label: 'recommend', reasonCode: 'TARGET_EVIDENCE', evidence: [`目标证据：${positive}`], model: 'rules', inputTokens: 0, outputTokens: 0 };
  const role = [...pack.roles.exact, ...pack.roles.synonyms].find((rule) => rule && text.includes(normalize(rule)));
  if (role && pack.evidence.required.length === 0 && pack.constraints.hard.length === 0) {
    return { label: 'recommend', reasonCode: 'ROLE_MATCH', evidence: [`职位匹配：${role}`], model: 'rules', inputTokens: 0, outputTokens: 0 };
  }
  return { label: 'review', reasonCode: 'MISSING_INFORMATION', evidence: ['现有信息不足以确认全部目标证据'], model: 'rules', inputTokens: 0, outputTokens: 0 };
}

export function buildCacheKey(rule: unknown, resume: unknown): string {
  return createHash('sha256').update(JSON.stringify(rule)).update('\0').update(JSON.stringify(resume)).digest('hex');
}

export type RunRecord = { id: string; jobId: string; ruleVersion: number; status: 'running'|'paused'|'completed'|'failed'; cursor: number; total: number; inputTokens: number; outputTokens: number };

export class ScreeningEngine {
  constructor(private readonly db: DatabaseSync, private readonly ai?: DeepSeekProvider) {}

  startRun(jobId: string, rounds: Candidate[][]): RunRecord {
    const pack = getCurrentVersion(this.db, jobId);
    if (!pack) throw new Error('job_not_found');
    if (pack.approval.status !== 'approved') throw new Error('rules_not_approved');
    const inputs = deduplicateCandidates(rounds).map((candidate) => ({ ...candidate, jobId, id: `${jobId}:${candidate.id}` }));
    const id = randomUUID();
    this.db.prepare(`INSERT INTO runs (id,job_id,rule_version,status,cursor,total,input_json) VALUES (?,?,?,?,?,?,?)`)
      .run(id, jobId, pack.rule_version, 'running', 0, inputs.length, JSON.stringify(inputs));
    return this.getRun(id);
  }

  getRun(id: string): RunRecord {
    const row = this.db.prepare('SELECT id,job_id,rule_version,status,cursor,total,input_tokens,output_tokens FROM runs WHERE id=?').get(id) as Record<string, string|number> | undefined;
    if (!row) throw new Error('run_not_found');
    return { id: String(row.id), jobId: String(row.job_id), ruleVersion: Number(row.rule_version), status: row.status as RunRecord['status'], cursor: Number(row.cursor), total: Number(row.total), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens) };
  }

  pauseRun(id: string): RunRecord {
    this.db.prepare("UPDATE runs SET status='paused' WHERE id=? AND status='running'").run(id);
    return this.getRun(id);
  }

  resumeRun(id: string): RunRecord {
    this.db.prepare("UPDATE runs SET status='running' WHERE id=? AND status='paused'").run(id);
    return this.getRun(id);
  }

  async processNext(id: string): Promise<RunRecord> {
    const run = this.getRun(id);
    if (run.status !== 'running') return run;
    if (run.cursor >= run.total) {
      this.db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(id); return this.getRun(id);
    }
    const stored = this.db.prepare('SELECT input_json FROM runs WHERE id=?').get(id) as { input_json: string };
    const inputs = JSON.parse(stored.input_json) as Candidate[];
    const candidate = inputs[run.cursor];
    const pack = getVersion(this.db, run.jobId, run.ruleVersion);
    if (!pack) throw new Error('rule_version_unavailable');
    this.db.prepare(`INSERT INTO candidates
      (id,job_id,dedupe_key,name,gulu_id,detail_url,current_company,current_role,experiences_json,source_round,resume_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id,dedupe_key) DO NOTHING`)
      .run(candidate.id,candidate.jobId,candidate.dedupeKey,candidate.name,candidate.guluId ?? null,candidate.detailUrl ?? null,candidate.currentCompany,candidate.currentRole,JSON.stringify(candidate.experiences),candidate.sourceRound,buildCacheKey({},candidate.experiences));
    const canonical = this.db.prepare('SELECT id FROM candidates WHERE job_id=? AND dedupe_key=?').get(run.jobId,candidate.dedupeKey) as {id:string};
    const candidateId = canonical.id;
    const existing = this.db.prepare('SELECT id FROM assessments WHERE candidate_id=? AND rule_version=?').get(candidateId, run.ruleVersion);
    if (!existing) {
      let decision = classifyDeterministically(pack, candidate);
      if (decision.label === 'review' && this.ai?.isConfigured()) {
        try { decision = await this.ai.assessCandidate(pack, sanitizeCandidate(candidate)); }
        catch { decision = { label:'review', reasonCode:'AI_FALLBACK_REVIEW', evidence:['AI 分析不可用，已安全转人工复核'], model:'fallback', inputTokens:0, outputTokens:0 }; }
      }
      this.db.prepare(`INSERT INTO assessments
        (id,job_id,candidate_id,rule_version,label,reason_code,evidence_json,model,input_tokens,output_tokens)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),run.jobId,candidateId,run.ruleVersion,decision.label,decision.reasonCode,JSON.stringify(decision.evidence),decision.model,decision.inputTokens,decision.outputTokens);
      this.db.prepare('UPDATE runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE id=?').run(decision.inputTokens,decision.outputTokens,id);
    }
    if (this.getRun(id).status !== 'running') return this.getRun(id);
    const nextCursor = run.cursor + 1;
    this.db.prepare('UPDATE runs SET cursor=?, status=? WHERE id=?').run(nextCursor, nextCursor >= run.total ? 'completed' : 'running', id);
    return this.getRun(id);
  }

  async processAll(id: string): Promise<RunRecord> {
    let run = this.getRun(id);
    while (run.status === 'running') run = await this.processNext(id);
    return run;
  }
}
