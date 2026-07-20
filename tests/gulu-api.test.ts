import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/connection.js'; import { migrate } from '../src/server/db/migrate.js';
import { createApp } from '../src/server/app.js'; import { DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('Gulu connector API',()=>{
 const close:Array<()=>void>=[]; afterEach(()=>close.splice(0).forEach(x=>x()));
 async function setup(onAssessment?:()=>Promise<void>){
  const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body??'{}'));const assessment=String(body.messages?.[0]?.content??'').includes('招聘筛选助手');if(assessment)await onAssessment?.();const content=assessment?{label:'review',reasonCode:'NEEDS_REVIEW',evidence:['测试证据']}:{rounds:[{kind:'company',filters:{companies:['示例科技']}},{kind:'role',filters:{roles:['产品经理']}}]};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200})}});
  const db=openDatabase(':memory:');migrate(db);const http=createApp({db,dataRoot:process.cwd(),deepSeek:provider}).listen(0,'127.0.0.1');await new Promise<void>(r=>http.once('listening',r));close.push(()=>{http.close();db.close()});const port=(http.address() as AddressInfo).port;
  return async(path:string,init:RequestInit={})=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{...init,headers:{'content-type':'application/json',...init.headers}});const data=await response.json();return {status:response.status,data}};
 }
 it('requires confirmation and connector bearer auth',async()=>{
  const request=await setup();const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'产品经理',sourceText:'目标公司产品经理'})});const jobId=created.data.job_id;
  await request(`/api/jobs/${jobId}/rules/1/approve`,{method:'POST'});
  const draft=await request(`/api/jobs/${jobId}/gulu-plan/generate`,{method:'POST'});expect(draft.data.status).toBe('draft');
  expect((await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST'})).status).toBe(409);
  await request(`/api/jobs/${jobId}/gulu-plan/confirm`,{method:'PUT',body:JSON.stringify(draft.data)});
  const task=await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST'});expect(task.status).toBe(201);
 expect((await request('/api/connector/gulu/tasks/next')).status).toBe(401);
  const pairing=await request('/api/connectors/gulu/pairing',{method:'POST'});const redeemed=await request('/api/connector/gulu/pairing/redeem',{method:'POST',body:JSON.stringify({code:pairing.data.code,extensionVersion:'1.1.0'})});
  const next=await request('/api/connector/gulu/tasks/next',{headers:{authorization:`Bearer ${redeemed.data.token}`}});expect(next.data.task.id).toBe(task.data.id);expect(JSON.stringify(next.data)).not.toContain(redeemed.data.token);
 });

 it('coalesces concurrent retries for the same candidate event',async()=>{
  let assessments=0;const request=await setup(async()=>{assessments+=1;await new Promise(r=>setTimeout(r,40))});
  const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'产品经理',sourceText:'目标公司产品经理'})});const jobId=created.data.job_id;
  await request(`/api/jobs/${jobId}/rules/1/approve`,{method:'POST'});const draft=await request(`/api/jobs/${jobId}/gulu-plan/generate`,{method:'POST'});await request(`/api/jobs/${jobId}/gulu-plan/confirm`,{method:'PUT',body:JSON.stringify(draft.data)});const task=await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST'});
  const pairing=await request('/api/connectors/gulu/pairing',{method:'POST'});const redeemed=await request('/api/connector/gulu/pairing/redeem',{method:'POST',body:JSON.stringify({code:pairing.data.code,extensionVersion:'1.1.0'})});const headers={authorization:`Bearer ${redeemed.data.token}`};
  const body=JSON.stringify({eventId:'candidate:stable',type:'candidate',snapshot:{guluId:'SYN-1',name:'候选人甲',detailUrl:'http://121.43.105.7/crm#candidate/detail?id=SYN-1',company:'示例科技',role:'待核实职位',sourceRound:'company',page:1,capturedAt:new Date().toISOString()}});
  const [first,second]=await Promise.all([request(`/api/connector/gulu/tasks/${task.data.id}/events`,{method:'POST',headers,body}),request(`/api/connector/gulu/tasks/${task.data.id}/events`,{method:'POST',headers,body})]);
  expect([first.status,second.status]).toEqual([200,200]);expect(assessments).toBe(1);
 });

 it('starts a fresh formal task and keeps task-scoped result history',async()=>{
  const request=await setup();
  const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'Fresh role',sourceText:'Find account managers'})});const jobId=created.data.job_id;
  await request(`/api/jobs/${jobId}/rules/1/approve`,{method:'POST'});
  const draft=await request(`/api/jobs/${jobId}/gulu-plan/generate`,{method:'POST'});await request(`/api/jobs/${jobId}/gulu-plan/confirm`,{method:'PUT',body:JSON.stringify(draft.data)});
  const pairing=await request('/api/connectors/gulu/pairing',{method:'POST'});const redeemed=await request('/api/connector/gulu/pairing/redeem',{method:'POST',body:JSON.stringify({code:pairing.data.code,extensionVersion:'1.2.0'})});const headers={authorization:`Bearer ${redeemed.data.token}`};
  const candidate=(guluId:string,name:string)=>({eventId:`candidate:${guluId}`,type:'candidate',snapshot:{guluId,name,detailUrl:`http://121.43.105.7/crm#candidate/detail?id=${guluId}`,company:'Example',role:'Manager',sourceRound:'company',page:1,capturedAt:new Date().toISOString()}});
  const complete=async(taskId:string)=>request(`/api/connector/gulu/tasks/${taskId}/events`,{method:'POST',headers,body:JSON.stringify({eventId:`completed:${taskId}`,type:'completed'})});
  const dry=await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST',body:JSON.stringify({mode:'dry-run'})});
  await request(`/api/connector/gulu/tasks/${dry.data.id}/events`,{method:'POST',headers,body:JSON.stringify(candidate('OLD-1','Old Candidate'))});await complete(dry.data.id);
  const pilot=await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST',body:JSON.stringify({mode:'pilot'})});await complete(pilot.data.id);
  expect((await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST',body:JSON.stringify({mode:'formal',fresh:'yes'})})).status).toBe(400);
  const formal=await request(`/api/jobs/${jobId}/runs/gulu`,{method:'POST',body:JSON.stringify({mode:'formal',fresh:true})});
  expect(formal.status).toBe(201);expect(formal.data).toMatchObject({mode:'formal',page:1,candidateCursor:0,readCount:0,analyzedCount:0,currentRound:'company'});
  await request(`/api/connector/gulu/tasks/${formal.data.id}/events`,{method:'POST',headers,body:JSON.stringify(candidate('NEW-1','New Candidate'))});
  const history=await request(`/api/jobs/${jobId}/runs/gulu`);expect(history.data.items.map((task:{id:string})=>task.id)).toEqual([formal.data.id,pilot.data.id,dry.data.id]);expect(history.data.items[0].createdAt).toBeTruthy();
  const current=await request(`/api/jobs/${jobId}/results?runId=${formal.data.id}`);expect(current.data.items.map((item:{name:string})=>item.name)).toEqual(['New Candidate']);
  const all=await request(`/api/jobs/${jobId}/results`);expect(new Set(all.data.items.map((item:{name:string})=>item.name))).toEqual(new Set(['Old Candidate','New Candidate']));
 });
});
