# DeepSeek Job Pack Truncation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover once from a length-truncated DeepSeek job-pack response and complete the Meshy AI real-case workflow.

**Architecture:** Keep the shared JSON default at 1,800 tokens. Give job-pack generation a 4,000-token first attempt, classify `finish_reason: length`, and retry that error once with 7,000 tokens.

**Tech Stack:** TypeScript, DeepSeek Chat Completions API, Zod, Vitest, React/Express.

## Global Constraints

- Do not retry authentication, rate-limit, network, empty-response, or ordinary invalid-JSON failures.
- Never persist a partial job pack.
- Preserve the existing `generateJobPack` public signature.

---

### Task 1: Truncation classification and bounded retry

**Files:**
- Modify: `tests/deepseek.test.ts`
- Modify: `src/server/services/deepseek.ts`

**Interfaces:**
- Consumes: `DeepSeekProvider.generateJobPack(base, sourceText, signal?)`
- Produces: `generateJson(instruction, payload, signal?, maxTokens?)` and `DeepSeekError('response_truncated')`

- [ ] **Step 1: Write a failing test**

Add a test whose fetcher returns `finish_reason: length` on the first call and a valid job pack on the second. Assert two calls and request budgets `[4000, 7000]`. Add a second test asserting an API error makes one call.

- [ ] **Step 2: Verify RED**

Run `npm.cmd test -- tests/deepseek.test.ts`; expect the truncation-recovery test to fail with `empty_response`.

- [ ] **Step 3: Implement the minimal behavior**

Read `finish_reason`, throw `response_truncated` for `length`, accept an optional token budget, and retry only that error once inside `generateJobPack`.

- [ ] **Step 4: Verify GREEN**

Run `npm.cmd test -- tests/deepseek.test.ts`; expect all DeepSeek tests to pass.

### Task 2: Full and real-case verification

**Files:**
- No production files beyond Task 1.

**Interfaces:**
- Consumes: built server and existing local `.env` DeepSeek configuration.
- Produces: a persisted Meshy AI draft job pack visible in the local website.

- [ ] **Step 1: Run project verification**

Run `npm.cmd run verify`, `npm.cmd run lint`, and `git diff --check`; all must exit zero.

- [ ] **Step 2: Restart the local service from the verified build**

Stop only the known Node service process for this worktree, then launch `node --env-file-if-exists=.env dist-server/server/index.js` hidden.

- [ ] **Step 3: Run the Meshy AI browser case**

Submit the original request and JD, wait for the generated draft, and inspect its visible rules.

- [ ] **Step 4: Verify persistence and safety**

Confirm exactly one Meshy test job exists, it remains a draft, and no Gulu screening task was created.

