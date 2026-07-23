# 规则审核反馈与搜索策略智能化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复规则多行编辑，增加可追溯的 DeepSeek 岗位变化分析和全程按钮反馈，并用 Pro 策略模型与本地质量门提升所有岗位的搜索战役质量。

**Architecture:** `JobChangeAnalysis` 作为共享契约贯穿 DeepSeek、SQLite、API 和 React。策略类 AI 调用使用独立模型配置，候选评分继续走 Flash；战役生成后由本地编译器约束为单维种子、覆盖公司与职位、可追溯且预算合法的步骤。

**Tech Stack:** React 19、TypeScript、Express、Node SQLite、Zod、Vitest、DeepSeek OpenAI-compatible API。

## Global Constraints

- 所有 AI 行为只使用 DeepSeek。
- 候选人评分继续使用 `deepseek-v4-flash`；变化分析、变化整合和搜索战役默认使用 `deepseek-v4-pro` thinking high。
- 不降低候选结果的 70 分展示门槛。
- 不新增谷露写操作，不读取受限制的候选隐私字段。
- 所有生产代码必须先有失败测试。

---

### Task 1: 保留规则编辑中的换行

**Files:**
- Modify: `src/client/App.tsx`
- Test: `tests/client-rule-editor.test.tsx`

**Interfaces:**
- Consumes: `RuleList.value: string[]`
- Produces: `RuleList` 的本地草稿字符串，失焦时调用 `onChange(splitRules(draft))`

- [ ] **Step 1: 写失败测试**

```tsx
render(<RuleList title="硬条件" value={["深圳"]} onChange={onChange} />);
await user.click(screen.getByRole("textbox"));
await user.keyboard("{End}{Enter}");
expect(screen.getByRole("textbox")).toHaveValue("深圳\n");
```

- [ ] **Step 2: 运行失败测试**

Run: `npm.cmd test -- --run tests/client-rule-editor.test.tsx`

Expected: FAIL，当前受控值立即变回 `"深圳"`。

- [ ] **Step 3: 最小实现**

`RuleList` 使用 `useEffect/useState` 保存 `draft`，`onChange` 只更新草稿，`onBlur` 使用以下函数提交：

```ts
export const splitRules=(value:string)=>value
  .split(/\r?\n|,|，/)
  .map(item=>item.trim())
  .filter(Boolean);
```

- [ ] **Step 4: 运行测试**

Run: `npm.cmd test -- --run tests/client-rule-editor.test.tsx`

Expected: PASS。

### Task 2: 持久化岗位变化 AI 分析

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/db/migrate.ts`
- Modify: `src/server/services/job-changes.ts`
- Modify: `src/server/services/deepseek.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/api.ts`
- Test: `tests/api.test.ts`
- Test: `tests/db.test.ts`
- Test: `tests/deepseek.test.ts`

**Interfaces:**
- Produces: `JobChangeAnalysisSchema`, `DeepSeekProvider.analyzeJobChange(pack,text)`
- Produces: `JobChangeService.create(jobId,text,analysis)`
- Changes: `POST /api/jobs/:jobId/changes` 返回包含 `analysis` 的 `JobChangeNote`

- [ ] **Step 1: 写契约、迁移和 API 失败测试**

```ts
expect(change.data.analysis).toMatchObject({
  summary:"新增跨境物流经验",
  impacts:[{section:"constraints.soft",action:"add"}],
});
expect(history.data.items[0].analysis).toEqual(change.data.analysis);
```

并验证 DeepSeek 失败时 `job_change_notes` 仍为 0 条。

- [ ] **Step 2: 运行失败测试**

Run: `npm.cmd test -- --run tests/api.test.ts tests/db.test.ts tests/deepseek.test.ts`

Expected: FAIL，`analysis` 与数据库列不存在。

- [ ] **Step 3: 实现共享契约和 migration 9**

```ts
export const JobChangeAnalysisSchema=z.object({
  summary:z.string().trim().min(1),
  impacts:z.array(z.object({
    section:z.enum(["constraints.hard","constraints.soft","companies.target","roles.exact","evidence.required","evidence.negative","questions"]),
    action:z.enum(["add","replace","remove","review"]),
    values:z.array(z.string().trim().min(1)).max(20),
    reason:z.string().trim().min(1),
  })).max(20),
  questions:z.array(z.string().trim().min(1)).max(10).default([]),
  model:z.string().min(1),
});
```

`job_change_notes.analysis_json` 默认 `NULL`，旧数据解析为 `analysis:null`。

- [ ] **Step 4: 实现 DeepSeek 分析与异步保存**

`analyzeJobChange` 只输出上述结构；API 在模型成功后才写数据库。整合输入使用：

```ts
changes: notes.map(note=>({text:note.text,analysis:note.analysis}))
```

- [ ] **Step 5: 运行测试**

Run: `npm.cmd test -- --run tests/api.test.ts tests/db.test.ts tests/deepseek.test.ts`

Expected: PASS。

### Task 3: 让岗位变化与所有异步按钮有明确反馈

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`
- Modify: `src/client/v12.css`
- Test: `tests/client-rule-editor.test.tsx`
- Test: `tests/client-v12.test.tsx`

**Interfaces:**
- Produces: `busyAction: string | null`
- Produces: `beginAction(id,label)` 与 `finishAction()`
- Consumes: `JobChangeNote.analysis`

- [ ] **Step 1: 写失败测试**

```tsx
await user.click(screen.getByRole("button",{name:"分析并保存变化"}));
expect(screen.getByRole("button",{name:"DeepSeek 正在分析…"})).toBeDisabled();
expect(await screen.findByText(/影响栏目：加分项/)).toBeVisible();
```

另验证整合按钮在 Promise 未完成时显示“正在整合 1 条变化…”。

- [ ] **Step 2: 运行失败测试**

Run: `npm.cmd test -- --run tests/client-rule-editor.test.tsx tests/client-v12.test.tsx`

Expected: FAIL，按钮标签和分析卡片不存在。

- [ ] **Step 3: 实现动作状态与分析卡片**

每个异步处理器在请求前调用：

```ts
beginAction("integrate",`正在整合 ${ids.length} 条变化…`);
```

并在 `finally` 调用 `finishAction()`。`JobChangesPanel` 渲染摘要、影响栏目、建议值和待确认问题。

- [ ] **Step 4: 实现通用按钮视觉反馈**

```css
button:not(:disabled):active,.button:not([aria-disabled="true"]):active {
  transform: translateY(1px) scale(.985);
}
button:focus-visible,.button:focus-visible {
  outline: 3px solid rgba(68,118,255,.35);
  outline-offset: 2px;
}
```

- [ ] **Step 5: 运行测试**

Run: `npm.cmd test -- --run tests/client-rule-editor.test.tsx tests/client-v12.test.tsx`

Expected: PASS。

### Task 4: 为策略任务启用 V4 Pro thinking high

**Files:**
- Modify: `src/server/services/deepseek.ts`
- Modify: `.env.example`
- Test: `tests/deepseek.test.ts`
- Test: `tests/deepseek-campaign.test.ts`

**Interfaces:**
- Produces: `DeepSeekRequestProfile={model?:string;thinking?:boolean;reasoningEffort?:"low"|"medium"|"high"}`
- Changes: `generateJson(...,profile?)`

- [ ] **Step 1: 写失败测试**

捕获三类请求体并断言：

```ts
expect(strategyBody).toMatchObject({
  model:"deepseek-v4-pro",
  thinking:{type:"enabled"},
  reasoning_effort:"high",
});
expect(candidateBody.model).toBe("deepseek-v4-flash");
```

- [ ] **Step 2: 运行失败测试**

Run: `npm.cmd test -- --run tests/deepseek.test.ts tests/deepseek-campaign.test.ts`

Expected: FAIL，所有请求仍使用同一个 `this.model`。

- [ ] **Step 3: 实现请求 profile**

```ts
const strategyProfile={
  model:process.env.DEEPSEEK_STRATEGY_MODEL??"deepseek-v4-pro",
  thinking:true,
  reasoningEffort:"high" as const,
};
```

仅 `analyzeJobChange`、`integrateJobChanges`、`generateGuluCampaign` 使用它。

- [ ] **Step 4: 运行测试**

Run: `npm.cmd test -- --run tests/deepseek.test.ts tests/deepseek-campaign.test.ts`

Expected: PASS。

### Task 5: 编译高质量自适应搜索战役

**Files:**
- Modify: `src/server/services/deepseek.ts`
- Modify: `src/server/services/gulu-campaign.ts`
- Test: `tests/deepseek-campaign.test.ts`
- Test: `tests/gulu-campaign.test.ts`

**Interfaces:**
- Produces: `campaignQualityIssues(campaign,pack,sourceNotes): string[]`
- Ensures: 4–8 步、公司/职位覆盖、初始单维、合法来源、预算 ≤150

- [ ] **Step 1: 写失败测试**

模型返回三个相似的多维步骤时，期望结果：

```ts
expect(result.data.steps.length).toBeGreaterThanOrEqual(4);
expect(result.data.steps.every(step=>activeDimensions(step.filters)===1)).toBe(true);
expect(result.data.steps.some(step=>step.filters.companies.length)).toBe(true);
expect(result.data.steps.some(step=>step.filters.roles.length)).toBe(true);
```

- [ ] **Step 2: 运行失败测试**

Run: `npm.cmd test -- --run tests/deepseek-campaign.test.ts tests/gulu-campaign.test.ts`

Expected: FAIL，当前生成器保留多维初始步骤或覆盖不足。

- [ ] **Step 3: 强化生成协议**

提示词明确要求单维种子、`>40` 收窄、`1–40` 读取、`0` 换向、禁止空集超集，并要求每步输出 rationale、expectedSignals 与来源。

- [ ] **Step 4: 实现本地编译器**

把每个生成步骤原子化为一个主维度；使用批准规则补齐缺失的公司/职位方向；按 fingerprint 去重；最终调用 `campaignQualityIssues`，非空则抛出 `invalid_campaign`。

- [ ] **Step 5: 运行测试**

Run: `npm.cmd test -- --run tests/deepseek-campaign.test.ts tests/gulu-campaign.test.ts`

Expected: PASS。

### Task 6: 完整验证与真实网站验收

**Files:**
- Verify all modified files

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: 可运行的本机 v1.3.0 网站

- [ ] **Step 1: 完整自动验证**

Run: `npm.cmd run verify`

Expected: typecheck、全部 Vitest、build 通过。

- [ ] **Step 2: lint**

Run: `npm.cmd run lint`

Expected: exit 0。

- [ ] **Step 3: 本机交互验收**

重启 4318 服务，打开亦邦岗位并验证：

1. 规则框输入回车后保留；
2. 保存变化时显示分析中；
3. 分析卡片显示影响栏目；
4. 整合按钮持续显示处理中并生成新草稿版本；
5. 生成搜索战役时请求使用 Pro，结果包含单维公司与职位方向；
6. 不批准临时测试规则、不启动新的正式谷露任务。

- [ ] **Step 4: 提交与推送**

```powershell
git add src tests .env.example docs/superpowers/plans/2026-07-23-rule-review-feedback-and-strategy-intelligence.md
git commit -m "feat(rules): add AI change analysis and smarter strategy"
git push origin codex/gulu-v1.3.0
```

