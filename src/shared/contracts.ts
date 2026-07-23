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
  sourceRound: z.enum(['company', 'role','campaign']).default('campaign'),
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
export type GuluFilters=z.infer<typeof GuluFiltersSchema>;

export const GuluSearchRoundSchema = z.object({
  kind: z.enum(['company', 'role']),
  limit: z.number().int().min(1).max(50).default(50),
  filters: GuluFiltersSchema,
});

export const GuluSearchPlanSchema = z.object({
  jobId: z.string().min(1),
  ruleVersion: z.number().int().positive(),
  version: z.number().int().positive().default(1),
  sourceNotes: z.string().max(20_000).default(''),
  status: z.enum(['draft', 'confirmed']).default('draft'),
  rounds: z.tuple([GuluSearchRoundSchema, GuluSearchRoundSchema])
    .refine((rounds) => rounds[0].kind === 'company' && rounds[1].kind === 'role', 'company_then_role'),
  confirmedAt: z.string().nullable().default(null),
  rollout: z.object({dryRunCompleted:z.boolean().default(false),pilotCompleted:z.boolean().default(false)}).default({dryRunCompleted:false,pilotCompleted:false}),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});
export type GuluSearchPlan = z.infer<typeof GuluSearchPlanSchema>;

export const GuluSearchStepTypeSchema=z.enum(['seed_company','role_cluster','market_cluster','company_expansion','manual','legacy']);
export const GuluSearchSourceSchema=z.object({
  kind:z.enum(['approved_rule','peer_note','deepseek','candidate_company','manual']),
  field:z.enum(['keywords','companies','roles','cities','industries','functions']),
  value:z.string().trim().min(1),reason:z.string().trim().min(1).max(500),
});
export const GuluSearchStepSchema=z.object({
  id:z.string().min(1),order:z.number().int().min(0).max(7),type:GuluSearchStepTypeSchema,
  title:z.string().trim().min(1).max(120),objective:z.string().trim().min(1).max(500),rationale:z.string().trim().min(1).max(1000),
  expectedSignals:z.array(z.string().trim().min(1)).max(12).default([]),limit:z.number().int().min(5).max(40),enabled:z.boolean().default(true),
  filters:GuluFiltersSchema,sources:z.array(GuluSearchSourceSchema).max(100).default([]),
});
export const GuluSearchCampaignSchema=z.object({
  id:z.string().min(1),jobId:z.string().min(1),ruleVersion:z.number().int().positive(),version:z.number().int().positive().default(1),
  status:z.enum(['draft','confirmed']).default('draft'),summary:z.string().trim().min(1).max(3000),sourceNotes:z.string().max(20_000).default(''),
  targetShortlist:z.number().int().min(5).max(15).default(10),maxUniqueCandidates:z.number().int().min(20).max(150).default(150),maxSteps:z.number().int().min(1).max(8).default(8),
  steps:z.array(GuluSearchStepSchema).min(1).max(8),confirmedAt:z.string().datetime().nullable().default(null),
  createdAt:z.string().datetime().default(()=>new Date().toISOString()),updatedAt:z.string().datetime().default(()=>new Date().toISOString()),
});
export type GuluSearchCampaign=z.infer<typeof GuluSearchCampaignSchema>;
export type GuluSearchStep=z.infer<typeof GuluSearchStepSchema>;

export const GuluStepProgressSchema=z.object({
  stepId:z.string().min(1),status:z.enum(['pending','preflighting','calibrating','running','empty','completed','skipped','failed']).default('pending'),
  page:z.number().int().positive().default(1),candidateCursor:z.number().int().nonnegative().default(0),readCount:z.number().int().nonnegative().default(0),
  uniqueCount:z.number().int().nonnegative().default(0),duplicateRate:z.number().min(0).max(1).default(0),highFitCount:z.number().int().nonnegative().default(0),lastError:z.string().nullable().default(null),
});
export type GuluStepProgress=z.infer<typeof GuluStepProgressSchema>;
export const GuluMatchDimensionSchema=z.object({
  id:z.string().min(1),earned:z.number().int().nonnegative(),possible:z.number().int().positive(),
  confidence:z.enum(['low','medium','high']),evidence:z.array(z.string().min(1)).max(4),gaps:z.array(z.string().min(1)).max(4),
}).superRefine((value,ctx)=>{
  if(value.earned>value.possible)ctx.addIssue({code:'custom',message:'dimension_score_exceeds_weight'});
  if(value.earned>0&&!value.evidence.length)ctx.addIssue({code:'custom',message:'positive_score_requires_evidence'});
  if(value.earned<value.possible&&!value.gaps.length)ctx.addIssue({code:'custom',message:'incomplete_dimension_requires_gap'});
});
export type GuluMatchDimension=z.infer<typeof GuluMatchDimensionSchema>;
export const GuluSearchFitSchema=z.object({
  score:z.number().int().min(0).max(100),evidence:z.array(z.string().min(1)).min(1).max(4),gaps:z.array(z.string().min(1)).max(6).default([]),
  dimensions:z.array(GuluMatchDimensionSchema).default([]),verificationQuestions:z.array(z.string().min(1)).max(8).default([]),
  policyVersion:z.string().min(1).default('legacy'),model:z.string().min(1),inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),
});
export type GuluSearchFit=z.infer<typeof GuluSearchFitSchema>;

export const JobChangeSectionSchema=z.enum(['constraints.hard','constraints.soft','companies.target','roles.exact','evidence.required','evidence.negative','questions']);
export const JobChangeAnalysisSchema=z.object({
  summary:z.string().trim().min(1),
  impacts:z.array(z.object({
    section:JobChangeSectionSchema,action:z.enum(['add','replace','remove','review']),
    values:z.array(z.string().trim().min(1)).max(20),reason:z.string().trim().min(1),
  })).max(20),
  questions:z.array(z.string().trim().min(1)).max(10).default([]),
  model:z.string().min(1),
});
export type JobChangeAnalysis=z.infer<typeof JobChangeAnalysisSchema>;

export const JobChangeNoteSchema = z.object({
  id:z.string().min(1), jobId:z.string().min(1), text:z.string().trim().min(1).max(20_000),
  createdAt:z.string(), appliedRuleVersion:z.number().int().positive().nullable().default(null),
  analysis:JobChangeAnalysisSchema.nullable().default(null),
});
export type JobChangeNote = z.infer<typeof JobChangeNoteSchema>;

export const GuluExperienceSchema = z.object({
  company: z.string().default(''), role: z.string().default(''), period: z.string().default(''), summary: z.string().default(''),
});
export const GuluCandidateSnapshotSchema = z.object({
  guluId: z.string().min(1), name: z.string().min(1), detailUrl: z.string().url(),
  company: z.string().default(''), role: z.string().default(''), city: z.string().default(''),
  industry: z.string().default(''), function: z.string().default(''), salary: z.string().default(''),
  experiences: z.array(GuluExperienceSchema).default([]), education: z.array(z.string()).default([]), tags: z.array(z.string()).default([]),
  sourceRound: z.enum(['company', 'role','campaign']).optional(),sourceStepId:z.string().min(1).optional(), page: z.number().int().positive(), capturedAt: z.string().datetime(),
}).strict().refine(value=>Boolean(value.sourceRound||value.sourceStepId),'candidate_source_required');
export type GuluCandidateSnapshot = z.infer<typeof GuluCandidateSnapshotSchema>;

export const GuluTaskStatusSchema = z.enum(['queued','running','paused','needs_attention','completed','stopped','failed']);
export type GuluTaskStatus = z.infer<typeof GuluTaskStatusSchema>;
export const GuluRoundStatusSchema = z.enum(['pending','running','completed','empty','failed']);
export type GuluRoundStatus = z.infer<typeof GuluRoundStatusSchema>;
export const GuluConnectorTaskSchema = z.object({
  id: z.string(), jobId: z.string(), ruleVersion: z.number().int().positive(), status: GuluTaskStatusSchema,
  planVersion: z.number().int().positive().default(1),
  mode: z.enum(['dry-run','pilot','formal']).default('dry-run'),
  currentRound: z.enum(['company','role']).default('company'), page: z.number().int().positive().default(1),
  candidateCursor: z.number().int().nonnegative().default(0), readCount: z.number().int().nonnegative().default(0),
  roundReadCount: z.number().int().nonnegative().default(0),
  dedupedCount: z.number().int().nonnegative().default(0), analyzedCount: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0), outputTokens: z.number().int().nonnegative().default(0),
  companyStatus: GuluRoundStatusSchema.default('pending'), roleStatus: GuluRoundStatusSchema.default('pending'),
  companyReadCount: z.number().int().nonnegative().default(0), roleReadCount: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
  campaignId:z.string().nullable().default(null),campaignVersion:z.number().int().positive().nullable().default(null),
  phase:z.enum(['preflight','calibration','search','adapting','completed']).default('preflight'),currentStepIndex:z.number().int().nonnegative().default(0),currentStepId:z.string().nullable().default(null),
  shortlistedCount:z.number().int().nonnegative().default(0),completionReason:z.string().nullable().default(null),stepProgress:z.array(GuluStepProgressSchema).default([]),
  createdAt: z.string().optional(), updatedAt: z.string().optional(),
});
export type GuluConnectorTask = z.infer<typeof GuluConnectorTaskSchema>;
