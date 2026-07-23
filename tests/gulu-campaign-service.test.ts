import {afterEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../src/server/db/connection.js';
import {migrate} from '../src/server/db/migrate.js';
import {approveVersion,createDraft} from '../src/server/services/job-pack.js';
import {GuluService} from '../src/server/services/gulu.js';

const filters=(overrides:Record<string,string[]>={})=>({keywords:[],companies:[],roles:[],cities:[],industries:[],functions:[],...overrides});
const draft={id:'campaign-1',jobId:'job-1',ruleVersion:1,version:1,status:'draft' as const,summary:'多方向搜索',targetShortlist:5,maxUniqueCandidates:60,maxSteps:4,sourceNotes:'',steps:[
  {id:'company-seed',order:0,type:'seed_company' as const,title:'种子公司',objective:'验证公司人才池',rationale:'精准起步',expectedSignals:['销售'],limit:20,enabled:true,filters:filters({companies:['阿里云']}),sources:[{kind:'deepseek' as const,field:'companies' as const,value:'阿里云',reason:'技术销售人才池'}]},
  {id:'role-cluster',order:1,type:'role_cluster' as const,title:'职位组合',objective:'扩大职位表达',rationale:'覆盖同义职位',expectedSignals:['海外销售'],limit:20,enabled:true,filters:filters({roles:['海外销售经理']}),sources:[{kind:'approved_rule' as const,field:'roles' as const,value:'海外销售经理',reason:'批准职位'}]},
]};

describe('Gulu campaign service',()=>{
  const dbs:Array<{close():void}>=[];afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
  const setup=()=>{const db=openDatabase(':memory:');dbs.push(db);migrate(db);createDraft(db,{jobId:'job-1',title:'海外销售',sourceText:'JD'});approveVersion(db,'job-1',1);return{db,service:new GuluService(db)}};
  it('confirms a campaign and starts directly in automatic preflight',()=>{
    const {service}=setup();service.saveCampaign(draft);const confirmed=service.confirmCampaign('job-1','campaign-1',draft);const task=service.startCampaignTask('job-1',confirmed.id);
    expect(task).toMatchObject({campaignId:'campaign-1',campaignVersion:1,phase:'preflight',currentStepIndex:0,currentStepId:'company-seed',shortlistedCount:0,completionReason:null});
    expect(service.getTaskSteps(task.id)).toEqual([expect.objectContaining({stepId:'company-seed',status:'pending'}),expect.objectContaining({stepId:'role-cluster',status:'pending'})]);
  });
  it('stores one atomic value per filter field when a campaign step has alternatives',()=>{
    const {service}=setup();
    const multiCompany={...draft,steps:[{...draft.steps[0],filters:filters({companies:['Alpha Fund','Beta Fund','Gamma Fund']})},draft.steps[1]]};
    service.saveCampaign(multiCompany);service.confirmCampaign('job-1','campaign-1',multiCompany);
    const task=service.startCampaignTask('job-1','campaign-1');
    expect(service.getCurrentCampaignStep(task.id)?.filters.companies).toEqual(['Alpha Fund']);
  });
  it('persists step progress, search fit and an exhausted completion reason',()=>{
    const {db,service}=setup();service.saveCampaign(draft);service.confirmCampaign('job-1','campaign-1',draft);let task=service.startCampaignTask('job-1','campaign-1');
    service.startStep(task.id,'company-seed');db.prepare(`INSERT INTO candidates(id,job_id,dedupe_key,name,current_company,current_role,experiences_json) VALUES (?,?,?,?,?,?,?)`).run('candidate-1','job-1','c-1','候选人','示例公司','海外销售','[]');service.recordSearchFit(task.id,'candidate-1','company-seed',{score:82,evidence:['海外销售'],gaps:[],model:'deepseek',inputTokens:1,outputTokens:1});
    expect(service.getTask(task.id)).toMatchObject({shortlistedCount:1,phase:'calibration'});
    task=service.completeStep(task.id,'company-seed',false);expect(task).toMatchObject({currentStepIndex:1,currentStepId:'role-cluster'});
    task=service.completeStep(task.id,'role-cluster',true);expect(task).toMatchObject({status:'completed',phase:'completed',completionReason:'search_exhausted'});
  });
  it('appends only a sourced company expansion within campaign limits',()=>{
    const {service}=setup();service.saveCampaign(draft);service.confirmCampaign('job-1','campaign-1',draft);const task=service.startCampaignTask('job-1','campaign-1');
    const step=service.appendCompanyStep(task.id,{name:'火山引擎',source:'candidate_company',reason:'高匹配候选过往公司'});
    expect(step).toMatchObject({type:'company_expansion',filters:{companies:['火山引擎']}});expect(service.getTaskSteps(task.id)).toHaveLength(3);
  });
  it('moves from preflight to calibration and filters candidates seen in any step',()=>{
    const {db,service}=setup();service.saveCampaign(draft);service.confirmCampaign('job-1','campaign-1',draft);const task=service.startCampaignTask('job-1','campaign-1');
    expect(service.completePreflight(task.id)).toMatchObject({phase:'calibration',status:'running'});service.startStep(task.id,'company-seed');
    db.prepare(`INSERT INTO gulu_snapshots(task_id,dedupe_key,content_hash,snapshot_json,first_round) VALUES (?,?,?,?,?)`).run(task.id,'G-1','hash-1','{}','company-seed');
    expect(service.filterUnseen(task.id,['G-1','G-2','G-2'])).toEqual(['G-2']);
    service.updateCheckpoint(task.id,{page:2,candidateCursor:3});expect(service.getTaskSteps(task.id)[0]).toMatchObject({page:2,candidateCursor:3});
  });
  it('persists broad, bounded and empty adaptive probe decisions',()=>{
    const {service}=setup();service.saveCampaign(draft);service.confirmCampaign('job-1','campaign-1',draft);const task=service.startCampaignTask('job-1','campaign-1');service.completePreflight(task.id);
    const broad=service.recordStepProbe(task.id,'company-seed',374);expect(broad).toMatchObject({action:'refine',resultCount:374,step:{filters:{companies:['阿里云'],roles:['海外销售']}}});
    const bounded=service.recordStepProbe(task.id,'company-seed',42);expect(bounded).toMatchObject({action:'read',resultCount:42});
    const empty=service.recordStepProbe(task.id,'company-seed',0);expect(empty.action).toBe('next_step');expect(empty.task).toMatchObject({currentStepId:'role-cluster'});
    expect(service.getTaskStrategy(task.id).decisions.filter((item:any)=>item.action==='probe')).toHaveLength(3);
  });
  it('marks an unavailable taxonomy value as tried and continues adapting',()=>{
    const {service}=setup();const taxonomyDraft={...draft,steps:[{...draft.steps[0],filters:filters({industries:['3D打印']})},draft.steps[1]]};service.saveCampaign(taxonomyDraft);service.confirmCampaign('job-1','campaign-1',taxonomyDraft);const task=service.startCampaignTask('job-1','campaign-1');service.completePreflight(task.id);
    const next=service.recordFilterUnavailable(task.id,'company-seed','industries','3D打印');expect(next.action).toBe('refine');
    expect(service.getTaskStrategy(task.id).decisions.at(-1)).toMatchObject({action:'probe',metrics:{resultCount:null,unavailableFilter:{field:'industries',value:'3D打印'}},rationale:expect.stringContaining('filter_unavailable'),patch:{testedFilters:taxonomyDraft.steps[0].filters}});
    expect(()=>service.recordFilterUnavailable(task.id,'company-seed','industries','不在当前步骤')).toThrow('invalid_filter_unavailable');
  });
  it('redacts sensitive spillover before persisting a candidate snapshot',()=>{
    const {db,service}=setup();service.saveCampaign(draft);service.confirmCampaign('job-1','campaign-1',draft);const task=service.startCampaignTask('job-1','campaign-1');service.recordCandidate(task.id,'candidate-sensitive',{guluId:'G-SAFE',name:'候选人',detailUrl:'http://121.43.105.7/crm#candidate/detail?id=G-SAFE',company:'甲公司',role:'海外销售',experiences:[{company:'甲公司',role:'海外销售',period:'2020-至今',summary:'电话 15900849376，WebChat abc_123，地址：上海市浦东新区。'}],education:[],tags:[],sourceRound:'campaign',sourceStepId:'company-seed',page:1,capturedAt:new Date().toISOString()});const stored=String((db.prepare('SELECT snapshot_json FROM gulu_snapshots WHERE task_id=?').get(task.id) as {snapshot_json:string}).snapshot_json);for(const value of ['15900849376','abc_123','上海市浦东新区'])expect(stored).not.toContain(value);
  });
});
