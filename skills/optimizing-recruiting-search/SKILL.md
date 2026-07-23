---
name: optimizing-recruiting-search
description: Use when generating or improving candidate-search strategies for any approved job, especially when searches are too narrow, taxonomy labels may not exist, broad results need refinement, or candidate match scores lack auditable evidence.
---

# Optimizing Recruiting Search

Turn an approved job profile into an adaptive, evidence-based search campaign. Use DeepSeek for AI reasoning, but keep thresholds, privacy controls, deduplication, and total-score calculation deterministic.

## Build the search space

1. Extract broad role families before exact titles. Prefer `channel sales` over `channel sales general manager` unless the exact title is proven necessary.
2. Separate independent axes: role/capability, market/customer, product/industry, company, location, and outcome evidence.
3. Start with one strong axis. Add only one orthogonal axis at a time so every narrowing decision is explainable.
4. Treat generated labels as hypotheses. Resolve them against the target system's real taxonomy before using structured filters.
5. When a structured taxonomy value is unavailable, remove it and retry the same semantic value as a plain keyword. Record `taxonomy_keyword_fallback`.

## Adapt by observed result count

- `0`: do not wait. Replace the narrowest or unavailable term with a broader synonym or move to the next independent direction.
- `1-40`: stop adding filters and read candidates.
- `>40`: add one orthogonal keyword or verified taxonomy filter, then measure again.
- Never switch away from a non-empty search before either reading candidates or recording why refinement is required.

Read at most five new candidates in a batch. Deduplicate by stable candidate identity across every step and never reopen an already-read profile.

## Score from evidence

Ask DeepSeek for seven dimensions with fixed weights:

- core capability 25
- market/customer context 20
- product/industry context 15
- scope/level 15
- outcome evidence 15
- transferable signals 5
- interview-only signals 5

Each dimension must include earned points, possible points, confidence, explicit resume evidence, and gaps. The server calculates the total; ignore any total supplied by the model. Missing information becomes a verification question, not a negative fact.

Route candidates by deterministic total:

- `70-100`: high fit; show in Candidate Results unless an approved rule excludes them.
- `55-69`: verification; show in Run Center with evidence, gaps, and questions.
- `<55`: keep in run history only.

AI must never be the sole reason to exclude a candidate.

## Safety and completion

Only read job-relevant public resume fields. Do not read or store phone, email, WeChat, address, photo, notes, or attachments. Do not contact, edit, recommend, download, or otherwise write to the recruiting system. Do not bypass verification challenges.

Stop when the target high-fit count is reached, the approved budget is exhausted, or all independent directions are exhausted. Report counts, tested directions, fallbacks, evidence quality, and unresolved verification questions.
