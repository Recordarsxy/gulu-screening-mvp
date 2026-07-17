import { z } from 'zod';

export const ApprovalSchema = z.object({
  status: z.enum(['draft', 'approved']),
  approved_at: z.string().nullable(),
});

export const JobPackSchema = z.object({
  job_id: z.string().min(1),
  rule_version: z.number().int().positive(),
  approval: ApprovalSchema,
  constraints: z.object({ hard: z.array(z.string()), soft: z.array(z.string()), ignore: z.array(z.string()) }),
  industries: z.object({ target: z.array(z.string()), adjacent: z.array(z.string()), excluded: z.array(z.string()) }),
  companies: z.object({ target: z.array(z.string()) }),
  roles: z.object({ exact: z.array(z.string()), synonyms: z.array(z.string()), adjacent: z.array(z.string()), excluded: z.array(z.string()) }),
  evidence: z.object({ required: z.array(z.string()), transferable: z.array(z.string()), negative: z.array(z.string()) }),
  search_plan: z.array(z.string()),
  decision_policy: z.object({
    labels: z.tuple([z.literal('recommend'), z.literal('review'), z.literal('exclude')]),
    missing_information: z.literal('review'),
  }),
  questions: z.array(z.string()).default([]),
  summary: z.string().default(''),
  ideal_candidate: z.string().default(''),
});

export type JobPack = z.infer<typeof JobPackSchema>;

export const ExperienceSchema = z.object({
  company: z.string(), role: z.string(), period: z.string().default(''), summary: z.string().default(''),
});

export const CandidateSchema = z.object({
  id: z.string(), jobId: z.string(), dedupeKey: z.string(), name: z.string(),
  guluId: z.string().optional(), detailUrl: z.string().optional(),
  currentCompany: z.string(), currentRole: z.string(), experiences: z.array(ExperienceSchema),
  sourceRound: z.enum(['company', 'role']).default('role'),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type CandidateInput = z.input<typeof CandidateSchema>;

export const AssessmentSchema = z.object({
  id: z.string(), jobId: z.string(), candidateId: z.string(), ruleVersion: z.number().int().positive(),
  label: z.enum(['recommend', 'review', 'exclude']), reasonCode: z.string(),
  evidence: z.array(z.string()).min(1).max(4), model: z.string(),
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

export const GuluFiltersSchema = z.object({
  keywords: z.array(z.string()).default([]),
  companies: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  functions: z.array(z.string()).default([]),
});

export const GuluSearchRoundSchema = z.object({
  kind: z.enum(['company', 'role']),
  limit: z.number().int().min(1).max(50).default(50),
  filters: GuluFiltersSchema,
});

export const GuluSearchPlanSchema = z.object({
  jobId: z.string().min(1),
  ruleVersion: z.number().int().positive(),
  status: z.enum(['draft', 'confirmed']).default('draft'),
  rounds: z.tuple([GuluSearchRoundSchema, GuluSearchRoundSchema])
    .refine((rounds) => rounds[0].kind === 'company' && rounds[1].kind === 'role', 'company_then_role'),
  confirmedAt: z.string().nullable().default(null),
});
export type GuluSearchPlan = z.infer<typeof GuluSearchPlanSchema>;

export const GuluExperienceSchema = z.object({
  company: z.string().default(''), role: z.string().default(''), period: z.string().default(''), summary: z.string().default(''),
});
export const GuluCandidateSnapshotSchema = z.object({
  guluId: z.string().min(1), name: z.string().min(1), detailUrl: z.string().url(),
  company: z.string().default(''), role: z.string().default(''), city: z.string().default(''),
  industry: z.string().default(''), function: z.string().default(''), salary: z.string().default(''),
  experiences: z.array(GuluExperienceSchema).default([]), education: z.array(z.string()).default([]), tags: z.array(z.string()).default([]),
  sourceRound: z.enum(['company', 'role']), page: z.number().int().positive(), capturedAt: z.string().datetime(),
}).strict();
export type GuluCandidateSnapshot = z.infer<typeof GuluCandidateSnapshotSchema>;

export const GuluTaskStatusSchema = z.enum(['queued','running','paused','needs_attention','completed','stopped','failed']);
export type GuluTaskStatus = z.infer<typeof GuluTaskStatusSchema>;
export const GuluConnectorTaskSchema = z.object({
  id: z.string(), jobId: z.string(), ruleVersion: z.number().int().positive(), status: GuluTaskStatusSchema,
  mode: z.enum(['dry-run','pilot','formal']).default('dry-run'),
  currentRound: z.enum(['company','role']).default('company'), page: z.number().int().positive().default(1),
  candidateCursor: z.number().int().nonnegative().default(0), readCount: z.number().int().nonnegative().default(0),
  roundReadCount: z.number().int().nonnegative().default(0),
  dedupedCount: z.number().int().nonnegative().default(0), analyzedCount: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0), outputTokens: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
});
export type GuluConnectorTask = z.infer<typeof GuluConnectorTaskSchema>;
