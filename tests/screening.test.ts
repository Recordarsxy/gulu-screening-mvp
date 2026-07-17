import { describe, expect, it } from 'vitest';
import { makeDefaultJobPack } from '../src/server/services/job-pack.js';
import { buildCacheKey, classifyDeterministically, deduplicateCandidates } from '../src/server/services/screening.js';
import { demoCompanyRound, demoRoleRound } from '../src/server/demo/candidates.js';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { approveVersion, createDraft } from '../src/server/services/job-pack.js';
import { ScreeningEngine } from '../src/server/services/screening.js';
import { DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('screening rules', () => {
  it('deduplicates the same person across company and role rounds', () => {
    const unique = deduplicateCandidates([demoCompanyRound, demoRoleRound]);
    expect(unique.length).toBeLessThan(demoCompanyRound.length + demoRoleRound.length);
    expect(new Set(unique.map((c) => c.dedupeKey)).size).toBe(unique.length);
  });

  it('excludes only explicit negative evidence', () => {
    const pack = makeDefaultJobPack('job-1', '销售经理', '制造业大客户');
    pack.evidence.negative = ['仅零售门店销售'];
    const assessment = classifyDeterministically(pack, demoRoleRound.find((c) => c.id === 'demo-8')!);
    expect(assessment).toMatchObject({ label: 'exclude', reasonCode: 'EXPLICIT_NEGATIVE' });
  });

  it('routes missing information to review instead of exclusion', () => {
    const pack = makeDefaultJobPack('job-1', '销售经理', '制造业大客户');
    pack.evidence.required = ['大型制造企业客户拓展'];
    const assessment = classifyDeterministically(pack, demoRoleRound.find((c) => c.id === 'demo-6')!);
    expect(assessment).toMatchObject({ label: 'review', reasonCode: 'MISSING_INFORMATION' });
  });

  it('builds a stable cache key from rule and resume content', () => {
    expect(buildCacheKey({ a: 1 }, { b: 2 })).toBe(buildCacheKey({ a: 1 }, { b: 2 }));
    expect(buildCacheKey({ a: 1 }, { b: 2 })).not.toBe(buildCacheKey({ a: 2 }, { b: 2 }));
  });

  it('uses DeepSeek only for review cases and sends a redacted candidate', async () => {
    const db = openDatabase(':memory:'); migrate(db);
    const pack = createDraft(db,{jobId:'job-ai',title:'不存在职位',sourceText:'JD'}); pack.evidence.required=['不存在证据'];
    db.prepare('UPDATE job_rule_versions SET pack_json=? WHERE job_id=? AND version=1').run(JSON.stringify(pack),'job-ai'); approveVersion(db,'job-ai',1);
    let sent = '';
    const provider = new DeepSeekProvider({apiKey:'test',fetcher:async (_url,init)=>{sent=String(init?.body);return new Response(JSON.stringify({choices:[{message:{content:'{"label":"recommend","reasonCode":"AI_MATCH","evidence":["相关经历"]}'}}],usage:{prompt_tokens:3,completion_tokens:2},model:'deepseek-v4-flash'}),{status:200});}});
    const candidate = {...demoRoleRound[0],name:'张三',guluId:'gulu-secret',detailUrl:'https://example.test/secret'};
    const engine = new ScreeningEngine(db,provider); const run=engine.startRun('job-ai',[[candidate]]); await engine.processAll(run.id);
    expect(sent).not.toContain('张三'); expect(sent).not.toContain('gulu-secret'); expect(sent).not.toContain('example.test');
    expect(db.prepare('SELECT label,model FROM assessments').get()).toEqual({label:'recommend',model:'deepseek-v4-flash'});
    db.close();
  });
});
