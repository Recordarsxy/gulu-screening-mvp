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
