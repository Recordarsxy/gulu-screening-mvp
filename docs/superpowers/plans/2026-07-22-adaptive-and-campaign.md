# Adaptive AND Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Probe result counts, refine broad single-dimension searches with deterministic AND combinations, and read at most five deduplicated candidates only when the effective result set contains 1–100 people.

**Architecture:** Add a pure server-side refinement planner that derives bounded combinations from the confirmed campaign and persists probe history in task decisions. The extension applies and verifies every planned filter, reports the parsed result total, and only opens details after the server returns `read`. Existing candidate ingestion continues to run DeepSeek assessment and searchFit.

**Tech Stack:** TypeScript, Express, Node SQLite, Chrome Manifest V3 extension JavaScript, Vitest, JSDOM.

## Global Constraints

- Start every search from `savedSearchId=94096`.
- Block owner filters and `type=contact` before reset, apply, probe, or read.
- Probe only when filters are verified; read only for result counts 1–100.
- Read no more than five unique candidates in calibration and never reopen a candidate already seen by the task.
- Never read phone, email, Wechat, address, photo, notes, or attachments.
- Never perform Gulu writes or candidate outreach.
- Use only DeepSeek; AI cannot independently reject a candidate.

---

### Task 1: Pure adaptive refinement planner

**Files:**
- Create: `src/server/services/adaptive-search.ts`
- Test: `tests/adaptive-search.test.ts`

**Interfaces:**
- Consumes: `GuluSearchStep`, `GuluSearchCampaign`, and previously tried filter fingerprints.
- Produces: `planAdaptiveProbe({campaign, seedStepId, currentFilters, resultCount, triedFingerprints})` returning `{action:'read'|'refine'|'next_step', filters, rationale}`.

- [ ] **Step 1: Write failing planner tests**

```ts
const base={campaign,seedStepId:'company-seed',triedFingerprints:[]};
expect(planAdaptiveProbe({resultCount:374,currentFilters:companyOnly,...base})).toMatchObject({
  action:'refine', filters:{companies:['阿里云'],roles:['海外销售经理']}
});
expect(planAdaptiveProbe({resultCount:42,currentFilters:companyAndRole,...base}).action).toBe('read');
expect(planAdaptiveProbe({resultCount:0,currentFilters:companyAndRole,triedFingerprints:[first],...base})).toMatchObject({action:'refine'});
```

- [ ] **Step 2: Run `npm.cmd test -- --run tests/adaptive-search.test.ts` and verify failures identify the missing module.**

- [ ] **Step 3: Implement deterministic combination enumeration**

```ts
export function planAdaptiveProbe(input: AdaptiveProbeInput): AdaptiveProbeDecision {
  if (input.resultCount >= 1 && input.resultCount <= 100) return {action:'read', filters:input.currentFilters, rationale:'bounded_result_set'};
  const candidates = enumerateCombinations(input.campaign, input.seedStepId)
    .filter(filters => !input.triedFingerprints.includes(searchFingerprint(filters)));
  const next = input.resultCount > 100
    ? candidates.find(filters => dimensionCount(filters) > dimensionCount(input.currentFilters))
    : candidates[0];
  return next ? {action:'refine', filters:next, rationale:input.resultCount ? 'result_set_too_large' : 'empty_combination'}
    : {action:'next_step', filters:input.currentFilters, rationale:'combinations_exhausted'};
}
```

- [ ] **Step 4: Re-run the focused test and verify all planner cases pass.**

- [ ] **Step 5: Commit `feat(campaign): plan adaptive AND refinements`.**

### Task 2: Persist probe decisions and expose the connector event

**Files:**
- Modify: `src/server/services/gulu.ts`
- Modify: `src/server/app.ts`
- Test: `tests/gulu-campaign-service.test.ts`
- Test: `tests/gulu-campaign-api.test.ts`

**Interfaces:**
- Produces: `GuluService.recordStepProbe(taskId, stepId, resultCount)` returning `{task, action, step, resultCount}`.
- Connector event: `step_probed` with `{stepId,resultCount,filters}`.

- [ ] **Step 1: Write failing service tests for 374→refine, 42→read, 0→alternate, and exhausted→next step.**
- [ ] **Step 2: Run the two focused campaign test files and verify expected missing-method/event failures.**
- [ ] **Step 3: Implement `recordStepProbe` using `gulu_strategy_decisions` as the audit log.**

```ts
recordStepProbe(id:string,stepId:string,resultCount:number) {
  const strategy=this.getTaskStrategy(id);
  const current=this.getCurrentCampaignStep(id)!;
  const tried=strategy.decisions.filter(item=>item.stepId===stepId&&item.action==='probe')
    .map(item=>searchFingerprint(item.patch.filters));
  const decision=planAdaptiveProbe({campaign:strategy.campaign,seedStepId:stepId,currentFilters:current.filters,resultCount,triedFingerprints:tried});
  this.recordStrategyDecision(id,stepId,'probe',{resultCount},decision.rationale,{filters:decision.filters,action:decision.action});
  if(decision.action==='refine') this.updateTaskStepFilters(id,stepId,decision.filters);
  if(decision.action==='next_step') return {task:this.completeStep(id,stepId,resultCount===0),...decision,resultCount};
  return {task:this.getTask(id),step:this.getCurrentCampaignStep(id),...decision,resultCount};
}
```

- [ ] **Step 4: Add `step_probed` handling in `src/server/app.ts`, validating the current step and an integer result count.**
- [ ] **Step 5: Run campaign service/API tests and verify all cases pass.**
- [ ] **Step 6: Commit `feat(campaign): persist adaptive probe decisions`.**

### Task 3: Verify applied filters and parse real result totals

**Files:**
- Modify: `extension/gulu-adapter.js`
- Modify: `extension/gulu-adapter-module.js`
- Modify: `extension/gulu-adapter.d.ts`
- Modify: `extension/content.js`
- Test: `tests/gulu-adapter-contract.test.ts`
- Test: `tests/extension.test.ts`

**Interfaces:**
- Produces: `inspectAppliedFilters(filters)` returning `{safe:boolean,missing:string[],emptyClauses:string[],total:number|null}`.
- Extends `inspectListState()` with `total:number|null` parsed from pager text such as `1/4(374)`.

- [ ] **Step 1: Add failing JSDOM tests for total parsing, verified tag clauses, verified comtree clauses, and empty query clauses such as `industry_id__or`.**
- [ ] **Step 2: Run the focused adapter tests and verify the new assertions fail.**
- [ ] **Step 3: Implement decoded GQL clause parsing and pager-total parsing.**

```js
function inspectAppliedFilters(filters,{doc=globalThis.document,loc=globalThis.location}={}) {
  const decoded=decodedUrl(loc?.href), clauses=(decoded.match(/[?&]gql=([^&]*)/)?.[1]||'').split('&').filter(Boolean);
  const emptyClauses=clauses.filter(clause=>!clause.includes('=')||!clause.split('=').slice(1).join('=').trim());
  const missing=expectedFilterFields(filters).filter(field=>!clauses.some(clause=>clause.startsWith(field.prefix)&&field.matches(clause,doc)));
  return {safe:missing.length===0&&emptyClauses.length===0,missing,emptyClauses,total:parseResultTotal(doc)};
}
```

- [ ] **Step 4: Wire `inspectAppliedFilters` through module, declaration, and content listener.**
- [ ] **Step 5: Run adapter and extension tests and verify they pass.**
- [ ] **Step 6: Commit `fix(extension): verify effective campaign filters`.**

### Task 4: Probe before reading candidates

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/revision.txt`
- Test: `tests/extension-campaign.test.ts`

**Interfaces:**
- Consumes `inspectAppliedFilters` and `step_probed`.
- Guarantees no `readList` or detail opening occurs before a `read` probe decision with total 1–100.

- [ ] **Step 1: Add failing static contract tests asserting order: apply → submit → settle → verify filters → probe → optional read.**
- [ ] **Step 2: Run `tests/extension-campaign.test.ts` and verify failure.**
- [ ] **Step 3: Update campaign execution.**

```js
const applied=await send(tab.id,'inspectAppliedFilters',{filters:step.filters});
if(!applied.safe||!Number.isInteger(applied.total)) throw new Error('campaign_filters_unverified');
const probe=await event(task.id,'step_probed',{stepId:step.id,resultCount:applied.total,filters:step.filters},`probe:${task.id}:${step.id}:${searchFingerprint(step.filters)}`);
if(probe.action!=='read'){resumeSoon();return;}
if(applied.total<1||applied.total>100) throw new Error('campaign_read_window_invalid');
const list=await send(tab.id,'readList',{page:progress.page});
```

- [ ] **Step 4: Limit calibration to five unique candidates and retain existing task-wide dedupe checks.**
- [ ] **Step 5: Add both new safety errors to immediate-attention handling and increment revision to `.20`.**
- [ ] **Step 6: Run extension tests and verify they pass.**
- [ ] **Step 7: Commit `feat(extension): probe adaptive searches before reading`.**

### Task 5: Full verification and real Meshy run

**Files:**
- No planned production files unless a new failing real-world regression requires TDD.

- [ ] **Step 1: Run `npm.cmd run verify` and require 0 failures.**
- [ ] **Step 2: Run `npm.cmd run lint` and require 0 errors.**
- [ ] **Step 3: Push `codex/gulu-v1.3.0` and wait for automatic extension reload.**
- [ ] **Step 4: Stop the current zero-read failed task and create a fresh formal run for campaign `4dccf732-1979-4ae4-90d0-54200a66b04a`.**
- [ ] **Step 5: Continuously verify URL safety, effective labels, probe totals, and task counters.**
- [ ] **Step 6: Capture evidence that a broad single tag reads zero details, an AND combination reaches 1–100, and at most five unique details are opened.**
- [ ] **Step 7: Verify DeepSeek searchFit rows, direction changes after low fit, and no duplicate candidate IDs.**
- [ ] **Step 8: Do not create a v1.3.0 tag or Release until Meshy/Air8 acceptance is complete.**
