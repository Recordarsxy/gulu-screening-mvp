import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/server/db/connection.js";
import { migrate } from "../src/server/db/migrate.js";
import { createApp } from "../src/server/app.js";
import { createDraft, makeDefaultJobPack } from "../src/server/services/job-pack.js";
import { DeepSeekProvider } from "../src/server/services/deepseek.js";

describe("job section reset API", () => {
  const closers: Array<() => void> = [];
  afterEach(() => closers.splice(0).forEach((close) => close()));

  async function server() {
    const db = openDatabase(":memory:");
    migrate(db);
    const deepSeek = new DeepSeekProvider({
      apiKey: "test",
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const payload = JSON.parse(body.messages[1].content);
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...payload.template, summary: "重新生成", ideal_candidate: "海外 SaaS 销售候选人" }) } }] }));
      },
    });
    const app = createApp({ db, dataRoot: process.cwd(), deepSeek });
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http.once("listening", resolve));
    closers.push(() => {
      http.close();
      db.close();
    });
    const port = (http.address() as AddressInfo).port;
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null };
    };
    return { db, request };
  }

  function seed(db: DatabaseSync, jobId: string) {
    createDraft(db, { jobId, title: "销售经理", sourceText: "海外 SaaS 销售" });
    db.prepare("INSERT INTO job_change_notes(id,job_id,text) VALUES (?,?,?)").run(`change-${jobId}`, jobId, "新增要求");
    db.prepare("INSERT INTO search_tasks(id,job_id,rule_version,round,query,status) VALUES (?,?,?,?,?,?)").run(`search-${jobId}`, jobId, 1, "role", "销售", "done");
    db.prepare("INSERT INTO runs(id,job_id,rule_version,status,input_json) VALUES (?,?,?,?,?)").run(`run-${jobId}`, jobId, 1, "completed", "[]");
    db.prepare("INSERT INTO gulu_search_plans(job_id,rule_version,status,plan_json) VALUES (?,?,?,?)").run(jobId, 1, "confirmed", "{}");
    db.prepare("INSERT INTO gulu_search_plan_versions(job_id,version,rule_version,status,plan_json) VALUES (?,?,?,?,?)").run(jobId, 1, 1, "confirmed", "{}");
    db.prepare("INSERT INTO gulu_search_campaigns(id,job_id,version,rule_version,status,campaign_json) VALUES (?,?,?,?,?,?)").run(`campaign-${jobId}`, jobId, 1, 1, "confirmed", "{}");
    db.prepare("INSERT INTO gulu_tasks(id,job_id,rule_version,status,mode,plan_json,campaign_id,campaign_version) VALUES (?,?,?,?,?,?,?,?)").run(`task-${jobId}`, jobId, 1, "completed", "formal", "{}", `campaign-${jobId}`, 1);
    db.prepare("INSERT INTO gulu_strategy_decisions(id,task_id,step_id,action,metrics_json,rationale) VALUES (?,?,?,?,?,?)").run(`decision-${jobId}`, `task-${jobId}`, "step-1", "continue", "{}", "继续");
    db.prepare("INSERT INTO candidates(id,job_id,dedupe_key,name,current_company,current_role,experiences_json) VALUES (?,?,?,?,?,?,?)").run(`candidate-${jobId}`, jobId, `dedupe-${jobId}`, "候选人", "公司", "销售", "[]");
    db.prepare("INSERT INTO assessments(id,job_id,candidate_id,rule_version,label,reason_code,evidence_json,model) VALUES (?,?,?,?,?,?,?,?)").run(`assessment-${jobId}`, jobId, `candidate-${jobId}`, 1, "review", "MISSING_INFORMATION", "[]", "deepseek-v4-flash");
    db.prepare("INSERT INTO human_reviews(candidate_id,rule_version,status,note) VALUES (?,?,?,?)").run(`candidate-${jobId}`, 1, "已复核", "保留");
    db.prepare("INSERT INTO gulu_task_candidates(task_id,candidate_id) VALUES (?,?)").run(`task-${jobId}`, `candidate-${jobId}`);
    db.prepare("INSERT INTO gulu_search_fits(task_id,candidate_id,step_id,score,evidence_json,gaps_json,model) VALUES (?,?,?,?,?,?,?)").run(`task-${jobId}`, `candidate-${jobId}`, "step-1", 60, "[]", "[]", "deepseek-v4-flash");
  }

  const count = (db: DatabaseSync, table: string, jobId: string) => {
    const byJob = ["jobs", "job_rule_versions", "job_change_notes", "search_tasks", "runs", "candidates", "assessments", "gulu_search_plans", "gulu_search_plan_versions", "gulu_search_campaigns", "gulu_tasks"];
    if (byJob.includes(table)) return (db.prepare(`SELECT count(*) count FROM ${table} WHERE job_id=?`).get(jobId) as { count: number }).count;
    return 0;
  };

  it("clears rules and every downstream section while preserving the job source", async () => {
    const { db, request } = await server();
    seed(db, "job-rules");
    const response = await request("/api/jobs/job-rules/reset/rules", { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.data.section).toBe("rules");
    expect((db.prepare("SELECT title,source_text sourceText,current_rule_version version FROM jobs WHERE id=?").get("job-rules") as object)).toEqual({ title: "销售经理", sourceText: "海外 SaaS 销售", version: 0 });
    for (const table of ["job_rule_versions", "job_change_notes", "search_tasks", "runs", "candidates", "assessments", "gulu_search_plans", "gulu_search_plan_versions", "gulu_search_campaigns", "gulu_tasks"]) expect(count(db, table, "job-rules"), table).toBe(0);
  });

  it("clears the run center while preserving rules and candidate results", async () => {
    const { db, request } = await server();
    seed(db, "job-runs");
    const response = await request("/api/jobs/job-runs/reset/runs", { method: "POST" });
    expect(response.status).toBe(200);
    for (const table of ["search_tasks", "runs", "gulu_search_plans", "gulu_search_plan_versions", "gulu_search_campaigns", "gulu_tasks"]) expect(count(db, table, "job-runs"), table).toBe(0);
    expect(count(db, "job_rule_versions", "job-runs")).toBe(1);
    expect(count(db, "candidates", "job-runs")).toBe(1);
    expect(count(db, "assessments", "job-runs")).toBe(1);
  });

  it("clears candidate results while preserving rules and run history", async () => {
    const { db, request } = await server();
    seed(db, "job-results");
    db.prepare("UPDATE gulu_tasks SET status='running' WHERE job_id=?").run("job-results");
    const response = await request("/api/jobs/job-results/reset/results", { method: "POST" });
    expect(response.status).toBe(200);
    expect(count(db, "candidates", "job-results")).toBe(0);
    expect(count(db, "assessments", "job-results")).toBe(0);
    expect(count(db, "job_rule_versions", "job-results")).toBe(1);
    expect(count(db, "gulu_tasks", "job-results")).toBe(1);
    expect((db.prepare("SELECT status FROM gulu_tasks WHERE job_id=?").get("job-results") as { status: string }).status).toBe("paused");
    expect(count(db, "gulu_search_campaigns", "job-results")).toBe(1);
    expect((db.prepare("SELECT count(*) count FROM gulu_search_fits").get() as { count: number }).count).toBe(0);
  });

  it("returns 404 for an unknown job", async () => {
    const { request } = await server();
    expect((await request("/api/jobs/missing/reset/results", { method: "POST" })).status).toBe(404);
  });

  it("regenerates a fresh v1 draft from preserved source after rules reset", async () => {
    const { db, request } = await server();
    seed(db, "job-regenerate");
    await request("/api/jobs/job-regenerate/reset/rules", { method: "POST" });
    expect((await request("/api/jobs/job-regenerate")).data.pack).toBeNull();
    const regenerated = await request("/api/jobs/job-regenerate/rules/regenerate", { method: "POST" });
    expect(regenerated.status).toBe(201);
    expect(regenerated.data).toMatchObject({ job_id: "job-regenerate", rule_version: 1, summary: "重新生成", approval: { status: "draft" } });
    expect((db.prepare("SELECT current_rule_version version FROM jobs WHERE id=?").get("job-regenerate") as { version: number }).version).toBe(1);
  });

  it("does not regenerate over an existing rule version", async () => {
    const { request, db } = await server();
    createDraft(db, { jobId: "job-existing", title: "销售", sourceText: "JD", pack: makeDefaultJobPack("job-existing", "销售", "JD") });
    expect((await request("/api/jobs/job-existing/rules/regenerate", { method: "POST" })).status).toBe(409);
  });
});
