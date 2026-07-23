import {GuluMatchDimensionSchema,type GuluMatchDimension} from '../../shared/contracts.js';

export const MATCH_POLICY_VERSION='general-v1';
export const MatchDimensionScoreSchema=GuluMatchDimensionSchema;

export function calculateSearchFit(input:unknown[]):number{
  const dimensions=input.map(value=>MatchDimensionScoreSchema.parse(value));
  const possible=dimensions.reduce((sum,item)=>sum+item.possible,0);
  if(possible!==100)throw new Error('match_weights_must_total_100');
  return dimensions.reduce((sum,item)=>sum+item.earned,0);
}

export type MatchDimensionScore=GuluMatchDimension;
