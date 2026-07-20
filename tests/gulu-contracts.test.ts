import { describe, expect, it } from 'vitest';
import { GuluCandidateSnapshotSchema, GuluSearchPlanSchema } from '../src/shared/contracts.js';

const plan = { jobId:'job-1', ruleVersion:1, status:'draft', confirmedAt:null, rounds:[
  { kind:'company', limit:50, filters:{ companies:['示例科技'] } },
  { kind:'role', limit:50, filters:{ roles:['产品经理'] } },
] };

describe('Gulu public contracts', () => {
  it('requires company then role and caps each round at 50', () => {
    expect(GuluSearchPlanSchema.parse(plan).rounds.map((round) => round.limit)).toEqual([50,50]);
    expect(() => GuluSearchPlanSchema.parse({ ...plan, rounds:[{...plan.rounds[0],limit:51},plan.rounds[1]] })).toThrow();
    expect(() => GuluSearchPlanSchema.parse({ ...plan, rounds:[plan.rounds[1],plan.rounds[0]] })).toThrow();
  });

  it('rejects forbidden contact and note fields from candidate snapshots', () => {
    const safe = { guluId:'G-1', name:'候选人甲', detailUrl:'http://121.43.105.7/crm#candidate/detail?id=G-1', sourceRound:'company', page:1, capturedAt:new Date().toISOString() };
    expect(GuluCandidateSnapshotSchema.parse(safe).guluId).toBe('G-1');
    for (const forbidden of ['phone','email','wechat','address','photo','notes','attachment']) {
      expect(() => GuluCandidateSnapshotSchema.parse({ ...safe, [forbidden]:'secret' })).toThrow();
    }
  });
});
