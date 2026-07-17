import type { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source_text TEXT NOT NULL,
      source_hash TEXT, source_path TEXT, current_rule_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS job_rule_versions (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, pack_json TEXT NOT NULL, status TEXT NOT NULL,
      approved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(job_id, version)
    );
    CREATE TABLE IF NOT EXISTS search_tasks (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      rule_version INTEGER NOT NULL, round TEXT NOT NULL, query TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      rule_version INTEGER NOT NULL, status TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      , input_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      dedupe_key TEXT NOT NULL, name TEXT NOT NULL, gulu_id TEXT, detail_url TEXT,
      current_company TEXT NOT NULL, current_role TEXT NOT NULL, experiences_json TEXT NOT NULL,
      source_round TEXT NOT NULL DEFAULT 'role', resume_hash TEXT,
      UNIQUE(job_id, dedupe_key)
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      rule_version INTEGER NOT NULL, label TEXT NOT NULL, reason_code TEXT NOT NULL,
      evidence_json TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, assessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(candidate_id, rule_version)
    );
    CREATE TABLE IF NOT EXISTS human_reviews (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      rule_version INTEGER NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(candidate_id, rule_version)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_id);
    CREATE INDEX IF NOT EXISTS idx_assessments_job_label ON assessments(job_id, label);
    CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').run(1);
  const version2 = db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=2').get();
  if (!version2) {
    db.exec('BEGIN');
    try {
      const runColumns = db.prepare('PRAGMA table_info(runs)').all() as Array<{name:string}>;
      if (!runColumns.some((column) => column.name === 'input_json')) db.exec("ALTER TABLE runs ADD COLUMN input_json TEXT NOT NULL DEFAULT '[]'");
      db.prepare('INSERT INTO schema_migrations(version) VALUES (2)').run(); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
