import { assertNoSensitiveText } from './redaction.js';
import { z } from 'zod';
import { GuluSearchPlanSchema, JobPackSchema, type GuluSearchPlan, type JobPack } from '../../shared/contracts.js';
import { normalizeAiDraftRules } from './job-pack.js';
import type { SafeCandidate } from './redaction.js';

export type DeepSeekUsage = { inputTokens: number; outputTokens: number };
export type DeepSeekResult<T> = { data: T; usage: DeepSeekUsage; model: string };
export type ConnectionResult = { ok: boolean; keyPresent: boolean; latencyMs: number; model: string; inputTokens: number; outputTokens: number; errorType?: string };

export class DeepSeekError extends Error {
  constructor(public readonly code: string, message = code, public readonly status?: number) { super(message); }
}

type Options = { apiKey?: string; baseUrl?: string; model?: string; fetcher?: typeof fetch };
const differs=(left:unknown,right:unknown)=>JSON.stringify(left)!==JSON.stringify(right);

function assertMaterialJobPack(base:JobPack,pack:JobPack):void {
  const signals=[
    pack.summary!==base.summary,
    pack.ideal_candidate!==base.ideal_candidate,
    differs(pack.constraints,base.constraints),
    differs(pack.industries,base.industries),
    differs(pack.companies,base.companies),
    differs(pack.roles,base.roles),
    differs(pack.evidence,base.evidence),
    differs(pack.search_plan,base.search_plan),
    differs(pack.questions,base.questions),
  ].filter(Boolean).length;
  if(signals<2)throw new DeepSeekError('invalid_job_pack');
}

const AiDecisionSchema = z.object({
  label: z.enum(['recommend','review','exclude']),
  reasonCode: z.string().min(1).max(80),
  evidence: z.array(z.string().min(1)).min(1).max(4),
});
export type AiDecision = z.infer<typeof AiDecisionSchema> & { model:string;inputTokens:number;outputTokens:number };

export class DeepSeekProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(options: Options = {}) {
    this.apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
    this.baseUrl = (options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
    this.fetcher = options.fetcher ?? fetch;
  }

  isConfigured(): boolean { return Boolean(this.apiKey); }

  private endpoint(): string {
    let url: URL;
    try { url = new URL(this.baseUrl); } catch { throw new DeepSeekError('untrusted_api_host'); }
    const allowed = new Set(['api.deepseek.com', ...(process.env.DEEPSEEK_ALLOWED_HOSTS ?? '').split(',').map((x) => x.trim()).filter(Boolean)]);
    if (url.protocol !== 'https:' || !allowed.has(url.hostname)) throw new DeepSeekError('untrusted_api_host');
    return `${url.href.replace(/\/$/, '')}/chat/completions`;
  }

  async generateJson<T = unknown>(instruction: string, payload: unknown, signal?:AbortSignal, maxTokens=1800): Promise<DeepSeekResult<T>> {
    if (!this.apiKey) throw new DeepSeekError('missing_api_key');
    assertNoSensitiveText(payload);
    const response = await this.fetcher(this.endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: `${instruction}\n只输出合法 json，不要输出 markdown。` },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        stream: false,
        max_tokens: maxTokens,
      }),
      signal,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new DeepSeekError(response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'api_error', text, response.status);
    }
    const raw = await response.json() as { choices?: Array<{ finish_reason?:string;message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    const choice=raw.choices?.[0];
    if(choice?.finish_reason==='length')throw new DeepSeekError('response_truncated');
    const content = choice?.message?.content?.trim();
    if (!content) throw new DeepSeekError('empty_response');
    let data: T;
    try { data = JSON.parse(content) as T; } catch { throw new DeepSeekError('invalid_json'); }
    return {
      data,
      usage: { inputTokens: raw.usage?.prompt_tokens ?? 0, outputTokens: raw.usage?.completion_tokens ?? 0 },
      model: raw.model ?? this.model,
    };
  }

  async assessCandidate(pack: JobPack, candidate: SafeCandidate, signal?:AbortSignal): Promise<AiDecision> {
    const result = await this.generateJson('你是招聘筛选助手。规则优先，信息缺失必须标记 review；只有简历中存在明确反证时才能 exclude。输出 label、reasonCode、evidence 的 json。', {
      rules: { constraints: pack.constraints, industries: pack.industries, roles: pack.roles, evidence: pack.evidence, decision_policy: pack.decision_policy },
      candidate,
    },signal);
    const raw = result.data as Record<string, unknown>;
    const normalized = typeof raw.evidence === 'string' ? { ...raw, evidence: [raw.evidence] } : raw;
    const parsed = AiDecisionSchema.parse(normalized);
    if (parsed.label === 'exclude') {
      return { label:'review', reasonCode:'AI_EXCLUSION_REQUIRES_RULE_EVIDENCE', evidence:parsed.evidence, model:result.model, inputTokens:result.usage.inputTokens, outputTokens:result.usage.outputTokens };
    }
    return { ...parsed, model:result.model, inputTokens:result.usage.inputTokens, outputTokens:result.usage.outputTokens };
  }

  async generateJobPack(base: JobPack, safeSourceText: string,signal?:AbortSignal): Promise<JobPack> {
    const instruction='你是招聘岗位分析助手。基于客户要求生成完整岗位筛选包，包含硬/软条件、行业、目标公司、精确/同义/相邻职位、正面/可迁移/明确反证、公司轮和职位轮搜索计划、待确认问题、岗位摘要、理想候选人。不得使用年龄、性别、婚育作为判断条件；信息不明时写入 questions，不得臆造。只输出与输入结构一致的完整 json。';
    const generate=async(maxTokens:number,retryReason?:string)=>{
      const payload={template:base,source_text:safeSourceText,...(retryReason?{retry_reason:retryReason}:{})};
      const result=await this.generateJson<Record<string,unknown>>(instruction,payload,signal,maxTokens);
      const envelope=result.data;const raw=((envelope.job_pack??envelope.data??envelope) as Partial<JobPack>);
      const pack=normalizeAiDraftRules(JobPackSchema.parse({...base,...raw,
        constraints:{...base.constraints,...raw.constraints},industries:{...base.industries,...raw.industries},companies:{...base.companies,...raw.companies},
        roles:{...base.roles,...raw.roles},evidence:{...base.evidence,...raw.evidence},job_id:base.job_id,rule_version:base.rule_version,
        approval:{status:'draft',approved_at:null},decision_policy:{labels:['recommend','review','exclude'],missing_information:'review'},
      }));
      assertMaterialJobPack(base,pack);return pack;
    };
    try{return await generate(4000)}catch(error){
      const recoverable=error instanceof DeepSeekError&&['response_truncated','invalid_json','empty_response','invalid_job_pack'].includes(error.code);
      if(!recoverable&&!(error instanceof z.ZodError))throw error;
      return generate(7000,'上一次输出没有形成有效岗位规则，请根据 source_text 实质填写 template，不得原样返回。');
    }
  }

  async integrateJobChanges(base:JobPack,originalSource:string,changes:string[]):Promise<JobPack> {
    const result=await this.generateJson('你是招聘岗位规则更新助手。将原始 JD、当前已批准规则和按时间排列的新变化整合为完整岗位包。新的明确要求覆盖冲突的旧要求，未被修改的规则必须保留。不得使用年龄、性别、婚育等受保护属性。只输出与 current_rules 结构一致的完整 JSON。',{
      original_source:originalSource,current_rules:base,changes,
    });
    const envelope=result.data as Record<string,unknown>;const raw=((envelope.job_pack??envelope.data??envelope) as Partial<JobPack>);
    return JobPackSchema.parse({...base,...raw,
      constraints:{...base.constraints,...raw.constraints},industries:{...base.industries,...raw.industries},companies:{...base.companies,...raw.companies},
      roles:{...base.roles,...raw.roles},evidence:{...base.evidence,...raw.evidence},job_id:base.job_id,rule_version:base.rule_version,
      approval:{status:'draft',approved_at:null},decision_policy:{labels:['recommend','review','exclude'],missing_information:'review'},
    });
  }

  async generateGuluSearchPlan(pack: JobPack, sourceNotes=''): Promise<DeepSeekResult<GuluSearchPlan>> {
    const result=await this.generateJson<{rounds?:Array<Record<string,unknown>>}>('根据已批准岗位规则生成谷露两轮结构化搜索条件。第一轮必须是 company，第二轮必须是 role。只输出 rounds JSON；筛选字段仅可使用 keywords、companies、roles、cities、industries、functions。',{
      rules:{constraints:pack.constraints,industries:pack.industries,companies:pack.companies,roles:pack.roles,evidence:pack.evidence},
      source_notes:sourceNotes,
    });
    const rounds=(result.data.rounds??[]).map((round,index)=>({
      ...round,kind:index===0?'company':'role',limit:Math.min(50,Math.max(1,Number(round.limit)||50)),filters:{
        keywords:[],companies:[],roles:[],cities:[],industries:[],functions:[],
        ...((round.filters && typeof round.filters==='object')?round.filters:{}),
      },
    }));
    const data=GuluSearchPlanSchema.parse({jobId:pack.job_id,ruleVersion:pack.rule_version,sourceNotes,status:'draft',confirmedAt:null,rounds});
    return {data,usage:result.usage,model:result.model};
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    if (!this.apiKey) return { ok: false, keyPresent: false, latencyMs: 0, model: this.model, inputTokens: 0, outputTokens: 0, errorType: 'missing_api_key' };
    try {
      const result = await this.generateJson<{ ok: boolean }>('输出 json：{"ok":true}', { test: 'connection' });
      return { ok: true, keyPresent: true, latencyMs: Date.now() - start, model: result.model, ...result.usage };
    } catch (error) {
      const errorType = error instanceof DeepSeekError ? error.code : error instanceof TypeError ? 'network_error' : 'unknown_error';
      return { ok: false, keyPresent: true, latencyMs: Date.now() - start, model: this.model, inputTokens: 0, outputTokens: 0, errorType };
    }
  }
}
