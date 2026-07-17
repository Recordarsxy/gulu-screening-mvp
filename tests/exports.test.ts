import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/connection.js';
import { migrate } from '../src/server/db/migrate.js';
import { approveVersion, createDraft } from '../src/server/services/job-pack.js';
import { ScreeningEngine } from '../src/server/services/screening.js';
import { demoCompanyRound, demoRoleRound } from '../src/server/demo/candidates.js';
import ExcelJS from 'exceljs';
import { buildCsv, buildWorkbook, EXPORT_HEADERS } from '../src/server/services/exports.js';

describe('review exports', () => {
  const dbs: Array<{ close(): void }> = [];
  afterEach(() => dbs.splice(0).forEach((db) => db.close()));

  async function prepared() {
    const db = openDatabase(':memory:'); dbs.push(db); migrate(db);
    createDraft(db, { jobId: 'job-1', title: '销售经理', sourceText: '制造业大客户' }); approveVersion(db, 'job-1', 1);
    const engine = new ScreeningEngine(db); const run = engine.startRun('job-1', [demoCompanyRound, demoRoleRound]); await engine.processAll(run.id);
    return db;
  }

  it('builds a readable five-sheet workbook with exact headers', async () => {
    const bytes = await buildWorkbook(await prepared(), 'job-1');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names).toEqual(['全部','推荐','复核','排除','运行摘要']);
    expect(workbook.getWorksheet('全部')!.getRow(1).values).toEqual([undefined, ...EXPORT_HEADERS]);
  });

  it('builds UTF-8 BOM CSV without contact fields', async () => {
    const csv = await buildCsv(await prepared(), 'job-1');
    expect(csv.subarray(0, 3)).toEqual(Buffer.from([0xef,0xbb,0xbf]));
    const text = csv.toString('utf8');
    expect(text).toContain('人工审核状态');
    expect(text).not.toContain('电话'); expect(text).not.toContain('邮箱');
  });

  it('neutralizes spreadsheet formulas in CSV and XLSX exports', async () => {
    const db = await prepared();
    db.prepare("UPDATE candidates SET name='=HYPERLINK(\"https://evil.test\")' WHERE id=(SELECT id FROM candidates LIMIT 1)").run();
    expect((await buildCsv(db, 'job-1')).toString('utf8')).toContain("'=HYPERLINK");
    const workbook = new ExcelJS.Workbook(); const bytes = await buildWorkbook(db, 'job-1'); await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const values = workbook.getWorksheet('全部')!.getColumn(1).values.map(String);
    expect(values.some((value) => value.startsWith("'=HYPERLINK"))).toBe(true);
  });
});
