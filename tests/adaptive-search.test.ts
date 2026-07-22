import {describe,expect,it} from 'vitest';
import {planAdaptiveProbe} from '../src/server/services/adaptive-search.js';
import {searchFingerprint} from '../src/server/services/gulu-campaign.js';
import type {GuluFilters,GuluSearchCampaign} from '../src/shared/contracts.js';

const filters=(overrides:Partial<GuluFilters>={}):GuluFilters=>({keywords:[],companies:[],roles:[],cities:[],industries:[],functions:[],...overrides});
const step=(id:string,order:number,field:keyof GuluFilters,value:string)=>({id,order,type:'manual' as const,title:id,objective:id,rationale:id,expectedSignals:[],limit:15,enabled:true,filters:filters({[field]:[value]}),sources:[{kind:'manual' as const,field,value,reason:id}]});
const now=new Date().toISOString();
const campaign={id:'campaign-1',jobId:'job-1',ruleVersion:1,version:1,status:'confirmed' as const,summary:'adaptive',sourceNotes:'',targetShortlist:5,maxUniqueCandidates:120,maxSteps:8,confirmedAt:now,createdAt:now,updatedAt:now,steps:[step('company',0,'companies','阿里云'),step('role-1',1,'roles','海外销售经理'),step('role-2',2,'roles','国际销售经理'),step('city',3,'cities','上海'),step('industry',4,'industries','SaaS')]} satisfies GuluSearchCampaign;

describe('adaptive AND probe planner',()=>{
  it('switches to the next same-field alternative after an empty seed',()=>{
    const companyStep={...step('company',0,'companies','Alpha Fund'),filters:filters({companies:['Alpha Fund','Beta Fund','Gamma Fund']})};
    const alternativeCampaign={...campaign,steps:[companyStep,...campaign.steps.slice(1)]};
    const current=filters({companies:['Alpha Fund']});
    expect(planAdaptiveProbe({campaign:alternativeCampaign,seedStepId:'company',currentFilters:current,resultCount:0,triedFingerprints:[]})).toMatchObject({
      action:'refine',
      filters:filters({companies:['Beta Fund']}),
      rationale:'empty_combination',
    });
  });
  it('adds the highest-priority unused dimension when a seed is too broad',()=>{
    expect(planAdaptiveProbe({campaign,seedStepId:'company',currentFilters:filters({companies:['阿里云']}),resultCount:374,triedFingerprints:[]})).toMatchObject({action:'refine',filters:filters({companies:['阿里云'],roles:['海外销售经理']})});
  });
  it('allows reading only for a bounded non-empty result set',()=>{
    const current=filters({companies:['阿里云'],roles:['海外销售经理']});
    expect(planAdaptiveProbe({campaign,seedStepId:'company',currentFilters:current,resultCount:42,triedFingerprints:[]})).toMatchObject({action:'read',filters:current});
  });
  it('backs out of an empty combination and tries a different refinement',()=>{
    const current=filters({companies:['阿里云'],roles:['海外销售经理']});
    const decision=planAdaptiveProbe({campaign,seedStepId:'company',currentFilters:current,resultCount:0,triedFingerprints:[searchFingerprint(current)]});
    expect(decision.action).toBe('refine');
    expect(decision.filters.companies).toEqual(['阿里云']);
    expect(searchFingerprint(decision.filters)).not.toBe(searchFingerprint(current));
  });
  it('moves to the next seed when every bounded combination was tried',()=>{
    const seed=filters({companies:['阿里云']});
    const first=planAdaptiveProbe({campaign,seedStepId:'company',currentFilters:seed,resultCount:374,triedFingerprints:[]});
    const all=[seed,first.filters,filters({companies:['阿里云'],roles:['国际销售经理']}),filters({companies:['阿里云'],cities:['上海']}),filters({companies:['阿里云'],industries:['SaaS']}),filters({companies:['阿里云'],roles:['海外销售经理'],cities:['上海']}),filters({companies:['阿里云'],roles:['海外销售经理'],industries:['SaaS']}),filters({companies:['阿里云'],roles:['国际销售经理'],cities:['上海']}),filters({companies:['阿里云'],roles:['国际销售经理'],industries:['SaaS']}),filters({companies:['阿里云'],cities:['上海'],industries:['SaaS']})];
    expect(planAdaptiveProbe({campaign,seedStepId:'company',currentFilters:seed,resultCount:0,triedFingerprints:all.map(searchFingerprint)}).action).toBe('next_step');
  });
});
