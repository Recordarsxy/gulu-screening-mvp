export type JobSummary = {
  id: string;
  title: string;
  current_rule_version: number;
  created_at: string;
  archived_at: string | null;
  status: "draft" | "approved";
};
export type JobPack = any;
export type ResultItem = {
  candidateId: string;
  name: string;
  guluId?: string;
  detailUrl?: string;
  currentCompany: string;
  currentRole: string;
  sourceRound: string;
  label: "recommend" | "review" | "exclude";
  reasonCode: string;
  evidence: string[];
  ruleVersion: number;
  reviewStatus: string;
  note: string;
};
export type RunRecord = {
  id: string;
  jobId: string;
  ruleVersion: number;
  status: "running" | "paused" | "completed" | "failed";
  cursor: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
};
export type GuluFilters = {
  keywords: string[];
  companies: string[];
  roles: string[];
  cities: string[];
  industries: string[];
  functions: string[];
};
export type JobChangeNote = {
  id: string;
  jobId: string;
  text: string;
  createdAt: string;
  appliedRuleVersion: number | null;
};
export type GuluRoundStatus =
  "pending" | "running" | "completed" | "empty" | "failed";
export type GuluPlan = {
  jobId: string;
  ruleVersion: number;
  version: number;
  sourceNotes: string;
  status: "draft" | "confirmed";
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rollout: { dryRunCompleted: boolean; pilotCompleted: boolean };
  rounds: [
    { kind: "company"; limit: number; filters: GuluFilters },
    { kind: "role"; limit: number; filters: GuluFilters },
  ];
};
export type GuluSearchSource = {
  kind:
    "approved_rule" | "peer_note" | "deepseek" | "candidate_company" | "manual";
  field: keyof GuluFilters;
  value: string;
  reason: string;
};
export type GuluSearchStep = {
  id: string;
  order: number;
  type:
    | "seed_company"
    | "role_cluster"
    | "market_cluster"
    | "company_expansion"
    | "manual"
    | "legacy";
  title: string;
  objective: string;
  rationale: string;
  expectedSignals: string[];
  limit: number;
  enabled: boolean;
  filters: GuluFilters;
  sources: GuluSearchSource[];
};
export type GuluSearchCampaign = {
  id: string;
  jobId: string;
  ruleVersion: number;
  version: number;
  status: "draft" | "confirmed";
  summary: string;
  sourceNotes: string;
  targetShortlist: number;
  maxUniqueCandidates: number;
  maxSteps: number;
  steps: GuluSearchStep[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type GuluStepProgress = {
  stepId: string;
  status:
    | "pending"
    | "preflighting"
    | "calibrating"
    | "running"
    | "empty"
    | "completed"
    | "skipped"
    | "failed";
  page: number;
  candidateCursor: number;
  readCount: number;
  uniqueCount: number;
  duplicateRate: number;
  highFitCount: number;
  lastError: string | null;
};
export type GuluTask = {
  id: string;
  jobId: string;
  ruleVersion: number;
  planVersion: number;
  mode: "dry-run" | "pilot" | "formal";
  status: string;
  currentRound: "company" | "role";
  page: number;
  candidateCursor: number;
  readCount: number;
  roundReadCount: number;
  dedupedCount: number;
  analyzedCount: number;
  inputTokens: number;
  outputTokens: number;
  companyStatus: GuluRoundStatus;
  roleStatus: GuluRoundStatus;
  companyReadCount: number;
  roleReadCount: number;
  lastError: string | null;
  campaignId: string | null;
  campaignVersion: number | null;
  phase: "preflight" | "calibration" | "search" | "adapting" | "completed";
  currentStepIndex: number;
  currentStepId: string | null;
  shortlistedCount: number;
  completionReason: string | null;
  stepProgress: GuluStepProgress[];
  createdAt?: string;
  updatedAt?: string;
};
export type GuluRunStrategy = {
  task: GuluTask;
  campaign: GuluSearchCampaign;
  steps: GuluSearchStep[];
  progress: GuluStepProgress[];
  decisions: Array<{
    id: string;
    stepId: string;
    action: string;
    metrics: Record<string, unknown>;
    rationale: string;
    patch: Record<string, unknown>;
    createdAt: string;
  }>;
};
export type ConnectorStatus = {
  paired: boolean;
  extensionOnline: boolean;
  chromeOnline: boolean;
  guluStatus: string;
  extensionVersion?: string;
  lastError?: string;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `请求失败 ${response.status}`);
  return data;
}
export const api = {
  jobs: (archived = false) =>
    json<{ items: JobSummary[] }>(
      `/api/jobs${archived ? "?archived=true" : ""}`,
    ),
  create: (input: { title: string; sourceText: string }) =>
    json<JobPack>("/api/jobs", { method: "POST", body: JSON.stringify(input) }),
  importFile: async (title: string, file: File) => {
    const form = new FormData();
    form.append("title", title);
    form.append("file", file);
    const response = await fetch("/api/jobs/import", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data as JobPack;
  },
  getJob: (id: string) => json<{ job: any; pack: JobPack }>(`/api/jobs/${id}`),
  revise: (id: string, pack: JobPack) =>
    json<JobPack>(`/api/jobs/${id}/rules`, {
      method: "PUT",
      body: JSON.stringify(pack),
    }),
  approve: (id: string, v: number) =>
    json<JobPack>(`/api/jobs/${id}/rules/${v}/approve`, { method: "POST" }),
  listChanges: (id: string) =>
    json<{ items: JobChangeNote[] }>(`/api/jobs/${id}/changes`),
  createChange: (id: string, text: string) =>
    json<JobChangeNote>(`/api/jobs/${id}/changes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  integrateChanges: (id: string, changeIds: string[]) =>
    json<JobPack>(`/api/jobs/${id}/changes/integrate`, {
      method: "POST",
      body: JSON.stringify({ changeIds }),
    }),
  runDemo: (id: string) =>
    json<RunRecord>(`/api/jobs/${id}/runs/demo`, { method: "POST" }),
  processRun: (id: string, limit = 5) =>
    json<RunRecord>(`/api/runs/${id}/process`, {
      method: "POST",
      body: JSON.stringify({ limit }),
    }),
  connectorStatus: () => json<ConnectorStatus>("/api/connectors/gulu/status"),
  createPairing: () =>
    json<{ code: string; expiresAt: string }>("/api/connectors/gulu/pairing", {
      method: "POST",
    }),
  getGuluPlan: (id: string) => json<GuluPlan>(`/api/jobs/${id}/gulu-plan`),
  generateGuluPlan: (id: string) =>
    json<GuluPlan>(`/api/jobs/${id}/gulu-plan/generate`, { method: "POST" }),
  confirmGuluPlan: (id: string, plan: GuluPlan) =>
    json<GuluPlan>(`/api/jobs/${id}/gulu-plan/confirm`, {
      method: "PUT",
      body: JSON.stringify(plan),
    }),
  importGuluPlan: (id: string, sourceNotes: string) =>
    json<GuluPlan>(`/api/jobs/${id}/gulu-plan/import`, {
      method: "POST",
      body: JSON.stringify({ sourceNotes }),
    }),
  saveGuluPlanDraft: (id: string, plan: GuluPlan) =>
    json<GuluPlan>(`/api/jobs/${id}/gulu-plan`, {
      method: "PUT",
      body: JSON.stringify(plan),
    }),
  generateCampaign: (id: string, sourceNotes = "") =>
    json<GuluSearchCampaign>(`/api/jobs/${id}/gulu-campaigns/generate`, {
      method: "POST",
      body: JSON.stringify({ sourceNotes }),
    }),
  saveCampaign: (id: string, campaign: GuluSearchCampaign) =>
    json<GuluSearchCampaign>(`/api/jobs/${id}/gulu-campaigns/${campaign.id}`, {
      method: "PUT",
      body: JSON.stringify(campaign),
    }),
  confirmCampaign: (id: string, campaign: GuluSearchCampaign) =>
    json<GuluSearchCampaign>(
      `/api/jobs/${id}/gulu-campaigns/${campaign.id}/confirm`,
      { method: "PUT", body: JSON.stringify(campaign) },
    ),
  startCampaign: (id: string, campaignId: string) =>
    json<GuluTask>(`/api/jobs/${id}/runs/gulu`, {
      method: "POST",
      body: JSON.stringify({ campaignId, fresh: true }),
    }),
  getRunStrategy: (id: string) =>
    json<GuluRunStrategy>(`/api/runs/${id}/strategy`),
  startGulu: (id: string, mode: GuluTask["mode"], fresh = false) =>
    json<GuluTask>(`/api/jobs/${id}/runs/gulu`, {
      method: "POST",
      body: JSON.stringify({ mode, ...(fresh ? { fresh: true } : {}) }),
    }),
  listGuluRuns: (id: string) =>
    json<{ items: GuluTask[] }>(`/api/jobs/${id}/runs/gulu`),
  getRun: <T = RunRecord>(id: string) => json<T>(`/api/runs/${id}`),
  pauseRun: <T = RunRecord>(id: string) =>
    json<T>(`/api/runs/${id}/pause`, { method: "POST" }),
  resumeRun: <T = RunRecord>(id: string) =>
    json<T>(`/api/runs/${id}/resume`, { method: "POST" }),
  stopRun: (id: string) =>
    json<GuluTask>(`/api/runs/${id}/stop`, { method: "POST" }),
  results: (id: string, runId?: string) =>
    json<{ items: ResultItem[] }>(
      `/api/jobs/${id}/results${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`,
    ),
  review: (
    jobId: string,
    candidateId: string,
    ruleVersion: number,
    status: string,
    note: string,
  ) =>
    json(`/api/jobs/${jobId}/reviews/${encodeURIComponent(candidateId)}`, {
      method: "PUT",
      body: JSON.stringify({ ruleVersion, status, note }),
    }),
  testDeepSeek: (baseUrl: string, model: string) =>
    json<any>("/api/settings/test-deepseek", {
      method: "POST",
      body: JSON.stringify({ baseUrl, model }),
    }),
  archiveJob: (id: string) =>
    json<{ id: string; archivedAt: string }>(`/api/jobs/${id}/archive`, {
      method: "POST",
    }),
  restoreJob: (id: string) =>
    json<{ id: string; archivedAt: null }>(`/api/jobs/${id}/restore`, {
      method: "POST",
    }),
  deleteJob: (id: string) => json(`/api/jobs/${id}`, { method: "DELETE" }),
};
