import {afterEach,describe,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openDatabase} from '../src/server/db/connection.js';import {migrate} from '../src/server/db/migrate.js';import {createApp} from '../src/server/app.js';
import {approveVersion,createDraft} from '../src/server/services/job-pack.js';import {DeepSeekProvider} from '../src/server/services/deepseek.js';

const filters=(value:Record<string,string[]>)=>({keywords:[],companies:[],roles:[],cities:[],industries:[],functions:[],...value});
describe('adaptive campaign API',()=>{
  const cleanups:Array<()=>Promise<void>|void>=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});
  it('generates, confirms and starts a campaign without legacy rollout gates',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gulu-v13-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));const db=openDatabase(':memory:');cleanups.push(()=>db.close());migrate(db);
    const pack=createDraft(db,{jobId:'job-1',title:'海外销售',sourceText:'JD'});pack.roles.synonyms=['国际销售经理'];db.prepare('UPDATE job_rule_versions SET pack_json=? WHERE job_id=? AND version=1').run(JSON.stringify(pack),'job-1');approveVersion(db,'job-1',1);
    const ai=new DeepSeekProvider({apiKey:'test',fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'多方向海外销售搜索',targetShortlist:7,steps:[
      {type:'seed_company',title:'技术公司',objective:'公司人才池',rationale:'相关公司',limit:20,filters:filters({companies:['阿里云','火山引擎']})},
      {type:'role_cluster',title:'职位组合',objective:'同义职位',rationale:'批准职位',limit:20,filters:filters({roles:['国际销售经理']})},
      {type:'market_cluster',title:'市场组合',objective:'行业市场',rationale:'相关市场',limit:20,filters:filters({keywords:['海外B2B销售']})},
    ]})}}],usage:{prompt_tokens:1,completion_tokens:1},model:'deepseek-test'}),{status:200})});
    const http=createApp({db,dataRoot:root,deepSeek:ai}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>http.once('listening',resolve));cleanups.push(()=>{http.close()});const port=(http.address() as AddressInfo).port;
    const request=async(path:string,init:RequestInit={})=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{...init,headers:{'content-type':'application/json',...init.headers}});return{status:response.status,data:await response.json() as any}};
    const generated=await request('/api/jobs/job-1/gulu-campaigns/generate',{method:'POST',body:JSON.stringify({sourceNotes:'同事建议技术平台公司'})});expect(generated.status,JSON.stringify(generated.data)).toBe(200);
    expect(generated.data).toMatchObject({jobId:'job-1',status:'draft',targetShortlist:7});
    generated.data.targetShortlist=6;expect((await request(`/api/jobs/job-1/gulu-campaigns/${generated.data.id}`,{method:'PUT',body:JSON.stringify(generated.data)})).status).toBe(200);
    const confirmed=await request(`/api/jobs/job-1/gulu-campaigns/${generated.data.id}/confirm`,{method:'PUT',body:JSON.stringify(generated.data)});expect(confirmed.status).toBe(200);expect(confirmed.data.status).toBe('confirmed');
    const task=await request('/api/jobs/job-1/runs/gulu',{method:'POST',body:JSON.stringify({campaignId:generated.data.id,fresh:true})});expect(task.status).toBe(201);expect(task.data).toMatchObject({campaignId:generated.data.id,phase:'preflight',currentStepId:confirmed.data.steps[0].id});
    const strategy=await request(`/api/runs/${task.data.id}/strategy`);expect(strategy.status).toBe(200);expect(strategy.data).toMatchObject({campaign:{id:generated.data.id},task:{id:task.data.id}});expect(strategy.data.steps).toHaveLength(confirmed.data.steps.length);
    const pairing=await request('/api/connectors/gulu/pairing',{method:'POST'});const redeemed=await request('/api/connector/gulu/pairing/redeem',{method:'POST',body:JSON.stringify({code:pairing.data.code,extensionVersion:'1.3.0'})});
    const auth={authorization:`Bearer ${redeemed.data.token}`};const probed=await request(`/api/connector/gulu/tasks/${task.data.id}/events`,{method:'POST',headers:auth,body:JSON.stringify({eventId:'probe-1',type:'step_probed',stepId:task.data.currentStepId,resultCount:374,filters:confirmed.data.steps[0].filters})});expect(probed.status).toBe(200);expect(probed.data).toMatchObject({action:'refine',resultCount:374,step:{filters:{roles:expect.any(Array)}}});
    const bounded=await request(`/api/connector/gulu/tasks/${task.data.id}/events`,{method:'POST',headers:auth,body:JSON.stringify({eventId:'probe-2',type:'step_probed',stepId:task.data.currentStepId,resultCount:40,filters:probed.data.step.filters})});expect(bounded.data.action).toBe('read');await request(`/api/connector/gulu/tasks/${task.data.id}/events`,{method:'POST',headers:auth,body:JSON.stringify({eventId:'start-1',type:'step_started',stepId:task.data.currentStepId})});const calibrated=await request(`/api/connector/gulu/tasks/${task.data.id}/events`,{method:'POST',headers:auth,body:JSON.stringify({eventId:'calibrate-1',type:'step_calibrated',stepId:task.data.currentStepId,exhausted:false})});expect(calibrated.status).toBe(200);expect(calibrated.data).toMatchObject({currentStepId:task.data.currentStepId,phase:'search'});
  });
  it('returns only candidates whose current-task search fit is at least 70',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gulu-high-fit-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));const db=openDatabase(':memory:');cleanups.push(()=>db.close());migrate(db);
    createDraft(db,{jobId:'job-fit',title:'Sales leader',sourceText:'JD'});approveVersion(db,'job-fit',1);
    db.prepare("INSERT INTO gulu_search_campaigns(id,job_id,version,rule_version,status,campaign_json) VALUES (?,?,?,?,?,?)").run('campaign-fit','job-fit',1,1,'confirmed','{}');
    db.prepare("INSERT INTO gulu_tasks(id,job_id,rule_version,status,mode,plan_json,campaign_id,campaign_version) VALUES (?,?,?,?,?,?,?,?)").run('task-fit','job-fit',1,'completed','formal','{}','campaign-fit',1);
    for(const [id,name,score,label] of [['too-low','Too Low',54,'review'],['verify-low','Verification Low',55,'review'],['low','Low Fit',69,'review'],['high','High Fit',70,'review'],['excluded','Excluded High Fit',90,'exclude']] as const){
      db.prepare("INSERT INTO candidates(id,job_id,dedupe_key,name,gulu_id,detail_url,current_company,current_role,experiences_json) VALUES (?,?,?,?,?,?,?,?,?)").run(id,'job-fit',`dedupe-${id}`,name,`G-${id}`,`http://121.43.105.7/crm#candidate/detail?id=G-${id}`,'Company','Role','[]');
      db.prepare("INSERT INTO assessments(id,job_id,candidate_id,rule_version,label,reason_code,evidence_json,model) VALUES (?,?,?,?,?,?,?,?)").run(`assessment-${id}`,'job-fit',id,1,label,'NEEDS_REVIEW','[]','deepseek-v4-flash');
      db.prepare("INSERT INTO gulu_task_candidates(task_id,candidate_id) VALUES (?,?)").run('task-fit',id);
      db.prepare("INSERT INTO gulu_search_fits(task_id,candidate_id,step_id,score,evidence_json,gaps_json,verification_questions_json,policy_version,model) VALUES (?,?,?,?,?,?,?,?,?)").run('task-fit',id,'step-1',score,'["命中证据"]','["信息缺口"]','["待确认问题"]','general-v1','deepseek-v4-flash');
    }
    const ai=new DeepSeekProvider({apiKey:'test'});const http=createApp({db,dataRoot:root,deepSeek:ai}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>http.once('listening',resolve));cleanups.push(()=>{http.close()});const port=(http.address() as AddressInfo).port;
    const response=await fetch(`http://127.0.0.1:${port}/api/jobs/job-fit/results?runId=task-fit`);const body=await response.json() as {items:Array<{name:string;searchFit:number}>};
    expect(body.items).toEqual([expect.objectContaining({name:'High Fit',searchFit:70})]);
    const verificationResponse=await fetch(`http://127.0.0.1:${port}/api/jobs/job-fit/results?runId=task-fit&bucket=verification`);
    const verification=await verificationResponse.json() as {items:Array<{name:string;searchFit:number;guluUrl:string;verificationQuestions:string[]}>};
    expect(verification.items).toEqual([
      expect.objectContaining({name:'Low Fit',searchFit:69,guluUrl:'http://121.43.105.7/crm#candidate/detail?id=G-low',verificationQuestions:['待确认问题']}),
      expect.objectContaining({name:'Verification Low',searchFit:55}),
    ]);
    expect((db.prepare("SELECT COUNT(*) count FROM gulu_search_fits WHERE task_id='task-fit'").get() as {count:number}).count).toBe(5);
  });
});
