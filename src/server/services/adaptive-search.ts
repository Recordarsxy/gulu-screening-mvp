import type {GuluFilters,GuluSearchCampaign} from '../../shared/contracts.js';
import {searchFingerprint} from './gulu-campaign.js';

const fields:Array<keyof GuluFilters>=['roles','companies','cities','industries','functions','keywords'];
const emptyFilters=():GuluFilters=>({keywords:[],companies:[],roles:[],cities:[],industries:[],functions:[]});
const dimensions=(filters:GuluFilters)=>fields.filter(field=>filters[field].length>0).length;
const includesFilters=(candidate:GuluFilters,current:GuluFilters)=>fields.every(field=>current[field].every(value=>candidate[field].includes(value)));

export function atomicSearchFilters(filters:GuluFilters):GuluFilters{
  return Object.fromEntries(Object.entries(filters).map(([field,values])=>[field,values.slice(0,1)])) as GuluFilters;
}

export type AdaptiveProbeDecision={action:'read'|'refine'|'next_step';filters:GuluFilters;rationale:'bounded_result_set'|'result_set_too_large'|'empty_combination'|'combinations_exhausted'};
export type AdaptiveProbeInput={campaign:GuluSearchCampaign;seedStepId:string;currentFilters:GuluFilters;resultCount:number;triedFingerprints:string[]};

function enumerateCombinations(campaign:GuluSearchCampaign,seedStepId:string):GuluFilters[]{
  const seed=campaign.steps.find(step=>step.id===seedStepId);
  if(!seed)throw new Error('campaign_seed_not_found');
  const base=atomicSearchFilters(seed.filters);
  const options:Array<{field:keyof GuluFilters;value:string}>=[];
  for(const field of fields)for(const step of [...campaign.steps].sort((a,b)=>a.order-b.order))for(const value of step.filters[field]){
    const clean=value.trim();if(!clean||base[field].includes(clean)||options.some(item=>item.field===field&&item.value===clean))continue;options.push({field,value:clean});
  }
  const output:GuluFilters[]=[base];
  for(const option of options){const next={...emptyFilters(),...structuredClone(base)};next[option.field]=[option.value];output.push(next)}
  for(let left=0;left<options.length;left+=1)for(let right=left+1;right<options.length;right+=1){const first=options[left],second=options[right];if(first.field===second.field)continue;const next={...emptyFilters(),...structuredClone(base)};next[first.field]=[first.value];next[second.field]=[second.value];if(dimensions(next)<=3)output.push(next)}
  return [...new Map(output.map(filters=>[searchFingerprint(filters),filters])).values()];
}

export function planAdaptiveProbe(input:AdaptiveProbeInput):AdaptiveProbeDecision{
  if(!Number.isInteger(input.resultCount)||input.resultCount<0)throw new Error('invalid_probe_count');
  if(input.resultCount>=1&&input.resultCount<=100)return{action:'read',filters:input.currentFilters,rationale:'bounded_result_set'};
  const tried=new Set([...input.triedFingerprints,searchFingerprint(input.currentFilters)]);
  const available=enumerateCombinations(input.campaign,input.seedStepId).filter(filters=>!tried.has(searchFingerprint(filters)));
  const next=input.resultCount>100
    ? available.find(filters=>dimensions(filters)>dimensions(input.currentFilters)&&includesFilters(filters,input.currentFilters))
    : available.find(filters=>dimensions(filters)===dimensions(input.currentFilters)&&!includesFilters(filters,input.currentFilters))??available[0];
  if(next)return{action:'refine',filters:next,rationale:input.resultCount>100?'result_set_too_large':'empty_combination'};
  return{action:'next_step',filters:input.currentFilters,rationale:'combinations_exhausted'};
}
