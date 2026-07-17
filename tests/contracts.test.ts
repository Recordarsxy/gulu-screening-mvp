import { describe, expect, it } from 'vitest';
import { JobPackSchema } from '../src/shared/contracts.js';

describe('JobPackSchema', () => {
  it('rejects a job pack without a decision policy', () => {
    const result = JobPackSchema.safeParse({
      job_id: 'job-1', rule_version: 1,
      approval: { status: 'draft', approved_at: null },
      constraints: { hard: [], soft: [], ignore: [] },
      industries: { target: [], adjacent: [], excluded: [] },
      companies: { target: [] },
      roles: { exact: [], synonyms: [], adjacent: [], excluded: [] },
      evidence: { required: [], transferable: [], negative: [] },
      search_plan: [], questions: [], summary: '', ideal_candidate: '',
    });
    expect(result.success).toBe(false);
  });
});
