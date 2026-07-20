import {afterEach,describe,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import type {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/server/db/connection.js';
import {migrate} from '../src/server/db/migrate.js';
import {createApp} from '../src/server/app.js';
import {DeepSeekProvider} from '../src/server/services/deepseek.js';

describe('recoverable job archive API',()=>{
  const close:Array<()=>void>=[];
  afterEach(()=>close.splice(0).forEach(fn=>fn()));

  async function setup(){
    const db=openDatabase(':memory:');migrate(db);
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body??'{}'));const payload=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload.template)}}]}),{status:200})}});
    const http=createApp({db,dataRoot:process.cwd(),deepSeek:provider}).listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>http.once('listening',resolve));close.push(()=>{http.close();db.close()});
    const port=(http.address() as AddressInfo).port;
    const request=async(path:string,init?:RequestInit)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{...init,headers:{'content-type':'application/json',...init?.headers}});const text=await response.text();let data:any=null;try{data=text?JSON.parse(text):null}catch{data={raw:text}}return {status:response.status,data}};
    return {db,request};
  }

  async function create(request:(path:string,init?:RequestInit)=>Promise<{status:number;data:any}>,title:string){
    const response=await request('/api/jobs',{method:'POST',body:JSON.stringify({title,sourceText:`${title} JD`})});
    expect(response.status).toBe(201);return String(response.data.job_id);
  }

  it('archives without deleting related data and restores the job',async()=>{
    const {db,request}=await setup();const jobId=await create(request,'岗位一');
    db.prepare(`INSERT INTO candidates(id,job_id,dedupe_key,name,current_company,current_role,experiences_json) VALUES (?,?,?,?,?,?,?)`).run('candidate-1',jobId,'dedupe-1','候选人','公司','职位','[]');
    expect((await request(`/api/jobs/${jobId}/archive`,{method:'POST'}))).toMatchObject({status:200,data:{id:jobId,archivedAt:expect.any(String)}});
    expect(db.prepare('SELECT count(*) count FROM job_rule_versions WHERE job_id=?').get(jobId)).toEqual({count:1});
    expect(db.prepare('SELECT count(*) count FROM candidates WHERE job_id=?').get(jobId)).toEqual({count:1});
    expect((await request('/api/jobs')).data.items).toHaveLength(0);
    expect((await request('/api/jobs?archived=true')).data.items).toEqual([expect.objectContaining({id:jobId,archived_at:expect.any(String)})]);
    expect((await request(`/api/jobs/${jobId}/restore`,{method:'POST'}))).toMatchObject({status:200,data:{id:jobId,archivedAt:null}});
    expect((await request('/api/jobs')).data.items).toEqual([expect.objectContaining({id:jobId})]);
  });

  it('rejects archiving while the job has an active Gulu task',async()=>{
    const {db,request}=await setup();const jobId=await create(request,'岗位二');
    db.prepare(`INSERT INTO gulu_tasks(id,job_id,rule_version,status,mode) VALUES (?,?,?,?,?)`).run('active-task',jobId,1,'paused','dry-run');
    expect(await request(`/api/jobs/${jobId}/archive`,{method:'POST'})).toMatchObject({status:409,data:{error:'job_has_active_task'}});
    expect((db.prepare('SELECT archived_at FROM jobs WHERE id=?').get(jobId) as {archived_at:null}).archived_at).toBeNull();
  });
});
