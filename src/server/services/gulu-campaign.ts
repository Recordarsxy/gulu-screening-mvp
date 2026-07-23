import {
  GuluSearchCampaignSchema,
  type GuluFilters,
  type GuluSearchCampaign,
} from "../../shared/contracts.js";

const keys: Array<keyof GuluFilters> = [
  "keywords",
  "companies",
  "roles",
  "cities",
  "industries",
  "functions",
];
const normalize = (value: string) => value.trim().toLocaleLowerCase();

export function searchFingerprint(filters: GuluFilters): string {
  return keys
    .map(
      (key) =>
        `${key}:${[...filters[key]].map(normalize).filter(Boolean).sort().join("|")}`,
    )
    .join(";");
}

export function campaignQualityIssues(input:unknown):string[]{
  const campaign=GuluSearchCampaignSchema.parse(input);
  const enabled=campaign.steps.filter(step=>step.enabled);
  const issues:string[]=[];
  if(enabled.length<4)issues.push('campaign_too_few_steps');
  if(enabled.length>8)issues.push('campaign_too_many_steps');
  const dimensions=enabled.map(step=>keys.filter(key=>step.filters[key].some(value=>value.trim())));
  if(dimensions.some(items=>items.length!==1))issues.push('campaign_steps_not_atomic');
  if(!enabled.some(step=>step.filters.companies.some(value=>value.trim())))issues.push('campaign_missing_company_direction');
  if(!enabled.some(step=>step.filters.roles.some(value=>value.trim())))issues.push('campaign_missing_role_direction');
  if(new Set(dimensions.flat()).size<2)issues.push('campaign_insufficient_dimension_coverage');
  return issues;
}

export function lintCampaign(input: unknown): GuluSearchCampaign {
  const campaign = GuluSearchCampaignSchema.parse(input);
  const enabled = campaign.steps.filter((step) => step.enabled);
  const seen = new Set<string>();
  let budget = 0;
  for (const step of enabled) {
    const fingerprint = searchFingerprint(step.filters);
    if (!keys.some((key) => step.filters[key].some((value) => value.trim())))
      throw new Error("campaign_step_empty");
    if (
      keys.filter((key) => step.filters[key].some((value) => value.trim()))
        .length > 3
    )
      throw new Error("campaign_step_overconstrained");
    if (seen.has(fingerprint)) throw new Error("campaign_step_duplicate");
    seen.add(fingerprint);
    budget += step.limit;
  }
  if (budget > campaign.maxUniqueCandidates)
    throw new Error("campaign_budget_exceeded");
  if (enabled.length > campaign.maxSteps)
    throw new Error("campaign_step_limit");
  return campaign;
}
