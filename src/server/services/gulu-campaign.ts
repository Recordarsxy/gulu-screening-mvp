import {GuluSearchCampaignSchema,type GuluFilters,type GuluSearchCampaign} from '../../shared/contracts.js';

const keys:Array<keyof GuluFilters>=['keywords','companies','roles','cities','industries','functions'];
const normalize=(value:string)=>value.trim().toLocaleLowerCase();

export function searchFingerprint(filters:GuluFilters):string {
  return keys.map(key=>`${key}:${[...filters[key]].map(normalize).filter(Boolean).sort().join('|')}`).join(';');
}

export function lintCampaign(input:unknown):GuluSearchCampaign {
  const campaign=GuluSearchCampaignSchema.parse(input);const enabled=campaign.steps.filter(step=>step.enabled);
  const seen=new Set<string>();let budget=0;
  for(const step of enabled){
    const fingerprint=searchFingerprint(step.filters);
    if(!keys.some(key=>step.filters[key].some(value=>value.trim())))throw new Error('campaign_step_empty');
    if(seen.has(fingerprint))throw new Error('campaign_step_duplicate');seen.add(fingerprint);budget+=step.limit;
  }
  if(budget>campaign.maxUniqueCandidates)throw new Error('campaign_budget_exceeded');
  if(enabled.length>campaign.maxSteps)throw new Error('campaign_step_limit');
  return campaign;
}
