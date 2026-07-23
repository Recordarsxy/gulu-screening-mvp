import {describe,expect,it} from 'vitest';
import {MATCH_POLICY_VERSION,MatchDimensionScoreSchema,calculateSearchFit} from '../src/server/services/match-policy.js';

const dimension=(overrides:Record<string,unknown>={})=>({
  id:'core_capability',earned:15,possible:20,confidence:'medium',
  evidence:['有直接岗位经验'],gaps:['复杂场景仍需确认'],...overrides,
});

describe('generalized recruiting match policy',()=>{
  it('calculates the search fit from validated dimension points',()=>{
    const dimensions=[
      dimension({id:'core',earned:20,possible:25,gaps:['高级复杂度待确认']}),
      dimension({id:'market',earned:15,possible:20}),
      dimension({id:'product',earned:10,possible:15}),
      dimension({id:'scope',earned:10,possible:15}),
      dimension({id:'outcomes',earned:10,possible:15}),
      dimension({id:'transferable',earned:5,possible:5,gaps:[]}),
      dimension({id:'interview_only',earned:0,possible:5,evidence:[],gaps:['面试验证工具熟练度']}),
    ];
    expect(MATCH_POLICY_VERSION).toBe('general-v1');
    expect(calculateSearchFit(dimensions)).toBe(70);
  });

  it('rejects positive points without evidence',()=>{
    expect(()=>MatchDimensionScoreSchema.parse(dimension({earned:5,evidence:[]}))).toThrow('positive_score_requires_evidence');
  });

  it('rejects incomplete dimensions without a gap',()=>{
    expect(()=>MatchDimensionScoreSchema.parse(dimension({earned:10,possible:20,gaps:[]}))).toThrow('incomplete_dimension_requires_gap');
  });

  it('requires configured weights to total 100',()=>{
    expect(()=>calculateSearchFit([dimension({possible:20})])).toThrow('match_weights_must_total_100');
  });
});
