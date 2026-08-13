import { randomUUID } from 'node:crypto';
import type { GuluSearchCampaign, GuluSearchPlan, JobPack } from '../../shared/contracts.js';
import type { SafeCandidate } from '../services/redaction.js';
import { DeepSeekProvider, type DeepSeekResult } from '../services/deepseek.js';

const usage = { inputTokens: 0, outputTokens: 0 };

/** Fixed, network-free provider used by the portable demo. */
export class DemoAIProvider extends DeepSeekProvider {
  override isConfigured(): boolean { return true; }

  override async generateJobPack(base: JobPack): Promise<JobPack> {
    return {
      ...base,
      summary: '虚构演示数据：工业自动化大客户销售总监固定案例。',
      industries: { target: ['工业自动化', '装备制造'], adjacent: ['企业软件'], excluded: [] },
      companies: { target: ['启明制造', '远航工业', '宏达机械'] },
      roles: { exact: ['大客户销售总监'], synonyms: ['行业销售经理'], adjacent: ['商务经理'], excluded: [] },
      evidence: { required: ['大型制造企业客户拓展'], transferable: ['投标', '团队管理'], negative: ['仅零售门店销售'] },
      search_plan: ['公司轮：工业自动化与装备制造目标公司', '职位轮：大客户销售及相邻岗位'],
    };
  }

  override async assessCandidate(_pack: JobPack, candidate: SafeCandidate) {
    const text = JSON.stringify(candidate);
    if (/投标|大型制造企业客户拓展|连续三年/.test(text)) {
      return { label: 'recommend' as const, reasonCode: 'DEMO_TARGET_EVIDENCE', evidence: ['存在可核验的目标客户拓展或投标证据'], model: 'demo-offline', ...usage };
    }
    return { label: 'review' as const, reasonCode: 'DEMO_NEEDS_REVIEW', evidence: ['现有信息不足，转人工复核'], model: 'demo-offline', ...usage };
  }

  override async generateGuluSearchPlan(pack: JobPack, sourceNotes = ''): Promise<DeepSeekResult<GuluSearchPlan>> {
    const now = new Date().toISOString();
    return {
      model: 'demo-offline', usage,
      data: {
        jobId: pack.job_id, ruleVersion: pack.rule_version, version: 1, sourceNotes,
        status: 'draft', confirmedAt: null, rollout: { dryRunCompleted: false, pilotCompleted: false },
        createdAt: now, updatedAt: now,
        rounds: [
          { kind: 'company', limit: 20, filters: { keywords: [], companies: ['启明制造', '远航工业', '宏达机械'], roles: [], cities: [], industries: [], functions: [] } },
          { kind: 'role', limit: 20, filters: { keywords: [], companies: [], roles: ['大客户销售总监', '行业销售经理'], cities: [], industries: [], functions: [] } },
        ],
      },
    };
  }

  override async generateGuluCampaign(pack: JobPack, sourceNotes = ''): Promise<DeepSeekResult<GuluSearchCampaign>> {
    const now = new Date().toISOString();
    const empty = { keywords: [], companies: [], roles: [], cities: [], industries: [], functions: [] };
    return {
      model: 'demo-offline', usage,
      data: {
        id: randomUUID(), jobId: pack.job_id, ruleVersion: pack.rule_version, version: 1, status: 'draft',
        summary: '虚构演示数据：先验证目标公司池，再拓展核心与相邻职位。', sourceNotes,
        targetShortlist: 8, maxUniqueCandidates: 60, maxSteps: 3, confirmedAt: null, createdAt: now, updatedAt: now,
        strategyBrief: {
          businessObjective: '为工业自动化业务寻找能够开发大型制造企业客户的销售负责人。',
          hiringThesis: '复杂制造业销售、投标与可量化客户拓展证据比单纯职位名称更重要。',
          criticalOutcomes: ['建立重点客户管线', '推动复杂项目成交'],
          successEvidence: ['大型制造企业客户拓展', '投标或复杂项目经验'],
          talentArchetypes: [{ name: '制造业大客户销售', whyFit: '熟悉复杂决策链与项目型销售', likelyCompanies: ['启明制造', '远航工业'], likelyRoles: ['大客户销售总监', '行业销售经理'], tradeoffs: ['行业相邻时需复核产品复杂度'] }],
          marketMap: { corePools: ['工业自动化', '装备制造'], adjacentPools: ['企业软件', '工业咨询'], transferLogic: '以复杂 B2B 销售证据判断可迁移性。' },
          risks: ['简历业绩数据可能不完整'], adaptationLogic: ['结果过少时扩展相邻职位', '信息不足统一进入人工复核'],
        },
        steps: [
          { id: 'demo-company', order: 0, type: 'seed_company', title: '目标公司池', objective: '验证制造业大客户销售人才', rationale: '目标公司可提供复杂项目销售场景', expectedSignals: ['大型制造企业客户拓展'], limit: 20, enabled: true, filters: { ...empty, companies: ['启明制造', '远航工业'] }, sources: [] },
          { id: 'demo-role', order: 1, type: 'role_cluster', title: '核心职位池', objective: '寻找大客户销售负责人', rationale: '职位池补足目标公司外的直接人才', expectedSignals: ['投标', '业绩'], limit: 20, enabled: true, filters: { ...empty, roles: ['大客户销售总监', '行业销售经理'] }, sources: [] },
          { id: 'demo-adjacent', order: 2, type: 'market_cluster', title: '相邻行业池', objective: '验证可迁移的复杂 B2B 销售', rationale: '企业软件与工业咨询经验可能迁移', expectedSignals: ['企业级解决方案销售'], limit: 20, enabled: true, filters: { ...empty, industries: ['企业软件', '工业咨询'] }, sources: [] },
        ],
      },
    };
  }

  override async testConnection() {
    return { ok: true, keyPresent: false, latencyMs: 0, model: 'demo-offline', inputTokens: 0, outputTokens: 0 };
  }
}
