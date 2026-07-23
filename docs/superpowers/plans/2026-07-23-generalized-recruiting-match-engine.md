# Generalized Recruiting Match Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a visible cross-job matching MVP with deterministic DeepSeek dimension scoring, a separate verification-candidate view, safe Gulu deep links, and automatic keyword fallback for unavailable Gulu taxonomy labels.

**Architecture:** Add a policy-versioned scoring contract shared by DeepSeek and persistence, extend the run-scoped results API with explicit candidate buckets, and render verification candidates separately from high-fit results. Keep approved semantic search intent immutable; when a live Gulu tree value is absent, create a recorded execution-only keyword fallback before trying other directions.

**Tech Stack:** TypeScript, Zod, Node SQLite, Express, React, Chrome MV3 extension, Vitest, JSDOM.

## Global Constraints

- DeepSeek is the only AI provider.
- AI ranks and explains but never independently excludes a candidate.
- Candidate Results defaults to score 70–100 only.
- Verification candidates are score 55–69 and appear only in Run Center.
- Gulu access is read-only and excludes phone, email, WeChat, address, photo, notes, and attachments.
- Only `http://121.43.105.7/crm#candidate/detail?id=...` may be opened as a Gulu deep link.
- Owner filters and `type=contact` remain forbidden.
- No v1.3.0 tag or Release before cross-role live acceptance.

---

### Task 1: Policy-Versioned Dimension Scoring Contract

**Files:**
- Create: `src/server/services/match-policy.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/db/migrate.ts`
- Test: `tests/match-policy.test.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `MATCH_POLICY_VERSION`, `MatchDimensionScoreSchema`, `calculateSearchFit(dimensions)`, and extended `GuluSearchFitSchema`.
- Persists: `dimensions_json`, `verification_questions_json`, and `policy_version` on `gulu_search_fits`.

- [ ] **Step 1: Write failing policy and migration tests**

Test that positive points require evidence, incomplete dimensions require gaps, totals are calculated from earned points, and migration 8 adds the three columns.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
npm.cmd test -- --run tests/match-policy.test.ts tests/db.test.ts
```

Expected: fail because `match-policy.ts` and migration 8 do not exist.

- [ ] **Step 3: Implement the minimal policy**

Use:

```ts
export const MATCH_POLICY_VERSION="general-v1";
export const MatchDimensionScoreSchema=z.object({
  id:z.string().min(1),
  earned:z.number().int().nonnegative(),
  possible:z.number().int().positive(),
  confidence:z.enum(["low","medium","high"]),
  evidence:z.array(z.string().min(1)).max(4),
  gaps:z.array(z.string().min(1)).max(4),
}).superRefine((value,ctx)=>{
  if(value.earned>value.possible)ctx.addIssue({code:"custom",message:"dimension_score_exceeds_weight"});
  if(value.earned>0&&!value.evidence.length)ctx.addIssue({code:"custom",message:"positive_score_requires_evidence"});
  if(value.earned<value.possible&&!value.gaps.length)ctx.addIssue({code:"custom",message:"incomplete_dimension_requires_gap"});
});
```

`calculateSearchFit` sums `earned`, verifies possible points total 100, and returns the integer total.

- [ ] **Step 4: Add migration 8**

Add columns only when absent and preserve existing rows with `policy_version='legacy'`, `dimensions_json='[]'`, and `verification_questions_json='[]'`.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Expected: both files pass.

- [ ] **Step 6: Commit**

```powershell
git add src/server/services/match-policy.ts src/shared/contracts.ts src/server/db/migrate.ts tests/match-policy.test.ts tests/db.test.ts
git commit -m "feat(matching): add policy-versioned dimension scores"
```

### Task 2: Enforce Structured DeepSeek Search-Fit

**Files:**
- Modify: `src/server/services/deepseek.ts`
- Modify: `src/server/services/gulu.ts`
- Test: `tests/deepseek.test.ts`
- Test: `tests/gulu-campaign-service.test.ts`

**Interfaces:**
- Consumes: `calculateSearchFit` and extended `GuluSearchFitSchema`.
- Produces: per-dimension score, evidence, gaps, verification questions, deterministic total, model, and token usage.

- [ ] **Step 1: Write failing DeepSeek normalization tests**

Cover:

- valid dimensions totaling 100;
- positive points without evidence rejected;
- incomplete dimensions without gaps rejected;
- resume-opaque requirements returned as verification questions rather than automatic score deductions;
- total score is ignored if supplied by the model and recalculated locally.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm.cmd test -- --run tests/deepseek.test.ts tests/gulu-campaign-service.test.ts
```

- [ ] **Step 3: Replace free-form scoring prompt**

Require seven universal dimensions: core capability, market/customer context, product/industry context, scope/level, outcome evidence, transferable signals, and interview-only signals. Tell DeepSeek that interview-only missing information creates questions and does not prove failure.

- [ ] **Step 4: Persist the structured result**

Extend `recordSearchFit` insert/update statements to store dimensions, questions, and policy version while preserving the existing 70-point shortlist rule.

- [ ] **Step 5: Run focused tests and confirm GREEN**

- [ ] **Step 6: Commit**

```powershell
git add src/server/services/deepseek.ts src/server/services/gulu.ts tests/deepseek.test.ts tests/gulu-campaign-service.test.ts
git commit -m "feat(matching): enforce evidence-based DeepSeek scoring"
```

### Task 3: High-Fit and Verification Result Buckets

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/client/api.ts`
- Test: `tests/gulu-campaign-api.test.ts`

**Interfaces:**
- Produces: `GET /api/jobs/:jobId/results?runId=...&bucket=high_fit|verification`.
- Default bucket: `high_fit`.
- Result fields: `searchFit`, `dimensions`, `gaps`, `verificationQuestions`, `policyVersion`, and safe `detailUrl`.

- [ ] **Step 1: Write failing API tests**

Seed candidates at 54, 55, 69, and 70. Assert:

- default returns only 70;
- `bucket=verification` returns 55 and 69;
- 54 is never returned by either browsing bucket;
- an excluded assessment is not returned as high-fit;
- dimensions and questions are parsed JSON.

- [ ] **Step 2: Run focused API test and confirm RED**

```powershell
npm.cmd test -- --run tests/gulu-campaign-api.test.ts
```

- [ ] **Step 3: Implement explicit bucket SQL**

Validate the bucket query. Use score ranges:

```ts
const scoreClause=bucket==="verification"
  ?"sf.score BETWEEN 55 AND 69"
  :"sf.score>=70";
```

Keep parameterized values and never interpolate user input into SQL.

- [ ] **Step 4: Extend client result types and API**

Add:

```ts
export type ResultBucket="high_fit"|"verification";
results:(id,runId,bucket="high_fit")=>...
```

- [ ] **Step 5: Run focused tests and confirm GREEN**

- [ ] **Step 6: Commit**

```powershell
git add src/server/app.ts src/client/api.ts tests/gulu-campaign-api.test.ts
git commit -m "feat(results): expose verification candidate bucket"
```

### Task 4: Safe Gulu Candidate Deep Links

**Files:**
- Create: `src/shared/gulu-link.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/App.tsx`
- Test: `tests/gulu-link.test.ts`
- Test: `tests/client-v13.test.tsx`

**Interfaces:**
- Produces: `safeGuluCandidateUrl(value:string):string|null`.
- UI label: `在谷露查看`.

- [ ] **Step 1: Write failing allowlist tests**

Accept only host `121.43.105.7`, hash route `candidate/detail`, and a non-empty `id`. Reject alternate hosts, credentials, non-detail routes, and missing IDs.

- [ ] **Step 2: Run focused tests and confirm RED**

- [ ] **Step 3: Implement URL allowlist and server projection**

Return `detailUrl:null` when invalid.

- [ ] **Step 4: Add the user-click link**

Render:

```tsx
{item.detailUrl&&(
  <a className="button ghost" href={item.detailUrl} target="_blank" rel="noopener noreferrer">
    在谷露查看
  </a>
)}
```

Do not trigger navigation during render or data loading.

- [ ] **Step 5: Run focused tests and confirm GREEN**

- [ ] **Step 6: Commit**

```powershell
git add src/shared/gulu-link.ts src/server/app.ts src/client/App.tsx tests/gulu-link.test.ts tests/client-v13.test.tsx
git commit -m "feat(results): add safe Gulu candidate links"
```

### Task 5: Run Center Verification Candidate Panel

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/styles.css`
- Test: `tests/client-v13.test.tsx`

**Interfaces:**
- Consumes: verification bucket API.
- Produces: Run Center panel `待验证人才`, candidate cards, counts, evidence, gaps, questions, and deep link.

- [ ] **Step 1: Write failing UI contract tests**

Assert source contains:

- `待验证人才`;
- `55–69`;
- separate verification API call;
- dimension and gap rendering;
- no low-fit browsing request.

- [ ] **Step 2: Run focused UI test and confirm RED**

- [ ] **Step 3: Add verification state and loading**

Load verification candidates whenever a campaign run is selected or refreshed. Candidate Results continues loading only `high_fit`.

- [ ] **Step 4: Render compact verification cards in Run Center**

Show score, matched evidence, gaps, verification questions, and `在谷露查看`. Empty state text must explain that no 55–69 candidates were found.

- [ ] **Step 5: Run focused tests and confirm GREEN**

- [ ] **Step 6: Commit**

```powershell
git add src/client/App.tsx src/client/api.ts src/client/styles.css tests/client-v13.test.tsx
git commit -m "feat(run-center): show verification candidates"
```

### Task 6: Unavailable Taxonomy Keyword Fallback

**Files:**
- Modify: `src/server/services/gulu.ts`
- Modify: `extension/background.js`
- Modify: `extension/revision.txt`
- Test: `tests/gulu-campaign-service.test.ts`
- Test: `tests/extension-campaign.test.ts`

**Interfaces:**
- Consumes: `filter_unavailable` for `cities`, `industries`, or `functions`.
- Produces: execution-only filters with the unavailable structured value removed and the same semantic concept inserted into `keywords`.
- Records: strategy decision rationale `taxonomy_keyword_fallback`.

- [ ] **Step 1: Write failing fallback tests**

Given `industries:["3D打印"]`, assert the next executable filters become:

```ts
{industries:[],keywords:["3D打印"]}
```

Assert the same fingerprint cannot repeat and an unavailable keyword fallback moves to the next direction.

- [ ] **Step 2: Run focused tests and confirm RED**

- [ ] **Step 3: Implement one-time fallback**

Before treating the current combination as empty, create a keyword fallback when that keyword fingerprint has not been tried. Record original field/value and execution mode in decision metrics.

- [ ] **Step 4: Keep extension safety behavior**

The extension submits only the server-returned execution filters, still verifies `savedSearchId=94096`, and still blocks owner/contact filters.

- [ ] **Step 5: Bump extension revision and run focused tests**

- [ ] **Step 6: Commit**

```powershell
git add src/server/services/gulu.ts extension/background.js extension/revision.txt tests/gulu-campaign-service.test.ts tests/extension-campaign.test.ts
git commit -m "feat(search): fall back unavailable taxonomy to keywords"
```

### Task 7: Create and Validate the Recruiting Search Skill

**Files:**
- Create: `skills/optimizing-recruiting-search/SKILL.md`
- Create: `skills/optimizing-recruiting-search/references/matching-policy.md`
- Create: `skills/optimizing-recruiting-search/references/examples.md`
- Create: `skills/optimizing-recruiting-search/agents/openai.yaml`
- Create: `tests/skill-optimizing-recruiting-search.test.ts`

**Interfaces:**
- Produces: a repository Skill for preparing and auditing cross-role search strategies.
- References: the canonical runtime design and `MATCH_POLICY_VERSION`; does not duplicate credentials or candidate data.

- [ ] **Step 1: Capture baseline failure fixtures**

Use the observed failures as RED fixtures:

- non-existent `3D打印` industry node;
- `vibe coding` missing treated as failure;
- score 65 with no evidence or gaps;
- generic `B2B销售` producing low-fit candidates.

- [ ] **Step 2: Write failing Skill structure and conformance tests**

Assert required files, valid YAML frontmatter, description beginning `Use when`, cross-role examples, and explicit runtime/Skill boundary.

- [ ] **Step 3: Run focused test and confirm RED**

- [ ] **Step 4: Write the minimal Skill and references**

Keep `SKILL.md` below 500 words. Put detailed examples in references.

- [ ] **Step 5: Generate `agents/openai.yaml` using skill-creator scripts**

Use deterministic interface fields derived from `SKILL.md`.

- [ ] **Step 6: Run focused test and confirm GREEN**

- [ ] **Step 7: Commit**

```powershell
git add skills/optimizing-recruiting-search tests/skill-optimizing-recruiting-search.test.ts
git commit -m "feat(skill): add recruiting search optimizer"
```

### Task 8: Full Verification and Simple Visible Test

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-generalized-recruiting-match-engine.md` checkboxes only.

**Interfaces:**
- Produces: verified build, clean branch, and a visible local test result.

- [ ] **Step 1: Run full verification**

```powershell
npm.cmd run verify
npm.cmd run lint
git diff --check
```

Expected: all tests, typecheck, build, lint, and diff check pass.

- [ ] **Step 2: Restart with local `.env`**

```powershell
node --env-file-if-exists=.env dist-server/server/index.js
```

Keep the service local to `127.0.0.1:4318`.

- [ ] **Step 3: Seed or rescore a safe local demonstration**

Use existing sanitized candidate records or test fixtures to produce:

- one 70+ high-fit candidate;
- one 55–69 verification candidate;
- one sub-55 hidden candidate.

Do not fabricate production run evidence. Label seeded data as a local demonstration.

- [ ] **Step 4: Verify the website**

Confirm Candidate Results shows only the high-fit demonstration and Run Center shows only the verification demonstration. Click `在谷露查看` and confirm the allowlisted detail URL opens.

- [ ] **Step 5: Push the branch**

```powershell
git push origin codex/gulu-v1.3.0
```

- [ ] **Step 6: Report evidence**

Report commit IDs, test counts, visible bucket counts, taxonomy fallback evidence, link target validation, and remaining live cross-role acceptance work. Do not create a tag or Release.
