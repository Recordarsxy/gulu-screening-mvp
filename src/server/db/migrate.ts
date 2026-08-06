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
  const version3 = db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=3').get();
  if (!version3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS gulu_search_plans (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        rule_version INTEGER NOT NULL, status TEXT NOT NULL, plan_json TEXT NOT NULL,
        confirmed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS gulu_connector (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), pairing_code_hash TEXT,
        pairing_expires_at TEXT, token_hash TEXT, paired_at TEXT, last_seen_at TEXT,
        extension_version TEXT, gulu_status TEXT NOT NULL DEFAULT 'unpaired', last_error TEXT
      );
      INSERT OR IGNORE INTO gulu_connector(singleton) VALUES (1);
      CREATE TABLE IF NOT EXISTS gulu_tasks (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        rule_version INTEGER NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'dry-run', current_round TEXT NOT NULL DEFAULT 'company',
        page INTEGER NOT NULL DEFAULT 1, candidate_cursor INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0, round_read_count INTEGER NOT NULL DEFAULT 0, deduped_count INTEGER NOT NULL DEFAULT 0,
        analyzed_count INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS gulu_task_events (
        event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES gulu_tasks(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS gulu_snapshots (
        task_id TEXT NOT NULL REFERENCES gulu_tasks(id) ON DELETE CASCADE,
        dedupe_key TEXT NOT NULL, content_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, first_round TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(task_id,dedupe_key), UNIQUE(task_id,content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_gulu_tasks_job ON gulu_tasks(job_id);
    `);
    db.prepare('INSERT INTO schema_migrations(version) VALUES (3)').run();
  }
  const version4 = db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=4').get();
  if (!version4) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_change_notes (
          id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          text TEXT NOT NULL, applied_rule_version INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_job_change_notes_job ON job_change_notes(job_id,created_at);
        CREATE TABLE IF NOT EXISTS gulu_search_plan_versions (
          job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          version INTEGER NOT NULL, rule_version INTEGER NOT NULL, status TEXT NOT NULL,
          plan_json TEXT NOT NULL, confirmed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(job_id,version)
        );
      `);
      const taskColumns = db.prepare('PRAGMA table_info(gulu_tasks)').all() as Array<{name:string}>;
      const add = (name:string, sql:string) => { if (!taskColumns.some((column) => column.name === name)) db.exec(sql); };
      add('plan_version', "ALTER TABLE gulu_tasks ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1");
      add('plan_json', "ALTER TABLE gulu_tasks ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'");
      add('company_status', "ALTER TABLE gulu_tasks ADD COLUMN company_status TEXT NOT NULL DEFAULT 'pending'");
      add('role_status', "ALTER TABLE gulu_tasks ADD COLUMN role_status TEXT NOT NULL DEFAULT 'pending'");
      add('company_read_count', "ALTER TABLE gulu_tasks ADD COLUMN company_read_count INTEGER NOT NULL DEFAULT 0");
      add('role_read_count', "ALTER TABLE gulu_tasks ADD COLUMN role_read_count INTEGER NOT NULL DEFAULT 0");
      db.exec(`
        INSERT OR IGNORE INTO gulu_search_plan_versions(job_id,version,rule_version,status,plan_json,confirmed_at)
        SELECT job_id,1,rule_version,status,plan_json,confirmed_at FROM gulu_search_plans;
        UPDATE gulu_tasks SET plan_json=COALESCE((SELECT plan_json FROM gulu_search_plans WHERE gulu_search_plans.job_id=gulu_tasks.job_id),'{}');
      `);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (4)').run(); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const version5 = db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=5').get();
  if (!version5) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS gulu_task_candidates (
          task_id TEXT NOT NULL REFERENCES gulu_tasks(id) ON DELETE CASCADE,
          candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(task_id,candidate_id)
        );
        CREATE INDEX IF NOT EXISTS idx_gulu_task_candidates_candidate ON gulu_task_candidates(candidate_id);
      `);
      const snapshots = db.prepare(`SELECT s.task_id,s.dedupe_key,s.snapshot_json,t.job_id
        FROM gulu_snapshots s JOIN gulu_tasks t ON t.id=s.task_id`).all() as Array<{task_id:string;dedupe_key:string;snapshot_json:string;job_id:string}>;
      const findCandidate = db.prepare(`SELECT id FROM candidates WHERE job_id=? AND
        (gulu_id=? OR detail_url=? OR dedupe_key=?) LIMIT 1`);
      const linkCandidate = db.prepare('INSERT OR IGNORE INTO gulu_task_candidates(task_id,candidate_id) VALUES (?,?)');
      for (const row of snapshots) {
        let snapshot:Record<string,unknown>={};
        try { snapshot=JSON.parse(row.snapshot_json) as Record<string,unknown>; } catch { /* retain unmatched historical snapshot */ }
        const candidate=findCandidate.get(row.job_id,String(snapshot.guluId??''),String(snapshot.detailUrl??''),row.dedupe_key) as {id:string}|undefined;
        if(candidate)linkCandidate.run(row.task_id,candidate.id);
      }
      db.prepare('INSERT INTO schema_migrations(version) VALUES (5)').run(); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const version6 = db.prepare('SELECT 1 ok FROM schema_migrations WHERE version=6').get();
  if (!version6) {
    db.exec('BEGIN');
    try {
      const jobColumns=db.prepare('PRAGMA table_info(jobs)').all() as Array<{name:string}>;
      if(!jobColumns.some(column=>column.name==='archived_at'))db.exec('ALTER TABLE jobs ADD COLUMN archived_at TEXT');
      db.prepare('INSERT INTO schema_migrations(version) VALUES (6)').run();db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error;}
  }
}
