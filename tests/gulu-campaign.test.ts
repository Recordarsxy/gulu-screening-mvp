import {afterEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../src/server/db/connection.js';
import {migrate} from '../src/server/db/migrate.js';
import {GuluSearchCampaignSchema,GuluSearchFitSchema} from '../src/shared/contracts.js';
import {lintCampaign,searchFingerprint} from '../src/server/services/gulu-campaign.js';

const filters=(overrides:Record<string,string[]>={})=>({keywords:[],companies:[],roles:[],cities:[],industries:[],functions:[],...overrides});
const campaign={id:'campaign-1',jobId:'job-1',ruleVersion:1,version:1,status:'draft' as const,summary:'分层搜索',targetShortlist:10,maxUniqueCandidates:150,maxSteps:8,sourceNotes:'',steps:[
  {id:'step-1',order:0,type:'seed_company' as const,title:'目标公司',objective:'验证种子公司',rationale:'优先精准公司',expectedSignals:['海外销售'],limit:20,enabled:true,filters:filters({companies:['阿里云']}),sources:[{kind:'deepseek' as const,field:'companies' as const,value:'阿里云',reason:'技术产品销售人才池'}]},
  {id:'step-2',order:1,type:'role_cluster' as const,title:'职位组合',objective:'覆盖批准职位',rationale:'扩大职位表达',expectedSignals:['B2B销售'],limit:30,enabled:true,filters:filters({roles:['海外销售经理','国际销售经理']}),sources:[{kind:'approved_rule' as const,field:'roles' as const,value:'海外销售经理',reason:'批准职位'}]},
]};

describe('adaptive Gulu search campaigns',()=>{
  const dbs:Array<{close():void}>=[];afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
  it('parses a variable campaign and search fit',()=>{
    expect(GuluSearchCampaignSchema.parse(campaign).steps).toHaveLength(2);
    expect(GuluSearchFitSchema.parse({score:82,evidence:['海外B2B销售'],gaps:['业绩待核实'],model:'deepseek-test',inputTokens:10,outputTokens:5}).score).toBe(82);
  });
  it('rejects empty, duplicate and over-budget enabled steps',()=>{
    expect(()=>lintCampaign({...campaign,steps:[{...campaign.steps[0],filters:filters()}]})).toThrowError('campaign_step_empty');
    expect(()=>lintCampaign({...campaign,steps:[campaign.steps[0],{...campaign.steps[0],id:'copy',order:1}]})).toThrowError('campaign_step_duplicate');
    expect(()=>lintCampaign({...campaign,maxUniqueCandidates:40,steps:[{...campaign.steps[0],limit:30},{...campaign.steps[1],limit:30}]})).toThrowError('campaign_budget_exceeded');
  });
  it('creates stable fingerprints independent of label order and whitespace',()=>{
    expect(searchFingerprint(filters({roles:[' 国际销售经理 ','海外销售经理']}))).toBe(searchFingerprint(filters({roles:['海外销售经理','国际销售经理']})));
  });
  it('migrates campaign persistence and adaptive execution tables',()=>{
    const db=openDatabase(':memory:');dbs.push(db);migrate(db);
    const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(row=>row.name);
    expect(tables).toEqual(expect.arrayContaining(['gulu_search_campaigns','gulu_task_steps','gulu_search_fits','gulu_strategy_decisions']));
    const columns=(db.prepare('PRAGMA table_info(gulu_tasks)').all() as Array<{name:string}>).map(row=>row.name);
    expect(columns).toEqual(expect.arrayContaining(['campaign_id','campaign_version','phase','current_step_index','shortlisted_count','completion_reason']));
  });
});
