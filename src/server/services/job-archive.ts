import type {DatabaseSync} from 'node:sqlite';

export type JobArchiveResult={id:string;archivedAt:string|null};

function requireJob(db:DatabaseSync,jobId:string):void{
  if(!db.prepare('SELECT 1 ok FROM jobs WHERE id=?').get(jobId))throw new Error('job_not_found');
}

export function archiveJob(db:DatabaseSync,jobId:string):JobArchiveResult{
  requireJob(db,jobId);
  const active=db.prepare("SELECT 1 ok FROM gulu_tasks WHERE job_id=? AND status IN ('queued','running','paused','needs_attention') LIMIT 1").get(jobId);
  if(active)throw new Error('job_has_active_task');
  db.prepare('UPDATE jobs SET archived_at=CURRENT_TIMESTAMP WHERE id=?').run(jobId);
  const row=db.prepare('SELECT archived_at archivedAt FROM jobs WHERE id=?').get(jobId) as {archivedAt:string};
  return {id:jobId,archivedAt:row.archivedAt};
}

export function restoreJob(db:DatabaseSync,jobId:string):JobArchiveResult{
  requireJob(db,jobId);
  db.prepare('UPDATE jobs SET archived_at=NULL WHERE id=?').run(jobId);
  return {id:jobId,archivedAt:null};
}
