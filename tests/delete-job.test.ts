import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { deleteJobData } from '../src/server/services/exports.js';

describe('safe job deletion', () => {
  const dbs: Array<{ close(): void }> = [];
  afterEach(() => dbs.splice(0).forEach((db) => db.close()));

  it('deletes database rows and an upload only inside the data root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gulu-delete-')); const directory=join(root,'uploads','job-1');await mkdir(directory,{recursive:true});const upload = join(directory, 'jd.txt'); await writeFile(upload, 'demo');
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    db.prepare('INSERT INTO jobs (id,title,source_text,source_path) VALUES (?,?,?,?)').run('job-1','销售经理','JD',upload);
    const result = await deleteJobData(db, 'job-1', root);
    expect(result).toMatchObject({ deleted: true, filesDeleted: 1 });
    expect(db.prepare('SELECT count(*) count FROM jobs').get()).toEqual({ count: 0 });
    expect(existsSync(upload)).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it('keeps the upload when the database deletion fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gulu-delete-fail-')); const directory=join(root,'uploads','job-fail');await mkdir(directory,{recursive:true});const upload = join(directory, 'jd.txt'); await writeFile(upload, 'demo');
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    db.prepare('INSERT INTO jobs (id,title,source_text,source_path) VALUES (?,?,?,?)').run('job-fail','销售经理','JD',upload);
    db.exec("CREATE TRIGGER stop_delete BEFORE DELETE ON jobs BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    await expect(deleteJobData(db,'job-fail',root)).rejects.toThrow();
    expect(existsSync(upload)).toBe(true);
    expect(db.prepare('SELECT count(*) count FROM jobs').get()).toEqual({count:1});
  });

  it('refuses to delete a source file directly under the data root', async () => {
    const root=await mkdtemp(join(tmpdir(),'gulu-delete-root-'));const upload=join(root,'jd.txt');await writeFile(upload,'demo');
    const db=openDatabase(':memory:');dbs.push(db);migrate(db);db.prepare('INSERT INTO jobs (id,title,source_text,source_path) VALUES (?,?,?,?)').run('job-root','销售','JD',upload);
    await expect(deleteJobData(db,'job-root',root)).rejects.toThrowError('unsafe_source_path');
    expect(existsSync(root)).toBe(true);expect(existsSync(upload)).toBe(true);
  });
});
