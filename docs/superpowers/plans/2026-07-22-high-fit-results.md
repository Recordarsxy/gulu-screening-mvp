# High-Fit Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return only task candidates with DeepSeek searchFit of at least 70 from the run-scoped results API.

**Architecture:** Enforce visibility in the server query by joining the current task's `gulu_search_fits` row and applying the existing high-fit threshold. Preserve all stored candidate and audit records.

**Tech Stack:** TypeScript, Express, Node `node:sqlite`, Vitest, Supertest.

## Global Constraints

- High match means `searchFit >= 70`.
- Filtering must not delete candidate, snapshot, assessment, or search-fit records.
- A fit from another task must not affect the current task.

---

### Task 1: Run-scoped high-fit results

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/runs-api.test.ts`

**Interfaces:**
- Consumes: `GET /api/jobs/:jobId/results?runId=:runId`
- Produces: result items whose current-task `searchFit` is at least 70, including the numeric `searchFit` field.

- [ ] Add a failing API test with one score-69 and one score-70 linked candidate.
- [ ] Run the focused test and verify both candidates are currently returned.
- [ ] Join `gulu_search_fits` by task and candidate, select its score, and filter at 70.
- [ ] Run the focused test and verify only the score-70 candidate is returned.
- [ ] Run the complete test, typecheck, build, and lint commands.
- [ ] Commit, push, restart the local service, and verify the live task endpoint no longer returns low-fit candidates.
