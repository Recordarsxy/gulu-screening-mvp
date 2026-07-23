import { describe, expect, it } from "vitest";
import { DeepSeekProvider } from "../src/server/services/deepseek.js";
import { makeDefaultJobPack } from "../src/server/services/job-pack.js";

const response = (content: unknown) =>
  new Response(
    JSON.stringify({
      model: "deepseek-test",
      usage: { prompt_tokens: 20, completion_tokens: 10 },
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200 },
  );
const fitDimensions = (earned: number[]) =>
  [
    ["core_capability", 25],
    ["market_customer", 20],
    ["product_industry", 15],
    ["scope_level", 15],
    ["outcome_evidence", 15],
    ["transferable_signals", 5],
    ["interview_only", 5],
  ].map(([id, possible], index) => ({
    id,
    earned: earned[index],
    possible,
    confidence: earned[index] ? "medium" : "low",
    evidence: earned[index] ? [`${id} evidence`] : [],
    gaps: earned[index] === possible ? [] : [`${id} gap`],
  }));
const step = (
  type: string,
  title: string,
  filters: Record<string, string[]>,
) => ({
  type,
  title,
  objective: `覆盖${title}`,
  rationale: `${title}与岗位相关`,
  expectedSignals: ["海外B2B销售"],
  limit: 20,
  enabled: true,
  filters,
});

describe("DeepSeek adaptive campaign behavior", () => {
  it("generates a diversified campaign from rules, notes and aggregate history", async () => {
    let payload: any;
    const provider = new DeepSeekProvider({
      apiKey: "test",
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        payload = JSON.parse(body.messages[1].content);
        return response({
          summary: "四方向验证海外销售人才池",
          targetShortlist: 8,
          steps: [
            step("seed_company", "技术平台公司", {
              companies: ["阿里云", "火山引擎"],
            }),
            step("role_cluster", "海外销售职位", {
              roles: ["海外销售经理", "国际销售经理"],
            }),
            step("market_cluster", "SaaS市场组合", {
              roles: ["海外销售经理"],
              industries: ["SaaS"],
            }),
            step("seed_company", "游戏工具公司", {
              companies: ["Unity", "Cocos"],
            }),
          ],
        });
      },
    });
    const pack = makeDefaultJobPack("job-meshy", "海外销售经理", "JD");
    pack.roles.synonyms = ["国际销售经理"];
    pack.industries.target = ["SaaS"];
    pack.companies.target = ["阿里云"];
    const result = await provider.generateGuluCampaign(
      pack,
      "同事建议关注游戏工具公司",
      [{ steps: 2, unique: 10, highFit: 0 }],
    );
    expect(result.data).toMatchObject({
      jobId: "job-meshy",
      targetShortlist: 8,
      status: "draft",
    });
    expect(result.data.steps).toHaveLength(4);
    expect(
      new Set(result.data.steps.map((item) => JSON.stringify(item.filters)))
        .size,
    ).toBe(4);
    expect(payload.history).toEqual([{ steps: 2, unique: 10, highFit: 0 }]);
    expect(JSON.stringify(payload)).not.toContain("候选人姓名");
  });
  it("scores retrieval fit separately from the hiring decision", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "test",
      fetcher: async () =>
        response({
          score: 99,
          dimensions: fitDimensions([25, 17, 12, 12, 12, 4, 2]),
          verificationQuestions: ["vibe coding待核实"],
        }),
    });
    const pack = makeDefaultJobPack("job-1", "海外销售", "JD");
    const fit = await provider.scoreSearchFit(pack, {
      currentCompany: "示例SaaS",
      currentRole: "国际销售经理",
      experiences: [],
    });
    expect(fit).toMatchObject({
      score: 84,
      evidence: ["core_capability evidence","market_customer evidence","product_industry evidence","scope_level evidence"],
      verificationQuestions: ["vibe coding待核实"],
      model: "deepseek-test",
      inputTokens: 20,
      outputTokens: 10,
    });
  });
  it("ignores alternate model total fields and calculates the structured search fit",async()=>{const provider=new DeepSeekProvider({apiKey:"test",fetcher:async()=>response({search_fit:99,dimensions:fitDimensions([10,5,0,5,0,0,0]),verification_questions:["海外B2B经验","明确业绩"]})});const pack=makeDefaultJobPack("job-1","海外销售","JD");await expect(provider.scoreSearchFit(pack,{currentCompany:"示例公司",currentRole:"大客户经理",experiences:[]})).resolves.toMatchObject({score:20,verificationQuestions:["海外B2B经验","明确业绩"],model:"deepseek-test"});});
  it("repairs empty or duplicate model steps with approved-rule fallbacks", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "test",
      fetcher: async () =>
        response({
          summary: "海外销售多方向",
          targetShortlist: 10,
          steps: [
            {
              type: "seed_company",
              title: "公司种子",
              objective: "验证公司",
              rationale: "目标公司",
              limit: 20,
              filters: {},
              keywords: ["vibe coding"],
              companies: ["阿里云"],
              roles: ["海外销售经理"],
              cities: ["北京"],
              industries: ["SaaS"],
              functions: ["销售"],
            },
            step("seed_company", "重复公司", { companies: ["阿里云"] }),
            step("manual", "空方向", {}),
            step("manual", "另一空方向", {}),
          ],
        }),
    });
    const pack = makeDefaultJobPack("job-meshy", "海外销售经理", "JD");
    pack.companies.target = ["阿里云"];
    pack.roles.synonyms = ["国际销售经理"];
    pack.roles.adjacent = ["大客户经理"];
    pack.industries.target = ["SaaS"];
    const result = await provider.generateGuluCampaign(pack);
    expect(result.data.steps.length).toBeGreaterThanOrEqual(4);
    expect(result.data.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "公司种子",
          filters: expect.objectContaining({ companies: ["阿里云"] }),
        }),
      ]),
    );
    expect(
      result.data.steps.every(
        (item) =>
          Object.values(item.filters).filter((values) => values.length)
            .length <= 3,
      ),
    ).toBe(true);
    expect(
      result.data.steps.every((item) =>
        Object.values(item.filters).some((values) => values.length),
      ),
    ).toBe(true);
    expect(
      new Set(result.data.steps.map((item) => JSON.stringify(item.filters)))
        .size,
    ).toBe(result.data.steps.length);
  });
  it("adds an approved role direction when the model returns only company steps",async()=>{
    const provider=new DeepSeekProvider({apiKey:"test",fetcher:async()=>response({summary:"company only",targetShortlist:10,steps:[
      step("seed_company","funds",{companies:["Alpha Fund","Beta Fund"]}),
      step("seed_company","banks",{companies:["Alpha Bank","Beta Bank"]}),
      step("seed_company","brokers",{companies:["Alpha Securities"]}),
      step("seed_company","insurers",{companies:["Alpha Insurance"]}),
    ]})});
    const pack=makeDefaultJobPack("job-fund","Sales General Manager","JD");
    pack.roles.exact=["Sales General Manager"];
    pack.roles.synonyms=["Institutional Sales Director"];
    const result=await provider.generateGuluCampaign(pack);
    expect(result.data.steps.some((item)=>item.filters.roles.length>0)).toBe(true);
  });
  it("returns a constrained runtime decision with company-only additions", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "test",
      fetcher: async () =>
        response({
          action: "append_company_step",
          rationale: "高匹配候选来自相邻技术公司",
          companies: [
            {
              name: "火山引擎",
              source: "candidate_company",
              reason: "高匹配候选过往公司",
            },
          ],
        }),
    });
    const decision = await provider.decideGuluStrategy({
      campaignSummary: "海外销售",
      stepTitle: "种子公司",
      metrics: { read: 5, unique: 5, highFit: 3, duplicateRate: 0 },
      candidateCompanies: ["火山引擎"],
    });
    expect(decision.data).toMatchObject({
      action: "append_company_step",
      companies: [{ name: "火山引擎", source: "candidate_company" }],
    });
  });
});
