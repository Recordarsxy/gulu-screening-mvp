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
    const strategy=await request(`/api/runs/${task.data.id}/strategy`);expect(strategy.status).toBe(200);expect(strategy.data).toMatchObject({campaign:{id:generated.data.id},task:{id:task.data.id}});expect(strategy.data.steps).toHaveLength(3);
  });
});
