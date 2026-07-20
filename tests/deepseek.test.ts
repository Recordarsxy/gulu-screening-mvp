import { describe, expect, it } from 'vitest';
import { DeepSeekError, DeepSeekProvider } from '../src/server/services/deepseek.js';
import { makeDefaultJobPack } from '../src/server/services/job-pack.js';

describe('DeepSeek provider', () => {
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
});

it('integrates job changes while preserving server-controlled identity and version', async () => {
  let sent:any;
  const provider=new DeepSeekProvider({apiKey:'test',fetcher:async(_url,init)=>{const body=JSON.parse(String(init?.body));sent=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...sent.current_rules,job_id:'wrong',rule_version:99,summary:'更新后'})}}]}),{status:200})}});
  const base={job_id:'job-1',rule_version:1,approval:{status:'approved',approved_at:new Date().toISOString()},constraints:{hard:[],soft:[],ignore:[]},industries:{target:[],adjacent:[],excluded:[]},companies:{target:[]},roles:{exact:['BD'],synonyms:[],adjacent:[],excluded:[]},evidence:{required:[],transferable:[],negative:[]},search_plan:[],decision_policy:{labels:['recommend','review','exclude'] as const,missing_information:'review' as const},questions:[],summary:'原规则',ideal_candidate:''};
  const merged=await (provider as any).integrateJobChanges(base,'原始 JD',['新增要求']);
  expect(merged).toMatchObject({job_id:'job-1',rule_version:1,approval:{status:'draft'},summary:'更新后'});
  expect(sent).toMatchObject({original_source:'原始 JD',changes:['新增要求']});
});
