import { describe, expect, it } from 'vitest';
import { makeDefaultJobPack } from '../src/server/services/job-pack.js';
import { buildCacheKey, classifyDeterministically, deduplicateCandidates } from '../src/server/services/screening.js';
import { demoCompanyRound, demoRoleRound } from '../src/server/demo/candidates.js';

describe('screening rules', () => {
  it('deduplicates the same person across company and role rounds', () => {
    const unique = deduplicateCandidates([demoCompanyRound, demoRoleRound]);
    expect(unique.length).toBeLessThan(demoCompanyRound.length + demoRoleRound.length);
    expect(new Set(unique.map((c) => c.dedupeKey)).size).toBe(unique.length);
  });

  it('excludes only explicit negative evidence', () => {
    const pack = makeDefaultJobPack('job-1', '销售经理', '制造业大客户');
    pack.evidence.negative = ['仅零售门店销售'];
    const assessment = classifyDeterministically(pack, demoRoleRound.find((c) => c.id === 'demo-8')!);
    expect(assessment).toMatchObject({ label: 'exclude', reasonCode: 'EXPLICIT_NEGATIVE' });
  });

  it('routes missing information to review instead of exclusion', () => {
    const pack = makeDefaultJobPack('job-1', '销售经理', '制造业大客户');
    pack.evidence.required = ['大型制造企业客户拓展'];
    const assessment = classifyDeterministically(pack, demoRoleRound.find((c) => c.id === 'demo-6')!);
    expect(assessment).toMatchObject({ label: 'review', reasonCode: 'MISSING_INFORMATION' });
  });

  it('builds a stable cache key from rule and resume content', () => {
    expect(buildCacheKey({ a: 1 }, { b: 2 })).toBe(buildCacheKey({ a: 1 }, { b: 2 }));
    expect(buildCacheKey({ a: 1 }, { b: 2 })).not.toBe(buildCacheKey({ a: 2 }, { b: 2 }));
  });
});
