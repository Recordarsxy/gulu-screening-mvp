# Atomic Adaptive Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent same-field alternatives from replacing one another in Gulu and make result-count-driven search deterministic.

**Architecture:** Keep the confirmed campaign as the pool of alternatives, but persist an atomic task-step snapshot containing at most one value per field. The adaptive planner uses the campaign pool to add a different dimension for broad results and to replace an existing dimension for empty results.

**Tech Stack:** TypeScript, Node `node:sqlite`, Chrome Manifest V3 JavaScript, Vitest.

## Global Constraints

- Read only when the effective result count is between 1 and 100.
- Keep `savedSearchId=94096`; reject owner filters and `type=contact` before reading.
- DeepSeek may generate strategy and assess fit, but may not control the browser or reject a candidate by itself.
- Do not read contact or private fields and do not perform Gulu writes.

---

### Task 1: Atomic task-step snapshots

**Files:**
- Modify: `src/server/services/adaptive-search.ts`
- Modify: `src/server/services/gulu.ts`
- Test: `tests/gulu-campaign-service.test.ts`

**Interfaces:**
- Produces: `atomicSearchFilters(filters: GuluFilters): GuluFilters`
- Consumes: confirmed `GuluSearchCampaign.steps`

- [ ] Add a service test that starts a campaign whose company step contains five values and expects the stored current step to contain only the first.
- [ ] Run the focused test and confirm it fails because all five values are stored.
- [ ] Implement `atomicSearchFilters` and apply it when task-step snapshots are inserted.
- [ ] Run the focused service test and confirm it passes.

### Task 2: Empty-result alternative selection

**Files:**
- Modify: `src/server/services/adaptive-search.ts`
- Test: `tests/adaptive-search.test.ts`

**Interfaces:**
- Consumes: current atomic filters, confirmed campaign alternatives, tried fingerprints, result count.
- Produces: `AdaptiveProbeDecision` with `read`, `refine`, or `next_step`.

- [ ] Add a planner test that expects a zero-result company seed to switch to the next company without adding a role.
- [ ] Run the focused test and confirm it fails with the current combination ordering.
- [ ] Rank untried candidates so empty results first replace a populated field, while broad results only add a dimension and retain current values.
- [ ] Run both adaptive and campaign service tests and confirm they pass.

### Task 3: Verification and live acceptance

**Files:**
- Modify only if a failing verification exposes a defect.

- [ ] Run `npm test` and confirm the complete suite passes.
- [ ] Run `npm run typecheck`, `npm run build`, and `npm run lint`.
- [ ] Commit and push `codex/gulu-v1.3.0`.
- [ ] Start a fresh formal task and verify the URL remains on saved search 94096 without forbidden filters.
- [ ] Confirm the first atomic company is applied, a broad result is refined with another dimension, an empty result switches alternatives, and a bounded result begins unique candidate traversal.
