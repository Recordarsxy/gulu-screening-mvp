# Hierarchical Filter Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real Gulu hierarchical filters select visible second-level nodes even when their checkbox HTML value is empty.

**Architecture:** Keep ordinary selection inside `applyFilterValue`. If an approved city/industry/function tree remains unresolved, use a narrowly scoped Chrome MAIN-world fallback to trigger the page's jqTree handler, then validate the selected control state before submitting the filter.

**Tech Stack:** Chrome Extension JavaScript, JSDOM, Vitest, TypeScript

## Global Constraints

- Keep the fixed all-talent saved search `savedSearchId=94096`.
- Block every owner filter and `type=contact` before candidate reads.
- Do not read or write candidate contact or private fields.
- Do not silently skip an unresolved confirmed filter.

---

### Task 1: Empty-value hierarchical node compatibility

**Files:**
- Modify: `tests/gulu-adapter-contract.test.ts`
- Modify: `extension/gulu-adapter.js`

**Interfaces:**
- Consumes: `applyFilterValue(field, value, {doc})`.
- Produces: The existing `{accepted:true, field, value, committed:true}` result for a matched hierarchical node whose checkbox value is empty.

- [ ] **Step 1: Write the failing test**

Add a JSDOM industry tree containing a visible `Gaming 游戏` level-2 title and `<input type="checkbox" value="">`. Simulate the widget storing a non-empty hidden value and selected title only after confirmation, then expect `applyFilterValue('industries','游戏')` to resolve.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --configLoader runner --config vitest.config.mts tests/gulu-adapter-contract.test.ts`

Expected: FAIL with `filter_value_unresolved:industries:游戏` because the production selector rejects the empty checkbox value.

- [ ] **Step 3: Write minimal implementation**

Change the tree choice from requiring both title and non-empty checkbox value to requiring the associated checkbox element. After confirmation, accept only when the selected title is not `请选择` or the hidden value is non-empty; otherwise throw the existing unresolved error.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run --configLoader runner --config vitest.config.mts tests/gulu-adapter-contract.test.ts`

Expected: all adapter contract tests pass, including the existing city tree test.

- [ ] **Step 5: Run full verification**

Run: `npm run verify && npm run lint`

Expected: typecheck, all test files, build, and lint pass.

- [ ] **Step 6: Commit and push**

Stage only the design, plan, adapter, and adapter test. Commit with `fix(extension): support hierarchical filter nodes`, then push `codex/gulu-v1.3.0`.

### Task 2: Live Meshy validation

**Files:**
- No production file changes expected.

**Interfaces:**
- Consumes: confirmed Meshy campaign and the updated auto-reloading extension.
- Produces: a fresh run and recorded strategy evidence that the `游戏` industry condition either probes a real count or cleanly transitions without adapter failure.

- [ ] **Step 1: Restart the local service and verify connector state**

Confirm the branch is clean, service answers on port 4318, and the extension reports version 1.3.0 online after revision reload.

- [ ] **Step 2: Preserve the failed run and create a fresh run**

Keep `c9d6a136-ddf2-490d-9b10-acde972802ab` as failure history. Start a new formal run from preflight against the same confirmed Meshy campaign.

- [ ] **Step 3: Monitor the real filter application**

Confirm the effective URL keeps `savedSearchId=94096`, contains no `owner__` and no `type__eq=contact`, and the `游戏` filter no longer produces `filter_value_unresolved`.

- [ ] **Step 4: Record outcome**

Report the fresh task ID, effective filter evidence, result count/action, and whether candidate reading began. Do not create a v1.3.0 tag or Release.

### 2026-07-23 addendum: unavailable taxonomy labels

- [x] Add a failing adapter regression test that distinguishes an absent tree node from an unresolved existing node.
- [x] Emit `filter_unavailable` and let the adaptive planner mark the current fingerprint as tried without claiming a real zero-result search.
- [x] Keep existing-node commit failures as `needs_attention`.
- [x] Run full verification (168 tests, typecheck, build, lint).
- [ ] Push the revision and repeat the fresh formal Meshy run through the formerly blocking labels.
