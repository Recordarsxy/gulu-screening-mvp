import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { createApp } from '../src/server/app.js';
import { DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('local MVP API', () => {
  const closers: Array<() => void> = [];
  afterEach(() => closers.splice(0).forEach((close) => close()));

  async function server(deepSeek?:DeepSeekProvider,jobPackTimeoutMs?:number) {
    const db = openDatabase(':memory:'); migrate(db);
    const configured=deepSeek??new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body??'{}'));const payload=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...payload.template,summary:'AI 已分析',search_plan:[...payload.template.search_plan,'公司轮：示例科技']})}}]}),{status:200})}});
    const app = createApp({ db, dataRoot: process.cwd(),deepSeek:configured,jobPackTimeoutMs });
    const http = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => http.once('listening', resolve));
    closers.push(() => { http.close(); db.close(); });
    const port = (http.address() as AddressInfo).port;
    return async (path: string, init?: RequestInit) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
      const text = await response.text();
      return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
    };
  }

  it('runs the complete approved demo workflow', async () => {
    const request = await server();
    expect((await request('/api/health')).data).toMatchObject({ ok: true, host: '127.0.0.1' });
    const created = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ title: '制造业销售经理', sourceText: '寻找具备大型制造企业客户拓展经历的销售经理' }) });
    expect(created.status).toBe(201); const jobId = created.data.job_id;
    const blocked = await request(`/api/jobs/${jobId}/runs/demo`, { method: 'POST' });
    expect(blocked.status).toBe(409);
    const revised = await request(`/api/jobs/${jobId}/rules`, { method: 'PUT', body: JSON.stringify({
      evidence: { ...created.data.evidence, required: ['大型制造企业客户拓展'], negative: ['仅零售门店销售'] },
    }) });
    expect(revised.data.rule_version).toBe(2);
    expect((await request(`/api/jobs/${jobId}/rules/2/approve`, { method: 'POST' })).status).toBe(200);
    const run = await request(`/api/jobs/${jobId}/runs/demo`, { method: 'POST' });
    expect(run.status).toBe(201); expect(run.data.status).toBe('running');
    expect((await request(`/api/runs/${run.data.id}/pause`, { method:'POST' })).data.status).toBe('paused');
    expect((await request(`/api/runs/${run.data.id}/resume`, { method:'POST' })).data.status).toBe('running');
    let progress = run.data;
    while (progress.status === 'running') progress = (await request(`/api/runs/${run.data.id}/process`, { method:'POST',body:JSON.stringify({limit:3}) })).data;
    expect(progress.status).toBe('completed');
    const results = await request(`/api/jobs/${jobId}/results`);
    expect(results.data.items.length).toBe(10);
    expect(new Set(results.data.items.map((item: {label:string}) => item.label))).toEqual(new Set(['recommend','review','exclude']));
    const candidateId = results.data.items[0].candidateId;
    await request(`/api/jobs/${jobId}/rules`, { method:'PUT',body:JSON.stringify({summary:'后续草稿'}) });
    const reviewed=await request(`/api/jobs/${jobId}/reviews/${encodeURIComponent(candidateId)}`, { method: 'PUT', body: JSON.stringify({ ruleVersion:2,status: '已复核', note: '人工确认' }) });
    expect(reviewed.status).toBe(200);expect(reviewed.data.ruleVersion).toBe(2);
  });

  it('rejects a human review for a candidate from another job', async () => {
    const request = await server();
    const one = await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'岗位一',sourceText:'JD'})});
    await request(`/api/jobs/${one.data.job_id}/rules/1/approve`,{method:'POST'});
    const run = await request(`/api/jobs/${one.data.job_id}/runs/demo`,{method:'POST'});
    await request(`/api/runs/${run.data.id}/process`,{method:'POST',body:JSON.stringify({limit:50})});
    const candidate = (await request(`/api/jobs/${one.data.job_id}/results`)).data.items[0].candidateId;
    const two = await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'岗位二',sourceText:'JD'})});
    expect((await request(`/api/jobs/${two.data.job_id}/reviews/${encodeURIComponent(candidate)}`,{method:'PUT',body:JSON.stringify({status:'已复核'})})).status).toBe(404);
  });

  it('returns only assessments from the current rule version',async()=>{
    const request=await server();
    const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'Versioned role',sourceText:'JD'})});
    const jobId=created.data.job_id;
    await request(`/api/jobs/${jobId}/rules/1/approve`,{method:'POST'});
    const first=await request(`/api/jobs/${jobId}/runs/demo`,{method:'POST'});
    await request(`/api/runs/${first.data.id}/process`,{method:'POST',body:JSON.stringify({limit:50})});
    const revised=await request(`/api/jobs/${jobId}/rules`,{method:'PUT',body:JSON.stringify({summary:'Version two'})});
    await request(`/api/jobs/${jobId}/rules/${revised.data.rule_version}/approve`,{method:'POST'});
    const second=await request(`/api/jobs/${jobId}/runs/demo`,{method:'POST'});
    await request(`/api/runs/${second.data.id}/process`,{method:'POST',body:JSON.stringify({limit:50})});

    const results=await request(`/api/jobs/${jobId}/results`);
    expect(results.data.items).toHaveLength(10);
    expect(new Set(results.data.items.map((item:{ruleVersion:number})=>item.ruleVersion))).toEqual(new Set([2]));
  });

  it('reports missing DeepSeek key without exposing a secret', async () => {
    const request = await server();
    const result = await request('/api/settings/test-deepseek', { method: 'POST', body: '{}' });
    expect(result.data).toMatchObject({ ok: false, keyPresent: false, errorType: 'missing_api_key' });
    expect(JSON.stringify(result.data)).not.toContain('apiKey');
  });

  it('uses DeepSeek to generate the v1 job pack when configured', async () => {
    let sent='';const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{sent=String(init?.body);const request=JSON.parse(sent);const payload=JSON.parse(request.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...payload.template,summary:'DeepSeek 已分析',search_plan:['公司轮：目标公司','职位轮：销售经理']})}}]}),{status:200})}});
    const request=await server(provider);const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'销售经理',sourceText:'制造业客户，电话 +86 138-1234-5678，微信: hiring_01'})});
    expect(created.status).toBe(201);expect(created.data.summary).toBe('DeepSeek 已分析');expect(created.data.search_plan).toHaveLength(2);
    expect(sent).not.toContain('138-1234-5678');expect(sent).not.toContain('hiring_01');
  });

  it('downgrades unconfirmed AI hard filters before persisting a reviewable draft',async()=>{
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{
      const request=JSON.parse(String(init?.body??'{}'));const payload=JSON.parse(request.messages[1].content);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...payload.template,summary:'Meshy 海外销售经理规则',companies:{target:['阿里云']},constraints:{hard:['3年以上海外 B2B 销售经验','城市限北京、上海、深圳','年龄 35 岁以下','vibe coding 能力'],soft:[],ignore:[]},evidence:{...payload.template.evidence,required:['本科以上']}})}}]}),{status:200});
    }});
    const request=await server(provider);
    const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'Meshy AI 海外销售经理',sourceText:'3 年以上经验；地点北京、上海、深圳；年龄待确认，不得硬筛'})});
    expect(created.status).toBe(201);
    expect(created.data.constraints.hard).toEqual(['vibe coding 能力']);
    expect(created.data.constraints.soft).toEqual(expect.arrayContaining(['3年以上海外 B2B 销售经验','城市限北京、上海、深圳','本科以上']));
    expect(created.data.constraints.ignore).toContain('年龄 35 岁以下');
    expect(created.data.questions).toEqual(expect.arrayContaining(['请人工确认是否将“3年以上海外 B2B 销售经验”设为硬筛条件','请人工确认是否将“城市限北京、上海、深圳”设为硬筛条件']));
  });

  it('does not create a job when DeepSeek job generation exceeds its deadline',async()=>{
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{await new Promise(resolve=>setTimeout(resolve,80));const body=JSON.parse(String(init?.body??'{}'));const payload=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload.template)}}]}),{status:200})}});
    const request=await server(provider,10);
    const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'Timeout role',sourceText:'Account manager'})});
    expect(created).toMatchObject({status:503,data:{error:'job_pack_generation_timeout'}});
    expect((await request('/api/jobs')).data.items).toHaveLength(0);
  });

  it('does not create a job when DeepSeek returns an invalid response',async()=>{
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async()=>new Response('{"error":"upstream"}',{status:500})});
    const request=await server(provider,100);
    const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'Failed role',sourceText:'Account manager'})});
    expect(created).toMatchObject({status:503,data:{error:'job_pack_generation_failed'}});
    expect((await request('/api/jobs')).data.items).toHaveLength(0);
  });

  it('stores job changes and integrates them into a new draft version', async () => {
    let mergePayload:any=null;
    const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{
      const request=JSON.parse(String(init?.body??'{}'));const payload=JSON.parse(request.messages[1].content);
      if(payload.change_text)return new Response(JSON.stringify({model:'deepseek-v4-pro',choices:[{message:{content:JSON.stringify({
        summary:'Add cross-border supply-chain finance experience',
        impacts:[{section:'constraints.soft',action:'add',values:['cross-border supply-chain finance'],reason:'New preferred experience'}],
        questions:['Is this preferred or mandatory?'],
      })}}]}),{status:200});
      if(payload.current_rules){mergePayload=payload;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...payload.current_rules,summary:'已整合最新变化'})}}]}),{status:200});}
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...payload.template,summary:'AI 初始分析',search_plan:[...payload.template.search_plan,'公司轮：示例科技']})}}]}),{status:200});
    }});
    const request=await server(provider);
    const created=await request('/api/jobs',{method:'POST',body:JSON.stringify({title:'供应链金融 BD',sourceText:'原始要求：负责大中华区客户拓展'})});
    const jobId=created.data.job_id;await request(`/api/jobs/${jobId}/rules/1/approve`,{method:'POST'});
    const change=await request(`/api/jobs/${jobId}/changes`,{method:'POST',body:JSON.stringify({text:'新增要求：优先跨境供应链金融经验'})});
    expect(change.status).toBe(201);
    expect(change.data.analysis).toMatchObject({
      summary:'Add cross-border supply-chain finance experience',
      impacts:[{section:'constraints.soft',action:'add',values:['cross-border supply-chain finance']}],
      model:'deepseek-v4-pro',
    });
    const integrated=await request(`/api/jobs/${jobId}/changes/integrate`,{method:'POST',body:JSON.stringify({changeIds:[change.data.id]})});
    expect(integrated.data).toMatchObject({rule_version:2,approval:{status:'draft'},summary:'已整合最新变化'});
    const history=await request(`/api/jobs/${jobId}/changes`);
    expect(history.data.items[0]).toMatchObject({text:'新增要求：优先跨境供应链金融经验',appliedRuleVersion:2,analysis:change.data.analysis});
    expect(mergePayload.changes[0]).toMatchObject({text:'新增要求：优先跨境供应链金融经验',analysis:{summary:'Add cross-border supply-chain finance experience'}});
  });
});
