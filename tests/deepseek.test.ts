import { describe, expect, it } from 'vitest';
import { DeepSeekError, DeepSeekProvider } from '../src/server/services/deepseek.js';
import { makeDefaultJobPack } from '../src/server/services/job-pack.js';
import { MATCH_POLICY_VERSION } from '../src/server/services/match-policy.js';

describe('DeepSeek provider', () => {
  it('uses Pro thinking-high only for low-frequency strategy work',async()=>{
    let body:any={};
    const fetcher:typeof fetch=async(_url,init)=>{
      body=JSON.parse(String(init?.body??'{}'));
      return new Response(JSON.stringify({model:body.model,choices:[{message:{content:JSON.stringify({
        summary:'Role change',impacts:[{section:'roles.exact',action:'add',values:['Channel Sales'],reason:'New direction'}],questions:[],
      })}}]}),{status:200});
    };
    const provider=new DeepSeekProvider({apiKey:'test',model:'deepseek-v4-flash',fetcher});
    const pack=makeDefaultJobPack('job-strategy','Sales','JD');
    const analysis=await provider.analyzeJobChange(pack,'Add channel sales');
    expect(analysis.model).toBe('deepseek-v4-pro');
    expect(body).toMatchObject({model:'deepseek-v4-pro',thinking:{type:'enabled'},reasoning_effort:'high'});
  });
  it('calculates search fit from evidence-backed dimensions instead of trusting the model total', async () => {
    const dimensions = [
      {id:'core_capability',earned:22,possible:25,confidence:'high',evidence:['负责渠道销售团队'],gaps:['缺少完整团队规模']},
      {id:'market_customer',earned:15,possible:20,confidence:'medium',evidence:['服务企业客户'],gaps:['目标区域未明确']},
      {id:'product_industry',earned:10,possible:15,confidence:'medium',evidence:['科技产品销售'],gaps:['细分赛道待核实']},
      {id:'scope_level',earned:12,possible:15,confidence:'high',evidence:['销售负责人'],gaps:['汇报线待核实']},
      {id:'outcome_evidence',earned:10,possible:15,confidence:'medium',evidence:['完成年度增长目标'],gaps:['缺少具体增幅']},
      {id:'transferable_signals',earned:4,possible:5,confidence:'high',evidence:['从0到1搭建渠道'],gaps:['方法论细节不足']},
      {id:'interview_only',earned:2,possible:5,confidence:'low',evidence:['有跨部门协作描述'],gaps:['动机与薪资需面试确认']},
    ];
    const fetcher:typeof fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({score:99,dimensions,verificationQuestions:['确认团队规模','确认求职动机']})}}],usage:{prompt_tokens:20,completion_tokens:12}}),{status:200});
    const pack=makeDefaultJobPack('job-score','渠道销售','JD');
    const result=await new DeepSeekProvider({apiKey:'test',fetcher}).scoreSearchFit(pack,{currentCompany:'示例科技',currentRole:'渠道销售负责人',experiences:[]});
    expect(result).toMatchObject({score:75,policyVersion:MATCH_POLICY_VERSION,verificationQuestions:['确认团队规模','确认求职动机'],inputTokens:20,outputTokens:12});
    expect(result.evidence).toContain('负责渠道销售团队');
    expect(result.gaps).toContain('动机与薪资需面试确认');
  });

  it('retries once when dimension weights are inconsistent', async () => {
    let attempts=0;
    const valid=[
      {id:'core_capability',earned:20,possible:25,confidence:'high',evidence:['核心能力命中'],gaps:['仍需核实']},
      {id:'market_customer',earned:15,possible:20,confidence:'medium',evidence:['客户匹配'],gaps:['区域待核实']},
      {id:'product_industry',earned:10,possible:15,confidence:'medium',evidence:['行业相邻'],gaps:['产品待核实']},
      {id:'scope_level',earned:10,possible:15,confidence:'medium',evidence:['职级相近'],gaps:['团队待核实']},
      {id:'outcome_evidence',earned:10,possible:15,confidence:'medium',evidence:['业绩证据'],gaps:['数字待核实']},
      {id:'transferable_signals',earned:4,possible:5,confidence:'high',evidence:['能力可迁移'],gaps:['场景待核实']},
      {id:'interview_only',earned:0,possible:5,confidence:'low',evidence:[],gaps:['只能面试确认']},
    ];
    const fetcher:typeof fetch=async()=>{
      attempts+=1;
      const dimensions=attempts===1?[{...valid[0],possible:24},...valid.slice(1)]:valid;
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({dimensions,verificationQuestions:['只能面试确认']})}}]}),{status:200});
    };
    const pack=makeDefaultJobPack('job-retry-score','渠道销售','JD');
    const result=await new DeepSeekProvider({apiKey:'test',fetcher}).scoreSearchFit(pack,{currentCompany:'示例科技',currentRole:'渠道销售',experiences:[]});
    expect(attempts).toBe(2);
    expect(result.score).toBe(69);
  });
  it('generates a structured two-round Gulu plan capped at 50', async () => {
    const fetcher:typeof fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({rounds:[
      {kind:'company',limit:99,filters:{companies:['示例科技']}},
      {kind:'role',limit:80,filters:{roles:['产品经理']}}
    ]})}}]}),{status:200});
    const base=makeDefaultJobPack('job-gulu','产品经理','JD');
    const result=await new DeepSeekProvider({apiKey:'test',fetcher}).generateGuluSearchPlan(base);
    expect(result.data).toMatchObject({jobId:'job-gulu',ruleVersion:1,status:'draft'});
    expect(result.data.rounds.map((round)=>round.limit)).toEqual([50,50]);
  });
  it('requests JSON output with configurable model and parses usage', async () => {
    let body: Record<string, unknown> = {};
    const fetcher: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"label":"review","reasonCode":"MISSING_INFORMATION","evidence":["经历描述不足"]}' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new DeepSeekProvider({ apiKey: 'test-key', model: 'deepseek-v4-flash', fetcher });
    const result = await provider.generateJson<{label:string}>('输出 json', { candidate: { company: '甲公司' } });
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(result.data.label).toBe('review');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
  });

  it('classifies an empty model response as a diagnostic error', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
    const provider = new DeepSeekProvider({ apiKey: 'test-key', fetcher });
    await expect(provider.generateJson('输出 json', {})).rejects.toMatchObject({ code: 'empty_response' });
  });

  it('reports a missing API key without making a request', async () => {
    const provider = new DeepSeekProvider({ apiKey: '', fetcher: async () => { throw new Error('should not fetch'); } });
    const result = await provider.testConnection();
    expect(result).toMatchObject({ ok: false, keyPresent: false, errorType: 'missing_api_key' });
    expect(DeepSeekError).toBeDefined();
  });

  it('rejects an untrusted host before sending the API key', async () => {
    let called = false;
    const provider = new DeepSeekProvider({ apiKey: 'secret', baseUrl: 'https://evil.test', fetcher: async () => { called = true; return new Response(); } });
    await expect(provider.generateJson('输出 json', {})).rejects.toMatchObject({ code: 'untrusted_api_host' });
    expect(called).toBe(false);
  });

  it('never allows AI alone to exclude a candidate', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices:[{message:{content:'{"label":"exclude","reasonCode":"MISSING","evidence":["信息缺失"]}'}}] }), {status:200});
    const provider = new DeepSeekProvider({ apiKey:'test', fetcher });
    const result = await provider.assessCandidate({
      job_id:'j',rule_version:1,approval:{status:'approved',approved_at:'now'},constraints:{hard:[],soft:[],ignore:[]},industries:{target:[],adjacent:[],excluded:[]},companies:{target:[]},roles:{exact:[],synonyms:[],adjacent:[],excluded:[]},evidence:{required:[],transferable:[],negative:[]},search_plan:[],decision_policy:{labels:['recommend','review','exclude'],missing_information:'review'},questions:[],summary:'',ideal_candidate:''
    }, {currentCompany:'甲',currentRole:'销售',experiences:[]});
    expect(result).toMatchObject({label:'review',reasonCode:'AI_EXCLUSION_REQUIRES_RULE_EVIDENCE'});
  });

  it('normalizes a single evidence string returned by DeepSeek', async () => {
    const fetcher:typeof fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"label":"review","reasonCode":"AI_REVIEW","evidence":"需要人工确认"}'}}]}),{status:200});
    const provider=new DeepSeekProvider({apiKey:'test',fetcher});
    const result=await provider.assessCandidate({job_id:'j',rule_version:1,approval:{status:'approved',approved_at:'now'},constraints:{hard:[],soft:[],ignore:[]},industries:{target:[],adjacent:[],excluded:[]},companies:{target:[]},roles:{exact:[],synonyms:[],adjacent:[],excluded:[]},evidence:{required:[],transferable:[],negative:[]},search_plan:[],decision_policy:{labels:['recommend','review','exclude'],missing_information:'review'},questions:[],summary:'',ideal_candidate:''},{currentCompany:'甲',currentRole:'销售',experiences:[]});
    expect(result.evidence).toEqual(['需要人工确认']);
  });

  it('unwraps and safely completes a partial DeepSeek job pack',async()=>{
    const fetcher:typeof fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"job_pack":{"summary":"AI 摘要","search_plan":["公司轮：目标公司"]}}'}}]}),{status:200});
    const base=makeDefaultJobPack('job-ai','销售经理','JD');const pack=await new DeepSeekProvider({apiKey:'test',fetcher}).generateJobPack(base,'JD');
    expect(pack).toMatchObject({job_id:'job-ai',summary:'AI 摘要',search_plan:['公司轮：目标公司'],approval:{status:'draft'}});expect(pack.constraints).toEqual(base.constraints);
  });

  it('retries a length-truncated job pack once with a larger token budget',async()=>{
    const budgets:number[]=[];let attempts=0;
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));budgets.push(body.max_tokens);attempts+=1;
      if(attempts===1)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"job_pack":{"summary":"被截断"'}}]}),{status:200});
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"job_pack":{"summary":"完整岗位包","search_plan":["公司轮：目标公司","职位轮：海外销售经理"]}}'}}]}),{status:200});
    };
    const base=makeDefaultJobPack('job-retry','海外销售经理','真实客户要求');
    const pack=await new DeepSeekProvider({apiKey:'test',fetcher}).generateJobPack(base,'真实客户要求');
    expect(pack.summary).toBe('完整岗位包');
    expect(attempts).toBe(2);
    expect(budgets).toEqual([4000,7000]);
  });

  it('retries an unchanged template instead of accepting an empty AI job pack',async()=>{
    const budgets:number[]=[];const payloads:Array<Record<string,unknown>>=[];let attempts=0;
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));budgets.push(body.max_tokens);const payload=JSON.parse(body.messages[1].content);payloads.push(payload);attempts+=1;
      const content=attempts===1?payload.template:{...payload.template,summary:'Meshy 海外销售经理',companies:{target:['阿里云']},search_plan:['公司轮：阿里云','职位轮：海外销售经理']};
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}),{status:200});
    };
    const base=makeDefaultJobPack('job-empty-retry','海外销售经理','Meshy 客户要求');
    const pack=await new DeepSeekProvider({apiKey:'test',fetcher}).generateJobPack(base,'Meshy 客户要求');
    expect(pack).toMatchObject({summary:'Meshy 海外销售经理',companies:{target:['阿里云']}});
    expect(attempts).toBe(2);
    expect(budgets).toEqual([4000,7000]);
    expect(payloads[1]).toMatchObject({retry_reason:'上一次输出没有形成有效岗位规则，请根据 source_text 实质填写 template，不得原样返回。'});
  });

  it('does not retry a non-truncation job-pack failure',async()=>{
    let attempts=0;
    const fetcher:typeof fetch=async()=>{attempts+=1;return new Response('{"error":"upstream"}',{status:500})};
    const base=makeDefaultJobPack('job-no-retry','海外销售经理','真实客户要求');
    await expect(new DeepSeekProvider({apiKey:'test',fetcher}).generateJobPack(base,'真实客户要求')).rejects.toMatchObject({code:'api_error'});
    expect(attempts).toBe(1);
  });
});

it('integrates job changes while preserving server-controlled identity and version', async () => {
  let sent:any;
  const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body));sent=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...sent.current_rules,job_id:'wrong',rule_version:99,summary:'更新后'})}}]}),{status:200})}});
  const base={job_id:'job-1',rule_version:1,approval:{status:'approved',approved_at:new Date().toISOString()},constraints:{hard:[],soft:[],ignore:[]},industries:{target:[],adjacent:[],excluded:[]},companies:{target:[]},roles:{exact:['BD'],synonyms:[],adjacent:[],excluded:[]},evidence:{required:[],transferable:[],negative:[]},search_plan:[],decision_policy:{labels:['recommend','review','exclude'] as const,missing_information:'review' as const},questions:[],summary:'原规则',ideal_candidate:''};
  const merged=await (provider as any).integrateJobChanges(base,'原始 JD',['新增要求']);
  expect(merged).toMatchObject({job_id:'job-1',rule_version:1,approval:{status:'draft'},summary:'更新后'});
  expect(sent).toMatchObject({original_source:'原始 JD',changes:['新增要求']});
});
