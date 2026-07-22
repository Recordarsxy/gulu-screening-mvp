import type { DatabaseSync } from "node:sqlite";

export type JobResetSection = "rules" | "runs" | "results";

export type JobResetSummary = {
  jobId: string;
  section: JobResetSection;
  deleted: Record<string, number>;
};

const remove = (
  db: DatabaseSync,
  deleted: Record<string, number>,
  table: string,
  jobId: string,
) => {
  deleted[table] = Number(
    db.prepare(`DELETE FROM ${table} WHERE job_id=?`).run(jobId).changes,
  );
};

function clearRuns(
  db: DatabaseSync,
  deleted: Record<string, number>,
  jobId: string,
) {
  remove(db, deleted, "gulu_tasks", jobId);
  remove(db, deleted, "gulu_search_plans", jobId);
  remove(db, deleted, "gulu_search_plan_versions", jobId);
  remove(db, deleted, "gulu_search_campaigns", jobId);
  remove(db, deleted, "runs", jobId);
  remove(db, deleted, "search_tasks", jobId);
}

export function resetJobSection(
  db: DatabaseSync,
  jobId: string,
  section: JobResetSection,
): JobResetSummary | null {
  if (!db.prepare("SELECT 1 ok FROM jobs WHERE id=?").get(jobId)) return null;
  const deleted: Record<string, number> = {};
  db.exec("BEGIN");
  try {
    if (section === "results") {
      db.prepare(
        "UPDATE gulu_tasks SET status='paused',last_error='候选结果已重置，任务已暂停',updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status IN ('queued','running','needs_attention')",
      ).run(jobId);
      remove(db, deleted, "candidates", jobId);
    } else {
      clearRuns(db, deleted, jobId);
      if (section === "rules") {
        remove(db, deleted, "candidates", jobId);
        remove(db, deleted, "job_change_notes", jobId);
        remove(db, deleted, "job_rule_versions", jobId);
        db.prepare("UPDATE jobs SET current_rule_version=0 WHERE id=?").run(jobId);
      }
    }
    db.exec("COMMIT");
    return { jobId, section, deleted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
