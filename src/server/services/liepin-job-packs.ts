import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import {
  JobPackSchema,
  type JobPack,
} from "../../shared/contracts.js";

const PACKAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/;
const MAX_TEXT_LENGTH = 200_000;

type LiepinRules = {
  job_id?: string;
  rule_version?: string | number;
  approval?: { status?: string };
  objective?: string;
  role?: { families?: string[] };
  base_filters?: Record<
    string,
    {
      mode?: string;
      values?: string[];
      min?: number;
      max?: number;
      max_days?: number;
    }
  >;
  industry?: {
    target?: string[];
    adjacent?: string[];
    excluded?: string[];
    target_companies?: string[];
  };
  experience?: {
    required_patterns?: string[];
    preferred_patterns?: string[];
    transfer_patterns?: string[];
    anti_signals?: string[];
  };
  pending_client_questions?: string[];
};

export type LiepinJobPackSummary = {
  id: string;
  title: string;
  objective: string;
  approvalStatus: string;
  ruleVersion: string;
  updatedAt: string;
  files: string[];
};

export type LiepinJobPackPreview = LiepinJobPackSummary & {
  humanBrief: string;
  sourceText: string;
  rules: Record<string, unknown>;
  searchPlan: Record<string, unknown>;
  importSource: string;
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
const unique = (values: string[]) => [...new Set(values)];
const confirmationSensitive =
  /年龄|周岁|性别|婚育|学历|大专|本科|硕士|博士|城市|地区|\d+\s*年.*经验/i;

export function toGuluJobPack(
  preview: LiepinJobPackPreview,
  jobId: string,
): JobPack {
  const rules = preview.rules as LiepinRules & {
    role?: LiepinRules["role"] & {
      exact_titles?: string[];
      synonym_titles?: string[];
      adjacent_titles?: string[];
      excluded_titles?: string[];
    };
  };
  const searchPlan = preview.searchPlan as {
    tasks?: Array<{ pass_type?: string; value?: string }>;
  };
  const baseFilterLabels: Record<string, string> = {
    city: "工作城市",
    education: "学历",
    activity: "活跃度",
    age: "年龄",
  };
  const softConstraints: string[] = [];
  const ignoredConstraints = ["年龄", "性别", "婚育"];
  for (const [field, filter] of Object.entries(rules.base_filters ?? {})) {
    const label = baseFilterLabels[field] ?? field;
    if (field === "age") {
      ignoredConstraints.push(
        `${label}${filter.min ?? ""}-${filter.max ?? ""}`.replace(/-$/, ""),
      );
      continue;
    }
    const values = strings(filter.values);
    if (values.length) softConstraints.push(`${label}：${values.join("、")}`);
    else if (filter.max_days)
      softConstraints.push(`${label}：最近 ${filter.max_days} 天`);
  }
  const exactRoles = unique([
    ...strings(rules.role?.exact_titles),
    ...strings(rules.role?.families),
  ]);
  const tasks = (Array.isArray(searchPlan.tasks) ? searchPlan.tasks : [])
    .map((task) => {
      const value = String(task.value ?? "").trim();
      if (!value) return "";
      return task.pass_type === "company"
        ? `公司轮：${value}`
        : task.pass_type === "role"
          ? `岗位轮：${value}`
          : `搜索：${value}`;
    })
    .filter(Boolean);
  const questions = unique(strings(rules.pending_client_questions));
  const reviewEvidence = (values: string[], purpose: "要求" | "排除") =>
    values.filter((value) => {
      if (!confirmationSensitive.test(value)) return true;
      questions.push(
        purpose === "排除"
          ? `请确认是否将“${value}”作为排除依据`
          : `请确认是否将“${value}”作为硬性要求`,
      );
      return false;
    });
  return JobPackSchema.parse({
    job_id: jobId,
    rule_version: 1,
    approval: { status: "draft", approved_at: null },
    constraints: {
      hard: [],
      soft: unique(softConstraints),
      ignore: unique(ignoredConstraints),
    },
    industries: {
      target: unique(strings(rules.industry?.target)),
      adjacent: unique(strings(rules.industry?.adjacent)),
      excluded: unique(strings(rules.industry?.excluded)),
    },
    companies: {
      target: unique(strings(rules.industry?.target_companies)),
    },
    roles: {
      exact: exactRoles.length ? exactRoles : [preview.title],
      synonyms: unique(strings(rules.role?.synonym_titles)),
      adjacent: unique(strings(rules.role?.adjacent_titles)),
      excluded: unique(strings(rules.role?.excluded_titles)),
    },
    evidence: {
      required: unique(
        reviewEvidence(
          strings(rules.experience?.required_patterns),
          "要求",
        ),
      ),
      transferable: unique([
        ...strings(rules.experience?.preferred_patterns),
        ...strings(rules.experience?.transfer_patterns),
      ]),
      negative: unique(
        reviewEvidence(strings(rules.experience?.anti_signals), "排除"),
      ),
    },
    search_plan: tasks.length
      ? unique(tasks)
      : exactRoles.map((role) => `岗位轮：${role}`),
    decision_policy: {
      labels: ["recommend", "review", "exclude"],
      missing_information: "review",
    },
    questions: unique(questions),
    summary: String(rules.objective ?? preview.objective ?? "").trim(),
    ideal_candidate:
      String(rules.objective ?? preview.objective ?? "").trim() ||
      `符合${preview.title}核心要求的候选人`,
  });
}

const normalizedPath = (path: string) => resolve(path).toLowerCase();
const safeFileInfo = async (root: string, path: string) => {
  const info = await lstat(path);
  const [rootTarget, fileTarget] = await Promise.all([
    realpath(root),
    realpath(path),
  ]);
  if (
    info.isSymbolicLink() ||
    normalizedPath(fileTarget) !== normalizedPath(path) ||
    (normalizedPath(fileTarget) !== normalizedPath(rootTarget) &&
      !normalizedPath(fileTarget).startsWith(
        `${normalizedPath(rootTarget)}${sep}`,
      ))
  )
    throw new Error("liepin_job_pack_unsafe_path");
  return info;
};

const readOptional = async (root: string, path: string) => {
  try {
    await safeFileInfo(root, path);
    return (await readFile(path, "utf8")).slice(0, MAX_TEXT_LENGTH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

const readJson = async (root: string, path: string) => {
  const text = await readOptional(root, path);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const titleFrom = (
  request: string,
  jd: string,
  rules: LiepinRules,
  id: string,
) => {
  const requested = request.match(
    /(?:^|\n)\s*[-*]\s*(?:岗位|职位)\s*[：:]\s*([^\r\n]+)/,
  )?.[1];
  if (requested?.trim()) return requested.trim();
  const heading = jd.match(/^\s*#\s+(.+?)(?:\s+JD(?:\s+摘要)?|\s*$)/im)?.[1];
  if (heading?.trim()) return heading.trim();
  const roles = strings(rules.role?.families);
  if (roles?.length) return roles.slice(0, 2).join(" / ");
  return id;
};

export class LiepinJobPackStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async list(): Promise<{
    configured: boolean;
    rootLabel: string;
    items: LiepinJobPackSummary[];
  }> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          configured: false,
          rootLabel: "Liepin-Codex/jobs",
          items: [],
        };
      throw error;
    }
    const items = (
      await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isDirectory() &&
              !entry.isSymbolicLink() &&
              PACKAGE_ID.test(entry.name),
          )
          .map(async (entry) => {
            try {
              return await this.readSummary(entry.name);
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === "liepin_job_pack_unsafe_path"
              )
                return null;
              throw error;
            }
          }),
      )
    )
      .filter((item): item is LiepinJobPackSummary => Boolean(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      configured: true,
      rootLabel: `${basename(resolve(this.root, ".."))}/${basename(this.root)}`,
      items,
    };
  }

  async get(id: string): Promise<LiepinJobPackPreview> {
    if (!PACKAGE_ID.test(id)) throw new Error("liepin_job_pack_not_found");
    const listed = await this.list();
    const summary = listed.items.find((item) => item.id === id);
    if (!summary) throw new Error("liepin_job_pack_not_found");
    const directory = this.safeDirectory(id);
    const [rules, searchPlan, humanBrief, request, jd] = await Promise.all([
      readJson(this.root, join(directory, "job-rules.json")),
      readJson(this.root, join(directory, "search-plan.json")),
      readOptional(this.root, join(directory, "human-brief.md")),
      readOptional(this.root, join(directory, "source", "request.md")),
      readOptional(this.root, join(directory, "source", "jd.md")),
    ]);
    if (!rules) throw new Error("liepin_job_pack_not_found");
    const sourceText = [request, jd].filter(Boolean).join("\n\n");
    const importSource = [
      `# Liepin-Codex 岗位包\n\n包 ID：${id}`,
      sourceText,
      humanBrief ? `# 招聘人员手册\n\n${humanBrief}` : "",
      `# 已生成的机器规则\n\n${JSON.stringify(rules, null, 2)}`,
      searchPlan
        ? `# 已生成的搜索计划\n\n${JSON.stringify(searchPlan, null, 2)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_TEXT_LENGTH);
    return {
      ...summary,
      humanBrief,
      sourceText,
      rules,
      searchPlan: searchPlan ?? {},
      importSource,
    };
  }

  private async readSummary(
    id: string,
  ): Promise<LiepinJobPackSummary | null> {
    const directory = this.safeDirectory(id);
    const [rulesValue, request, jd, files] = await Promise.all([
      readJson(this.root, join(directory, "job-rules.json")),
      readOptional(this.root, join(directory, "source", "request.md")),
      readOptional(this.root, join(directory, "source", "jd.md")),
      readdir(directory, { withFileTypes: true }),
    ]);
    if (!rulesValue) return null;
    const rules = rulesValue as LiepinRules;
    const packageFiles = files
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) =>
        ["job-rules.json", "search-plan.json", "human-brief.md"].includes(name),
      );
    if (!packageFiles.includes("job-rules.json")) return null;
    const metadata = await safeFileInfo(
      this.root,
      join(directory, "job-rules.json"),
    );
    return {
      id,
      title: titleFrom(request, jd, rules, id),
      objective: String(rules.objective ?? ""),
      approvalStatus: String(rules.approval?.status ?? "unknown"),
      ruleVersion: String(rules.rule_version ?? ""),
      updatedAt: metadata.mtime.toISOString(),
      files: packageFiles,
    };
  }

  private safeDirectory(id: string) {
    const directory = resolve(this.root, id);
    if (
      directory === this.root ||
      !directory.startsWith(`${this.root}${sep}`)
    )
      throw new Error("liepin_job_pack_not_found");
    return directory;
  }
}
