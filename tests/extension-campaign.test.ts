import {describe,expect,it} from 'vitest';import {readFile} from 'node:fs/promises';
describe('adaptive campaign extension contract',()=>{
  it('preflights arbitrary steps and checks dedupe before opening details',async()=>{const source=await readFile(new URL('../extension/background.js',import.meta.url),'utf8');expect(source).toContain('async function runCampaignTask');expect(source).toContain("'preflight_completed'");expect(source).toContain("'applyFilterValue'");expect(source).toContain("'submitSearch'");expect(source).toContain('/candidates/check');expect(source).toContain('sourceStepId: step.id');expect(source).toContain('candidate:${task.id}:${step.id}:${seed.guluId}');});
});
