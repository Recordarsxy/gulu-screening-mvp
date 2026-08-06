import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { JobChangeNoteSchema, type JobChangeNote } from '../../shared/contracts.js';

type ChangeRow={id:string;job_id:string;text:string;created_at:string;applied_rule_version:number|null};
const fromRow=(row:ChangeRow):JobChangeNote=>JobChangeNoteSchema.parse({id:row.id,jobId:row.job_id,text:row.text,createdAt:row.created_at,appliedRuleVersion:row.applied_rule_version});

export class JobChangeService {
  constructor(private readonly db:DatabaseSync) {}

  list(jobId:string):JobChangeNote[] {
    const job=this.db.prepare('SELECT 1 ok FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('job_not_found');
    return (this.db.prepare('SELECT id,job_id,text,created_at,applied_rule_version FROM job_change_notes WHERE job_id=? ORDER BY created_at DESC,id DESC').all(jobId) as ChangeRow[]).map(fromRow);
  }

  create(jobId:string,text:string):JobChangeNote {
    const clean=text.trim();if(!clean)throw new Error('job_change_required');
    const job=this.db.prepare('SELECT 1 ok FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('job_not_found');
    const id=randomUUID();this.db.prepare('INSERT INTO job_change_notes(id,job_id,text) VALUES (?,?,?)').run(id,jobId,clean);
    return fromRow(this.db.prepare('SELECT id,job_id,text,created_at,applied_rule_version FROM job_change_notes WHERE id=?').get(id) as ChangeRow);
  }

  getSelected(jobId:string,ids:string[]):JobChangeNote[] {
    const wanted=new Set(ids);const notes=this.list(jobId).filter((note)=>wanted.has(note.id));
    if(!ids.length||notes.length!==wanted.size)throw new Error('job_change_not_found');
    return notes.reverse();
  }

  markApplied(jobId:string,ids:string[],ruleVersion:number):void {
    const update=this.db.prepare('UPDATE job_change_notes SET applied_rule_version=? WHERE job_id=? AND id=?');
    for(const id of ids)update.run(ruleVersion,jobId,id);
  }
}
