import {afterEach,describe,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {openDatabase} from '../src/server/db/connection.js';
import {migrate} from '../src/server/db/migrate.js';
import {createApp} from '../src/server/app.js';
import {DeepSeekProvider} from '../src/server/services/deepseek.js';
import {makeDefaultJobPack} from '../src/server/services/job-pack.js';

describe('colleague Gulu plan import',()=>{
  const close:Array<()=>void>=[];afterEach(()=>close.splice(0).forEach((fn)=>fn()));

  it('sends colleague notes to DeepSeek and preserves them on the draft',async()=>{
    let payload:any;const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body));payload=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({rounds:[{kind:'company',filters:{companies:['Qupital']}},{kind:'role',filters:{roles:['Relationship Manager']}}]})}}]}),{status:200})}});
    const base=makeDefaultJobPack('job-plan','BD','JD');const notes='Company round: Qupital; role round: Relationship Manager';
    const result=await (provider as any).generateGuluSearchPlan(base,notes);
    expect(result.data).toMatchObject({sourceNotes:notes,rounds:[{filters:{companies:['Qupital']}},{filters:{roles:['Relationship Manager']}}]});
    expect(payload.source_notes).toBe(notes);
  });

  it('imports natural language and returns confirmed edits to a new draft version',async()=>{
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body));const payload=JSON.parse(body.messages[1].content);const content=payload.template??{rounds:[{kind:'company',filters:{companies:['Qupital']}},{kind:'role',filters:{roles:['Relationship Manager']}}]};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200})}});
    const db=openDatabase(':memory:');migrate(db);const http=createApp({db,dataRoot:process.cwd(),deepSeek:provider}).listen(0,'127.0.0.1');await new Promise<void>((resolve)=>http.once('listening',resolve));close.push(()=>{http.close();db.close()});const port=(http.address() as AddressInfo).port;
    const request=async(path:string,init:RequestInit={})=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{...init,headers:{'content-type':'application/json',...init.headers}});return {status:response.status,data:await response.json() as any}};
    const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'Product Manager',sourceText:'Find a product manager'})});const jobId=created.data.job_id;
    await request(`/api/jobs/${jobId}/rules/1/approve`,{method:'POST'});const sourceNotes='Company round: Qupital; role round: Relationship Manager';
    const imported=await request(`/api/jobs/${jobId}/gulu-plan/import`,{method:'POST',body:JSON.stringify({sourceNotes})});
    expect(imported.data).toMatchObject({status:'draft',sourceNotes,version:1});
    const confirmed=await request(`/api/jobs/${jobId}/gulu-plan/confirm`,{method:'PUT',body:JSON.stringify(imported.data)});
    const rounds=structuredClone(confirmed.data.rounds);rounds[1].filters.roles.push('Senior Product Manager');
    const edited=await request(`/api/jobs/${jobId}/gulu-plan`,{method:'PUT',body:JSON.stringify({...confirmed.data,rounds})});
    expect(edited.data).toMatchObject({status:'draft',version:2,rollout:{dryRunCompleted:false,pilotCompleted:false}});
  });
});
