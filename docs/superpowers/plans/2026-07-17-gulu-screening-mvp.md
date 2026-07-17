# 谷露简历筛选 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可在 Windows 本机双击启动的谷露简历筛选 MVP，完成岗位包、DeepSeek 辅助、模拟筛选、人工复核和 Excel/CSV 导出。

**Architecture:** 单仓库 TypeScript 应用：Express 提供仅本机 API，React/Vite 提供前端，Node 24 内置 SQLite 持久化。文档、AI、筛选和导出分为可独立测试的服务；谷露插件只交付最小权限安全骨架，未经快照适配不读取真实页面。

**Tech Stack:** Node.js 24、TypeScript、Express、React、Vite、`node:sqlite`、Zod、Mammoth、pdf-parse、docx、ExcelJS、OpenAI SDK（DeepSeek 兼容接口）、Vitest、Playwright。

## Global Constraints

- 服务只监听 `127.0.0.1`，不部署公网，不实现多人账号。
- DeepSeek 默认地址为 `https://api.deepseek.com`，模型默认 `deepseek-v4-flash`但必须可配置。
- API Key 仅从 `DEEPSEEK_API_KEY` 或本机安全凭据获取，不持久化、不回显、不记日志。
- 姓名、联系方式、身份证、住址、照片、谷露 ID 和链接不得进入 AI 请求或日志。
- 信息缺失只能判为“复核”，不能判为“排除”。
- 未批准规则在 UI 和 API 两层均不得启动筛选。
- 谷露边界严格只读；本计划不执行真实谷露自动化。

## File Map

- `package.json`, `tsconfig*.json`, `vite.config.ts`: 构建、开发和测试命令。
- `src/shared/contracts.ts`: Zod Schema 与前后端共享类型。
- `src/server/db/*`: SQLite 连接、迁移、仓储和级联删除。
- `src/server/services/documents.ts`: TXT/DOCX/PDF 本地解析、哈希与 DOCX 生成。
- `src/server/services/redaction.ts`: AI 请求白名单和黑名单脱敏。
- `src/server/services/deepseek.ts`: DeepSeek 配置、JSON 输出、连通性测试和 Token 计量。
- `src/server/services/job-pack.ts`: 岗位包创建、Schema 验证、版本与批准。
- `src/server/services/screening.ts`: 双轮去重、确定性判断、AI 升级、缓存与断点。
- `src/server/services/exports.ts`: Excel/CSV 生成与字段规则。
- `src/server/routes/*`, `src/server/index.ts`: HTTP API、错误边界和静态站点。
- `src/client/*`: 岗位、规则、运行、结果、导出和设置页。
- `extension/*`: Manifest V3 最小权限、本机配对和禁用的空适配器。
- `tests/*`: 单元、API、导出和端到端测试。
- `scripts/*`, `启动谷露筛选MVP.cmd`, `README.md`: Windows 启动、演示数据与交付文档。

---

### Task 1: 应用骨架、共享契约与 SQLite

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`
- Create: `src/shared/contracts.ts`
- Create: `src/server/db/connection.ts`, `src/server/db/migrate.ts`, `src/server/db/repositories.ts`
- Test: `tests/db.test.ts`, `tests/contracts.test.ts`

**Interfaces:**
- Produces: `openDatabase(path): DatabaseSync`, `migrate(db): void`, `createRepositories(db): Repositories`, `JobPackSchema`, `CandidateSchema`, `AssessmentSchema`.

- [ ] **Step 1: 编写失败测试**，要求迁移后包含八张业务表，级联删除岗位后无候选人和评估残留，`JobPackSchema` 拒绝缺少 `decision_policy` 的输入。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/db.test.ts tests/contracts.test.ts`，预期因模块不存在失败。
- [ ] **Step 3: 实现最小结构**，为 `jobs`, `job_rule_versions`, `search_tasks`, `runs`, `candidates`, `assessments`, `human_reviews`, `audit_events` 创建外键、索引和唯一约束，并实现上述三个公开函数。
- [ ] **Step 4: 复跑测试**，预期全部 PASS；运行 `npm.cmd run typecheck`，预期无错误。
- [ ] **Step 5: 提交** `feat: add local data model and shared contracts`。

### Task 2: 本地文档和岗位包生命周期

**Files:**
- Create: `src/server/services/documents.ts`, `src/server/services/job-pack.ts`
- Create: `src/server/routes/jobs.ts`
- Test: `tests/documents.test.ts`, `tests/job-pack.test.ts`, `tests/fixtures/sample.docx`, `tests/fixtures/sample.pdf`

**Interfaces:**
- Consumes: `Repositories`, `JobPackSchema`.
- Produces: `parseSource(input): ParsedSource`, `generateHumanGuide(pack): Promise<Buffer>`, `createDraft(jobId, source): Promise<JobPack>`, `reviseDraft(jobId, patch): JobPack`, `approveVersion(jobId, version): JobPack`.

- [ ] **Step 1: 编写失败测试**：DOCX/PDF 提取预期文本且生成 SHA-256；新建规则为 `draft` v1；修改生成 v2；批准仅更新指定版本；人读 DOCX 包含 12 个要求章节标题。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/documents.test.ts tests/job-pack.test.ts`，预期 FAIL。
- [ ] **Step 3: 实现** Mammoth/PDF 本地解析、文件哈希、默认可编辑岗位包、版本不可变存储、审批门槛和 DOCX 生成。
- [ ] **Step 4: 复跑两个测试文件及类型检查**，预期 PASS。
- [ ] **Step 5: 提交** `feat: add job intake and versioned job packs`。

### Task 3: DeepSeek 、请求脱敏与连接诊断

**Files:**
- Create: `src/server/services/redaction.ts`, `src/server/services/deepseek.ts`
- Create: `src/server/routes/settings.ts`
- Test: `tests/redaction.test.ts`, `tests/deepseek.test.ts`

**Interfaces:**
- Produces: `sanitizeCandidate(candidate): SafeCandidate`, `assertNoSensitiveText(payload): void`, `DeepSeekProvider.generateJobPack()`, `DeepSeekProvider.assessBatch()`, `DeepSeekProvider.testConnection()`.

- [ ] **Step 1: 编写失败测试**，输入同时包含姓名、手机、邮箱、微信、身份证、住址、谷露 ID 和 URL，断言生成请求中不包含这些值；Mock DeepSeek 必须收到 `response_format.type=json_object`，空响应必须转为可诊断错误。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/redaction.test.ts tests/deepseek.test.ts`，预期 FAIL。
- [ ] **Step 3: 实现白名单投影、正则二次清理、敏感断言和可注入 HTTP 客户端的 DeepSeek 提供商**；连接测试仅发送固定无敏感文本，返回 key 存在性、耗时、Token 和错误类型。
- [ ] **Step 4: 复跑测试和类型检查**，并用未设 key 的本地请求验证返回 `missing_api_key`。
- [ ] **Step 5: 提交** `feat: add redacted DeepSeek provider and diagnostics`。

### Task 4: 双轮筛选、去重、缓存和断点

**Files:**
- Create: `src/server/services/screening.ts`, `src/server/demo/candidates.ts`
- Create: `src/server/routes/runs.ts`, `src/server/routes/reviews.ts`
- Test: `tests/screening.test.ts`, `tests/runs-api.test.ts`

**Interfaces:**
- Produces: `deduplicateCandidates(rounds): Candidate[]`, `classifyDeterministically(pack, candidate): Assessment | null`, `startRun(jobId, options): Run`, `processNext(runId): Promise<RunProgress>`, `pauseRun(runId): Run`, `resumeRun(runId): Run`.

- [ ] **Step 1: 编写失败测试**：同一候选人出现两轮只保留一份；未批准规则启动返回 409；明确反证排除；信息缺失复核；缓存键为 `ruleFingerprint+resumeHash`；暂停恢复从最后完成项继续。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/screening.test.ts tests/runs-api.test.ts`，预期 FAIL。
- [ ] **Step 3: 实现运行状态机** `queued/running/paused/completed/failed`，每处理一人提交断点，保存原因代码、1–4 条证据、规则版本与 Token 用量；实现 10 名脱敏演示候选人覆盖三种结果。
- [ ] **Step 4: 复跑测试**，再执行一次暂停/恢复 API 演示，预期最终候选人数为去重后数量。
- [ ] **Step 5: 提交** `feat: add resumable two-round screening engine`。

### Task 5: Excel/CSV 导出与数据清除

**Files:**
- Create: `src/server/services/exports.ts`, `src/server/routes/exports.ts`
- Test: `tests/exports.test.ts`, `tests/delete-job.test.ts`

**Interfaces:**
- Produces: `buildWorkbook(jobId): Promise<Buffer>`, `buildCsv(jobId): Promise<Buffer>`, `deleteJobData(jobId): DeleteSummary`.

- [ ] **Step 1: 编写失败测试**：Excel 必须有五张指定工作表；明细列必须等于需求中 14 个字段；CSV 必须含 UTF-8 BOM 且不含电话和邮箱；删除岗位后所有关联记录和上传副本不存在。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/exports.test.ts tests/delete-job.test.ts`，预期 FAIL。
- [ ] **Step 3: 实现 ExcelJS 工作簿、扁平 CSV 和事务性级联删除**，链接仅用于本地人工回查，运行摘要包含分类数量、Token 和规则版本。
- [ ] **Step 4: 复跑测试，并使用 ExcelJS 重新读取生成文件**，预期工作表、行数和列名均正确。
- [ ] **Step 5: 提交** `feat: add review exports and safe job deletion`。

### Task 6: 本机 API 与 React 用户流程

**Files:**
- Create: `src/server/app.ts`, `src/server/index.ts`
- Create: `src/client/main.tsx`, `src/client/App.tsx`, `src/client/api.ts`, `src/client/styles.css`
- Create: `src/client/pages/JobsPage.tsx`, `JobEditorPage.tsx`, `RuleApprovalPage.tsx`, `RunPage.tsx`, `ResultsPage.tsx`, `SettingsPage.tsx`
- Test: `tests/api.test.ts`, `tests/e2e/mvp.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5 的公开服务。
- Produces: `createApp(deps): Express`, 可用的 `/api/jobs`, `/api/runs`, `/api/reviews`, `/api/exports`, `/api/settings/test` 路由和完整浏览器流程。

- [ ] **Step 1: 编写 API 失败测试**，覆盖健康检查、岗位创建、规则批准、未批准启动拒绝、演示运行、人工备注、导出和删除。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/api.test.ts`，预期 FAIL。
- [ ] **Step 3: 实现 API 和 React 界面**，顶部状态明确显示“本机运行”和“人工最终审核”；实现岗位列表、创建表单、规则编辑批准、运行进度、结果筛选与备注、导出和危险删除确认。
- [ ] **Step 4: 编写并运行 Playwright 流程**：创建演示岗位 → 批准 → 筛选 → 复核 → 导出；预期每个页面无控制台错误且结果包含三种分类。
- [ ] **Step 5: 提交** `feat: add complete local screening workflow UI`。

### Task 7: Chrome 安全骨架、Windows 启动与交付验证

**Files:**
- Create: `extension/manifest.json`, `extension/background.js`, `extension/content.js`, `extension/gulu-adapter.js`, `extension/README.md`
- Create: `启动谷露筛选MVP.cmd`, `scripts/start.mjs`, `scripts/seed-demo.mjs`
- Create: `README.md`, `.env.example`, `.gitignore`
- Test: `tests/extension.test.ts`, `tests/security.test.ts`

**Interfaces:**
- Produces: 只可访问 `http://127.0.0.1/*` 的未配对插件骨架，`npm.cmd run verify`，双击启动入口。

- [ ] **Step 1: 编写失败安全测试**：Manifest 必须是 v3，不得声明 `cookies`, `downloads`, `history`, `webRequest`, `storage` 权限，不得包含未确认谷露通配域名；适配器默认 `enabled=false` 且拒绝读取。
- [ ] **Step 2: 运行** `npm.cmd test -- tests/extension.test.ts tests/security.test.ts`，预期 FAIL。
- [ ] **Step 3: 实现插件骨架、启动脚本和文档**；启动脚本使用 `npm.cmd`、检查 Node 24+、构建应用、启动本机服务并打开默认浏览器。README 包含 DeepSeek Key 设置、数据位置、备份、恢复、导出、删除、插件禁用状态和后续需要的脱敏材料。
- [ ] **Step 4: 执行全量验证**：`npm.cmd run lint`、`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`、`npm.cmd run verify`；预期所有命令退出码为 0。
- [ ] **Step 5: 用生产构建执行固定演示流程**，检查生成的 DOCX、JSON、XLSX 和 CSV，并保存界面截图作为交付证据。
- [ ] **Step 6: 提交** `chore: finalize Windows MVP delivery`。
