import type { DatabaseSync } from 'node:sqlite';
import { AssessmentSchema, CandidateSchema, type Assessment, type CandidateInput } from '../../shared/contracts.js';

type NewJob = { id: string; title: string; sourceText: string; sourceHash?: string; sourcePath?: string };

export function createRepositories(db: DatabaseSync) {
  return {
    jobs: {
      create(job: NewJob) {
        db.prepare('INSERT INTO jobs (id,title,source_text,source_hash,source_path) VALUES (?,?,?,?,?)')
          .run(job.id, job.title, job.sourceText, job.sourceHash ?? null, job.sourcePath ?? null);
        return job;
      },
      delete(id: string) { return db.prepare('DELETE FROM jobs WHERE id=?').run(id); },
    },
    candidates: {
      upsert(input: CandidateInput) {
        const c = CandidateSchema.parse(input);
        db.prepare(`INSERT INTO candidates
          (id,job_id,dedupe_key,name,gulu_id,detail_url,current_company,current_role,experiences_json,source_round)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(job_id,dedupe_key) DO UPDATE SET
          current_company=excluded.current_company,current_role=excluded.current_role,experiences_json=excluded.experiences_json`)
          .run(c.id,c.jobId,c.dedupeKey,c.name,c.guluId ?? null,c.detailUrl ?? null,c.currentCompany,c.currentRole,JSON.stringify(c.experiences),c.sourceRound);
        return c;
      },
    },
    assessments: {
      create(input: Assessment) {
        const a = AssessmentSchema.parse(input);
        db.prepare(`INSERT INTO assessments
          (id,job_id,candidate_id,rule_version,label,reason_code,evidence_json,model,input_tokens,output_tokens)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(a.id,a.jobId,a.candidateId,a.ruleVersion,a.label,a.reasonCode,JSON.stringify(a.evidence),a.model,a.inputTokens,a.outputTokens);
        return a;
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
