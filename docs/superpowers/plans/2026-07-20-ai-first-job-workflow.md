# AI-First Job Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek generate a complete reviewable job pack before persistence, keep the fresh-task entry visible with readiness guidance, and add recoverable job archiving.

**Architecture:** Keep synchronous job creation, but raise the bounded DeepSeek deadline to 60 seconds and fail atomically instead of persisting a fallback pack. Add a schema-v6 `archived_at` column with explicit archive/restore endpoints, and keep UI workflow state in the existing React app. Preserve the existing formal-task safety gates and connector protocol.

**Tech Stack:** TypeScript, Express, React, Node SQLite, Vitest, Vite, DeepSeek JSON API.

## Global Constraints

- DeepSeek remains the only AI provider.
- A failed AI generation must not create a job row or rule version.
- Unknown customer requirements remain questions or soft conditions, never invented hard exclusions.
- Archived jobs preserve every database relation and uploaded JD file.
- A job with an active Gulu task cannot be archived.
- A real dry-run may fill Gulu controls but must not submit a search, read candidates, or write Gulu data.

---

### Task 1: Atomic AI-first job creation

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/services/deepseek.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/api.ts`
- Test: `tests/api.test.ts`
- Test: `tests/client-v12.test.tsx`

**Interfaces:**
- Consumes: `DeepSeekProvider.generateJobPack(base, safeSourceText, signal)`.
- Produces: `POST /api/jobs` and `/api/jobs/import` return `201 JobPack` only after valid AI output; failures return `{error:'job_pack_generation_timeout'|'job_pack_generation_failed'}` without persistence.

- [ ] **Step 1: Replace the fallback test with atomic failure tests**

Add API assertions that a delayed provider with `jobPackTimeoutMs:10` returns `503`, error `job_pack_generation_timeout`, and `GET /api/jobs` remains empty. Add a provider error case expecting `job_pack_generation_failed` and an empty list.

```ts
expect(created).toMatchObject({status:503,data:{error:'job_pack_generation_timeout'}});
expect((await request('/api/jobs')).data.items).toHaveLength(0);
```

- [ ] **Step 2: Run the API tests and verify RED**

Run: `npm.cmd test -- tests/api.test.ts`

Expected: FAIL because the current route returns `201` with `ai_generation:'fallback'`.

- [ ] **Step 3: Implement a 60-second atomic generator**

Change the default deadline to `60_000`. Return the generated pack on success; on abort throw `job_pack_generation_timeout`; on all other provider or schema failures throw `job_pack_generation_failed`. Call `createDraft` only after this helper resolves.

```ts
const generateInitialPack=async(base:JobPack,safeSource:string)=>{
  if(!deepSeek.isConfigured())throw new Error('job_pack_generation_failed');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.max(1,jobPackTimeoutMs));
  try{return await deepSeek.generateJobPack(base,safeSource,controller.signal);}
  catch(error){
    if(controller.signal.aborted)throw new Error('job_pack_generation_timeout');
    throw new Error('job_pack_generation_failed');
  }finally{clearTimeout(timeout);}
};
```

Map both codes to HTTP 503 in the Express error handler. Do not include provider response bodies or secrets.

- [ ] **Step 4: Add UI failure/retry expectations and verify RED**

Update `tests/client-v12.test.tsx` to require “最长约 60 秒”, Chinese mappings for both stable error codes, and absence of `created.ai_generation==='fallback'`.

Run: `npm.cmd test -- tests/client-v12.test.tsx`

Expected: FAIL because the UI still describes a 5–15 second fallback.

- [ ] **Step 5: Implement AI-first UI state**

Keep `title`, `source`, and `file` unchanged on failure. Disable “生成岗位包” with `disabled={busy}` and change its label while busy. Map timeout to “DeepSeek 分析超过 60 秒，请重新生成”，and other generation failure to “DeepSeek 未能生成有效岗位包，请检查连接后重试”. Clear creation fields only after success.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm.cmd test -- tests/api.test.ts tests/client-v12.test.tsx tests/deepseek.test.ts`

Expected: PASS.

Commit: `fix: require AI-generated job packs`

---

### Task 2: Recoverable job archiving

**Files:**
- Modify: `src/server/db/migrate.ts`
- Create: `src/server/services/job-archive.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`
- Test: `tests/db.test.ts`
- Create: `tests/job-archive.test.ts`
- Modify: `tests/client-v12.test.tsx`

**Interfaces:**
- Produces: `archiveJob(db, jobId)` and `restoreJob(db, jobId)` returning `{id,archivedAt}`.
- Produces: `POST /api/jobs/:jobId/archive`, `POST /api/jobs/:jobId/restore`, and `GET /api/jobs?archived=true`.

- [ ] **Step 1: Add failing migration and service tests**

Require schema version 6 and `jobs.archived_at`. Test that archive preserves rule/task/candidate counts, restore clears the timestamp, missing jobs return `job_not_found`, and task statuses `queued`, `running`, `paused`, or `needs_attention` return `job_has_active_task`.

```ts
expect(db.prepare('SELECT archived_at FROM jobs WHERE id=?').get(jobId)).toMatchObject({archived_at:expect.any(String)});
expect(()=>archiveJob(db,activeJobId)).toThrowError('job_has_active_task');
```

- [ ] **Step 2: Run archive tests and verify RED**

Run: `npm.cmd test -- tests/db.test.ts tests/job-archive.test.ts`

Expected: FAIL because schema v6 and archive service do not exist.

- [ ] **Step 3: Add schema v6 and archive service**

Add `archived_at TEXT` once using `PRAGMA table_info(jobs)` in a transaction. Implement archive as one guarded `UPDATE`, never `DELETE`; implement restore as `UPDATE jobs SET archived_at=NULL`.

```ts
const active=db.prepare("SELECT 1 FROM gulu_tasks WHERE job_id=? AND status IN ('queued','running','paused','needs_attention') LIMIT 1").get(jobId);
if(active)throw new Error('job_has_active_task');
db.prepare('UPDATE jobs SET archived_at=CURRENT_TIMESTAMP WHERE id=?').run(jobId);
```

- [ ] **Step 4: Add failing API list tests**

Verify default `GET /api/jobs` excludes archived rows, `?archived=true` returns only archived rows, archive returns 200, restore returns 200, and active-task archive returns 409.

- [ ] **Step 5: Implement archive routes and filtered lists**

Select `archived_at` in summaries. Parse only the exact query value `true` as the archive view. Add stable error mappings: `job_not_found` to 404 and `job_has_active_task` to 409 for archive routes.

- [ ] **Step 6: Add failing UI expectations, then implement UI**

Require “归档”, “已归档岗位”, “恢复”, and “请先停止当前任务”. Add a separate archive control per job row, a confirmation dialog, and a collapsed archive section. Refresh both active and archived collections after either action; never call the existing permanent delete endpoint.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm.cmd test -- tests/db.test.ts tests/job-archive.test.ts tests/api.test.ts tests/client-v12.test.tsx`

Expected: PASS.

Commit: `feat: add recoverable job archiving`

---

### Task 3: Always-visible fresh-task readiness card

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`
- Test: `tests/client-v12.test.tsx`

**Interfaces:**
- Consumes: selected `pack`, optional `plan`, and optional current `task`.
- Produces: a readiness checklist and the existing `setConfirmFresh(true)` action.

- [ ] **Step 1: Write a failing UI contract test**

Require the six labels “岗位规则已批准”, “搜索方案已生成”, “搜索方案已人工确认”, “dry-run 已完成”, “真实 5 人试跑已完成”, and “当前没有运行中的任务”. Require the fresh-task button outside the `plan&&` conditional.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `npm.cmd test -- tests/client-v12.test.tsx`

Expected: FAIL because the current button is hidden until a confirmed plan exists.

- [ ] **Step 3: Implement readiness derivation and card**

Create a six-item array of `{label,complete}` values. Render it at the top of the real Gulu panel for every selected job. Keep the button disabled until every item is complete; display each unmet condition inline. Keep the existing confirmation dialog unchanged and only open it when `plan` and `pack` exist.

- [ ] **Step 4: Run UI tests and commit**

Run: `npm.cmd test -- tests/client-v12.test.tsx tests/client.test.tsx`

Expected: PASS.

Commit: `feat: show fresh-task readiness`

---

### Task 4: Full verification and real no-submit dry-run

**Files:**
- Modify only if verification exposes an in-scope defect.

**Interfaces:**
- Consumes: local v1.2 service, paired extension, confirmed plan, logged-in Gulu session.
- Produces: a completed `dry-run` task whose counters remain zero and whose extension action only fills controls.

- [ ] **Step 1: Run repository verification**

Run: `npm.cmd run verify`

Expected: 21+ test files pass, typecheck succeeds, and Vite/server production builds succeed.

- [ ] **Step 2: Run lint and whitespace checks**

Run: `npm.cmd run lint`

Run: `git diff --check`

Expected: both exit 0.

- [ ] **Step 3: Restart the v1.2 local service**

Close only the old MVP service process bound to port 4318, then launch `启动谷露筛选MVP.cmd`. Verify `GET /api/health` returns version `1.2.0` and connector status reports paired extension and online Gulu.

- [ ] **Step 4: Select an approved job and confirmed plan**

Use read-only API calls to list jobs and plans. Prefer the existing Air8 job. If no approved/confirmed job exists, use the UI/API to approve the current AI draft and confirm its plan only when its content is already user-approved; do not invent approval.

- [ ] **Step 5: Start and observe dry-run**

Call `POST /api/jobs/:jobId/runs/gulu` with `{"mode":"dry-run"}`. Poll the task until `completed` or `needs_attention`. Confirm `readCount=0`, `analyzedCount=0`, no candidate links were created, and the extension reports no submit/read event.

- [ ] **Step 6: Commit and push final implementation**

Stage only intended source, test, migration, and plan files. Commit any remaining integration changes, push `codex/gulu-v1.2.0`, and report the dry-run task ID plus evidence. Do not create the `v1.2.0` tag or Release until the later real five-person trial succeeds.

