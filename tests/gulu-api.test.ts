import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/connection.js'; import { migrate } from '../src/server/db/migrate.js';
import { createApp } from '../src/server/app.js'; import { DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('Gulu connector API',()=>{
 const close:Array<()=>void>=[]; afterEach(()=>close.splice(0).forEach(x=>x()));
 async function setup(){
  const provider=new DeepSeekProvider({apiKey:'test',fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({rounds:[{kind:'company',filters:{companies:['示例科技']}},{kind:'role',filters:{roles:['产品经理']}}]})}}]}),{status:200})});
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
});
