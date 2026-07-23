# Generalized Recruiting Match Engine Design

## Goal

Improve search recall, evidence quality, and operating efficiency for every approved job while preserving the existing safety boundaries:

- DeepSeek is the only AI provider.
- AI may rank and explain but may not independently reject a candidate.
- Candidate results default to verified high-fit talent only.
- Gulu access remains read-only and excludes phone, email, WeChat, address, photo, notes, and attachments.
- Owner filters and `type=contact` remain forbidden.

The design must solve six observed failures:

1. Resume-opaque requirements such as `vibe coding` are treated as failures instead of unknowns.
2. Broad role terms recall generic candidates without the required market or product context.
3. DeepSeek can generate structured Gulu labels that do not exist.
4. Search-fit scores can be internally inconsistent, for example a positive score with no evidence or gaps.
5. Near-threshold candidates are hidden completely, so users cannot inspect what remains unverified.
6. Repeated candidate analysis and low-yield directions consume unnecessary time and DeepSeek calls.

## Chosen Architecture

Use one canonical runtime policy with a companion Codex Skill.

The runtime policy is authoritative for product behavior. The Skill teaches Codex how to prepare, audit, and evolve the same policy; it does not pretend that DeepSeek can read Codex Skill files.

### Components

1. **Job match profile compiler**
   - Converts every approved job pack into universal matching dimensions.
   - Classifies every requirement as `observable`, `partially_observable`, or `interview_only`.
   - Separates explicit contradiction from missing information.

2. **Gulu taxonomy resolver**
   - Resolves structured city, industry, and function concepts against the real Gulu UI before a formal search.
   - Stores validated mappings and their freshness locally.
   - Produces an execution filter without changing the approved semantic intent.

3. **Structured search-fit scorer**
   - Requires per-dimension points, evidence, gaps, and confidence.
   - Computes the total deterministically from validated dimension scores.
   - Rejects inconsistent DeepSeek output and retries once.

4. **Candidate buckets**
   - `high_fit`: score 70–100; visible in Candidate Results.
   - `verification`: score 55–69; visible only in a dedicated Run Center panel.
   - `low_fit`: score 0–54; retained for strategy metrics but hidden from candidate browsing.

5. **Adaptive efficiency controller**
   - Uses real result counts, unique-candidate yield, and fit distribution to continue, refine, or switch direction.
   - Reuses safe analyses when candidate content, job rule version, and matching policy version are unchanged.

6. **Candidate deep link**
   - Opens the corresponding Gulu candidate detail from both high-fit and verification cards.
   - Only permits validated Gulu candidate-detail URLs.

7. **`optimizing-recruiting-search` Skill**
   - Guides job-profile compilation, search-direction design, taxonomy auditing, score calibration, and post-run diagnosis.
   - Uses the runtime policy and conformance fixtures as references rather than duplicating policy text.

## Universal Job Match Profile

Every job is compiled into these dimensions. Weights are job-specific and must total 100.

| Dimension | Purpose |
|---|---|
| Core capability | The work the person must be able to perform |
| Market/customer context | Region, customer type, channel, or buying motion |
| Product/industry context | Direct or transferable domain experience |
| Scope/level | Ownership, seniority, team, complexity, or scale |
| Outcome evidence | Quantified delivery, revenue, growth, efficiency, or quality |
| Transferable signals | Adjacent experience that predicts ability to learn the role |
| Interview-only signals | Motivation, tool fluency, culture, or other resume-opaque requirements |

Rules:

- Missing evidence for an observable requirement creates a gap; it is not an explicit contradiction.
- Interview-only requirements do not reduce resume search fit. They become verification questions.
- An explicit contradiction may reduce its dimension score but may not cause AI-only exclusion.
- Search-fit measures retrieval relevance, not hiring disposition.

## Structured Search-Fit Contract

DeepSeek returns:

```json
{
  "dimensions": [
    {
      "id": "core_capability",
      "earned": 18,
      "possible": 25,
      "confidence": "medium",
      "evidence": ["..."],
      "gaps": ["..."]
    }
  ],
  "verificationQuestions": ["..."]
}
```

The server:

- validates that every configured dimension appears once;
- validates `0 <= earned <= possible`;
- calculates the total instead of accepting a free-form total;
- requires evidence for positive points;
- requires a gap when a dimension is not full;
- retries DeepSeek once when the contract is inconsistent;
- stores policy version, dimension breakdown, evidence, gaps, questions, model, and token usage.

The existing 70-point high-fit threshold remains unchanged. The 55-point verification threshold is configurable at policy level but not editable during a run.

## Gulu Taxonomy Resolution

DeepSeek may propose semantic concepts but may not directly submit a structured Gulu tree value.

For each city, industry, or function concept, the resolver performs:

1. exact visible-label match;
2. normalized Chinese/English match;
3. validated local alias match;
4. validated parent-category match;
5. keyword fallback;
6. unavailable classification.

Only matches found in the live Gulu tree may execute as structured filters. A keyword fallback executes in the approved keyword field and records the original concept and fallback term.

Example:

| Semantic concept | Execution | Resolution |
|---|---|---|
| 游戏 | `Gaming 游戏` industry node | exact/normalized |
| 电商 | `E-commerce 电商` industry node | normalized |
| 3D打印 | keyword `3D打印` | no structured node |
| AR/VR | validated alias or keyword | depends on live taxonomy |

Mappings are cached by field, concept, resolved label/value, execution mode, and `checkedAt`. A missing or stale mapping is revalidated before formal execution. The UI shows every mapping in Rule Review before campaign confirmation.

The approved semantic campaign remains immutable. Runtime resolution produces a separate execution plan so a fallback cannot silently broaden or alter user intent.

## Verification Candidate Experience

Candidate Results continues to show only `high_fit`.

Run Center gains a **待验证人才** panel containing score 55–69 candidates. Each card shows:

- name, current company, and current role;
- total score and dimension breakdown;
- matched evidence;
- missing or interview-only information;
- source search direction and query;
- DeepSeek model and analysis time;
- internal review state: `unreviewed`, `verified_fit`, `verified_not_fit`, or `later`.

Internal review changes only local application state and never writes to Gulu.

Run Center also shows per-direction:

- result count;
- candidates opened and unique candidates;
- high-fit and verification counts;
- maximum and median search fit;
- duplicate rate;
- unavailable or remapped taxonomy concepts.

## Candidate Deep Link

High-fit and verification cards expose **在谷露查看**.

The server returns a deep link only when:

- the URL host is exactly `121.43.105.7`;
- the hash route is `candidate/detail`;
- a non-empty candidate ID is present.

The client opens the link synchronously from the user click in a new tab with `noopener,noreferrer`. It does not automatically read, edit, recommend, contact, download, or otherwise mutate the Gulu record. Login and captcha remain user-handled.

## Adaptive Efficiency Policy

Search count behavior:

- `0`: switch direction.
- `1–40`: traverse the complete deduplicated result.
- `41–100`: analyze five unique candidates, then continue only when the direction has high-fit or verification yield, or when the remaining pool is small enough to justify completion.
- `>100`: add one validated narrowing dimension.

Additional controls:

- Resolve taxonomy before count probing.
- Check global Gulu ID dedupe before opening detail.
- Cache analysis by candidate content hash, rule version, and match-policy version.
- Batch up to five sanitized candidates per DeepSeek scoring request while retaining an independent result per candidate.
- Never change direction solely because a tag produced many candidates; refine first.
- Never wait on an unavailable structured tag; resolve to keyword or switch.
- Stop when target shortlist is reached, campaign budget is exhausted, or all distinct directions are exhausted.
- Use only high-fit or human-verified-fit candidates as sources for company expansion.

## Skill Boundary

Create `skills/optimizing-recruiting-search/` with:

- `SKILL.md`: concise workflow and triggers;
- `references/matching-policy.md`: points to the canonical policy and explains how to audit it;
- `references/examples.md`: cross-role conformance examples;
- `agents/openai.yaml`: generated UI metadata.

The Skill is used when preparing or auditing recruitment search strategies, diagnosing low match quality, or extending Gulu taxonomy mappings. It must not contain credentials, candidate data, or job-specific private content.

Skill conformance scenarios cover:

- a sales role with an interview-only tool requirement;
- an engineering role with observable language/framework requirements;
- an operations role with transferable process-improvement evidence;
- a semantic industry concept missing from Gulu taxonomy;
- inconsistent scoring output with points but no evidence.

## Data and API Changes

Add policy-versioned storage for:

- dimension score breakdown;
- verification questions;
- candidate bucket;
- taxonomy resolutions;
- local verification status.

Extend results API with an explicit bucket:

- default or `bucket=high_fit`: high-fit only;
- `bucket=verification`: score 55–69 only.

Never expose `low_fit` candidates through the candidate browsing API. Aggregate low-fit metrics remain available in Run Center.

## Error Handling

- Taxonomy resolution unavailable: pause before candidate reads with the unresolved concepts listed.
- Structured node absent: use an approved keyword fallback or record unavailable; do not submit an empty tree clause.
- DeepSeek schema inconsistency: retry once; after a second failure keep the candidate in local `analysis_error`, do not show or exclude it.
- DeepSeek unavailable: pause analysis and retain the checkpoint; do not create fallback AI scores.
- Invalid deep link: hide the link and record a local diagnostic.
- Privacy assertion failure: abort persistence and cloud analysis for that candidate.

## Migration

- Existing search-fit rows retain their original scores and policy version `legacy`.
- New bucket queries use only rows produced by the new policy unless explicitly viewing historical runs.
- Existing high-fit results remain visible.
- No historical candidate data is deleted by this feature.

## Verification

Automated:

- profile compilation across sales, engineering, and operations fixtures;
- observable versus interview-only missing information;
- deterministic score summation and inconsistent-output retry;
- high-fit and verification API separation;
- taxonomy exact, alias, keyword fallback, stale-cache, and unavailable paths;
- 1–40, 41–100, and >100 adaptive behavior;
- analysis cache and cross-step dedupe;
- deep-link allowlist and client click behavior;
- privacy, DeepSeek-only, typecheck, build, lint, and full regression suite;
- Skill structure and cross-role conformance fixtures.

Live:

- confirm taxonomy mappings are visible before a formal campaign;
- run at least two materially different jobs;
- observe high-fit and verification buckets separately;
- open one candidate from each visible bucket into the correct Gulu detail;
- confirm no owner/contact filters, no sensitive-field reads, no Gulu writes, and no duplicate candidate opens.

No v1.3.0 tag or Release is created until the cross-role live acceptance is complete.
