# Role Core Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search role business cores instead of over-specific seniority titles while preserving safe short functional titles.

**Architecture:** Add a pure role-term normalizer in the adaptive search service. Apply it both when task steps become atomic and when campaign alternatives are enumerated, so every probe uses the same normalized vocabulary.

**Tech Stack:** TypeScript, Node, Vitest, Chrome Manifest V3 runtime.

## Global Constraints

- Result counts from 1 through 100 trigger candidate reading.
- Role broadening changes retrieval terms only; approved rules and audit data remain unchanged.
- Never broaden `产品经理` or `客户经理` to two-character nouns.

---

### Task 1: Role core normalization

**Files:**
- Modify: `src/server/services/adaptive-search.ts`
- Test: `tests/adaptive-search.test.ts`

**Interfaces:**
- Produces: `broadenRoleSearchTerm(value: string): string`
- Consumes: role strings from confirmed campaign filters.

- [ ] Add failing tests for `渠道销售部总经理 -> 渠道销售`, `渠道业务总监 -> 渠道业务`, and preservation of `产品经理`.
- [ ] Run the focused test and verify exact titles are currently returned unchanged.
- [ ] Implement suffix removal with the short-core guard for ordinary manager titles.
- [ ] Apply the helper in atomic task filters and campaign combination enumeration.
- [ ] Run adaptive and campaign service tests and verify they pass.

### Task 2: Verification and live acceptance

**Files:**
- Modify only if verification exposes a defect.

- [ ] Run the complete test suite, typecheck, build, and lint.
- [ ] Commit and push `codex/gulu-v1.3.0`.
- [ ] Restart the local service and confirm the extension reconnects.
- [ ] Stop the paused 62-probe zero-result task, create a fresh task from the same confirmed campaign, and verify the first task snapshot uses a broadened role.
- [ ] Confirm a 1–100 result immediately starts unique candidate traversal; if no direction returns candidates, report all tested cores and counts without claiming success.
