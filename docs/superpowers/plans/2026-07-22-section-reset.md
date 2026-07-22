# Section Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, independently scoped reset controls for rules review, run center, and candidate results.

**Architecture:** A focused reset service owns transactional deletion boundaries and returns deletion counts. Express routes expose that service, while the React app adds one confirmed action per section and refreshes only the affected client state.

**Tech Stack:** TypeScript, Node SQLite, Express, React, Vitest.

## Global Constraints

- Every destructive UI action requires an explicit confirmation.
- Rules reset preserves the job and source material but clears rules and all downstream data.
- Runs reset preserves rules and candidate results.
- Results reset preserves rules, plans, campaigns, and task history.
- Real Meshy data must not be reset during verification.

---

### Task 1: Transactional reset service and API routes

**Files:**
- Create: `src/server/services/job-reset.ts`
- Modify: `src/server/app.ts`
- Test: `tests/job-reset-api.test.ts`

**Interfaces:**
- Produces: `resetJobSection(db, jobId, section): ResetSummary` where `section` is `rules | runs | results`.
- Produces: `POST /api/jobs/:jobId/reset/:section` returning the summary or 404.

- [ ] **Step 1: Write failing API tests**

Seed one job with rule versions, plans, campaigns, tasks, candidates, assessments and reviews. Assert exact preservation boundaries for all three sections and assert 404 for a missing job.

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npm.cmd test -- --run tests/job-reset-api.test.ts`

Expected: FAIL because the reset routes do not exist.

- [ ] **Step 3: Implement the transaction service and routes**

Use prepared `DELETE` statements in dependency-safe order. For rules, delete `job_change_notes`, `gulu_tasks`, plans, campaigns, legacy runs/search tasks, candidates and rule versions, then set `jobs.current_rule_version=0`. For runs, delete tasks, plans, campaigns and legacy runs/search tasks. For results, delete candidates so foreign-key cascades clear assessments, reviews, task links and search fits.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- --run tests/job-reset-api.test.ts`

Expected: all reset API tests pass.

### Task 2: Rules empty state and regeneration

**Files:**
- Modify: `src/server/services/job-pack.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Test: `tests/job-reset-api.test.ts`

**Interfaces:**
- Produces: `POST /api/jobs/:jobId/rules/regenerate` returning a new v1 draft.
- The route is valid only when `current_rule_version=0` and reuses the existing DeepSeek job-pack generator.

- [ ] **Step 1: Add failing regeneration tests**

Assert regeneration creates v1 from preserved title/source text after a rules reset and rejects regeneration while a rule version exists.

- [ ] **Step 2: Run focused tests and observe failure**

Run: `npm.cmd test -- --run tests/job-reset-api.test.ts`

Expected: FAIL because regeneration is missing.

- [ ] **Step 3: Implement regeneration and nullable rule response**

Allow `GET /api/jobs/:jobId` to return `pack: null` at version 0. Add the regeneration route using the configured DeepSeek provider and existing `createJobPack` persistence pattern without creating a duplicate job.

- [ ] **Step 4: Run focused tests**

Expected: regeneration and reset tests pass.

### Task 3: Three confirmed reset controls

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`
- Test: `tests/client-reset.test.tsx`

**Interfaces:**
- Consumes: `api.resetSection(id, section)` and `api.regenerateRules(id)`.
- Produces: visible reset button in each requested section and a rules empty state.

- [ ] **Step 1: Write failing client contract tests**

Assert the API methods target all four new endpoints, the three Chinese button labels are rendered in source, each action calls `window.confirm`, and success clears the relevant state.

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npm.cmd test -- --run tests/client-reset.test.tsx`

Expected: FAIL because reset controls are missing.

- [ ] **Step 3: Implement controls and refresh behavior**

Add a reusable `resetSection(section)` handler. Rules reset clears pack/plan/campaign/task/history/results/changes; runs reset clears plan/campaign/task/history/demo; results reset clears results. Add disabled destructive styling and regeneration CTA for `pack === null`.

- [ ] **Step 4: Run focused client tests**

Expected: all client reset tests pass.

### Task 4: Full verification and delivery

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full verification**

Run: `npm.cmd run verify`

Expected: all tests, typecheck, and build pass.

- [ ] **Step 2: Run lint**

Run: `npm.cmd run lint`

Expected: zero lint errors.

- [ ] **Step 3: Commit and push**

Commit adaptive behavior separately from reset feature where practical, then push `codex/gulu-v1.3.0`.

- [ ] **Step 4: Restart and smoke test**

Restart the local service from the verified build. Confirm health, extension online state, three buttons in the UI, and normal adaptive search without clicking any real-data reset button.
