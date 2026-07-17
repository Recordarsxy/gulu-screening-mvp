import type { Candidate } from '../../shared/contracts.js';

export type SafeCandidate = {
  currentCompany: string;
  currentRole: string;
  experiences: Array<{ company: string; role: string; period: string; summary: string }>;
};

const sensitivePatterns: RegExp[] = [
  /https?:\/\/\S+/gi,
  /\b1[3-9]\d{9}\b/g,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /\b\d{17}[0-9Xx]\b/g,
  /(?:微信|wechat|wx)[：:\s_-]*[a-zA-Z0-9_-]+/gi,
  /(?:住址|地址)[：:]?[^，。;；\n]+/g,
];

function scrub(text: string, knownValues: string[]): string {
  let result = text;
  for (const value of knownValues.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(value).join('[已脱敏]');
  }
  for (const pattern of sensitivePatterns) result = result.replace(pattern, '[已脱敏]');
  return result.replace(/\[已脱敏\](?:[，,]\s*\[已脱敏\])+/g, '[已脱敏]');
}

export function sanitizeCandidate(candidate: Candidate): SafeCandidate {
  const knownValues = [candidate.name, candidate.id, candidate.jobId, candidate.dedupeKey, candidate.guluId ?? '', candidate.detailUrl ?? ''];
  const safe = {
    currentCompany: scrub(candidate.currentCompany, knownValues),
    currentRole: scrub(candidate.currentRole, knownValues),
    experiences: candidate.experiences.map((experience) => ({
      company: scrub(experience.company, knownValues),
      role: scrub(experience.role, knownValues),
      period: scrub(experience.period, knownValues),
      summary: scrub(experience.summary, knownValues),
    })),
  };
  assertNoSensitiveText(safe);
  return safe;
}

export function assertNoSensitiveText(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    /https?:\/\//i,
    /\b1[3-9]\d{9}\b/,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\b\d{17}[0-9Xx]\b/,
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) throw new Error('sensitive_data_detected');
}
