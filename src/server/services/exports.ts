import type { DatabaseSync } from 'node:sqlite';
import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import ExcelJS from 'exceljs';

export const EXPORT_HEADERS = ['姓名','谷露候选人 ID','谷露详情链接','当前公司和职位','最近相关经历摘要','机器判断','原因代码','判断证据','来源搜索轮次','规则版本','机器判断时间','人工审核状态','人工备注'];

type ExportRow = {
  name: string; gulu_id: string | null; detail_url: string | null; current_company: string; current_role: string;
  experiences_json: string; label: 'recommend'|'review'|'exclude'; reason_code: string; evidence_json: string;
  source_round: string; rule_version: number; assessed_at: string; review_status: string; note: string;
};

function queryRows(db: DatabaseSync, jobId: string): ExportRow[] {
  return db.prepare(`SELECT c.name,c.gulu_id,c.detail_url,c.current_company,c.current_role,c.experiences_json,
    a.label,a.reason_code,a.evidence_json,c.source_round,a.rule_version,a.assessed_at,
    COALESCE(h.status,'未审核') review_status,COALESCE(h.note,'') note
    FROM candidates c JOIN assessments a ON a.candidate_id=c.id
    LEFT JOIN human_reviews h ON h.candidate_id=c.id AND h.rule_version=a.rule_version
    WHERE c.job_id=? ORDER BY CASE a.label WHEN 'recommend' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,c.name`).all(jobId) as unknown as ExportRow[];
}

function safeCell(value: string|number): string|number {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function displayRows(rows: ExportRow[]): Array<Array<string|number>> {
  return rows.map((row) => {
    const experiences = JSON.parse(row.experiences_json) as Array<{ summary?: string }>;
    const labels = { recommend: '推荐', review: '复核', exclude: '排除' } as const;
    return [row.name,row.gulu_id ?? '',row.detail_url ?? '',`${row.current_company} / ${row.current_role}`,
      experiences.map((x) => x.summary).filter(Boolean).join('；'),labels[row.label],row.reason_code,
      (JSON.parse(row.evidence_json) as string[]).join('；'),row.source_round === 'company' ? '公司轮' : '职位轮',
      row.rule_version,row.assessed_at,row.review_status,row.note].map(safeCell);
  });
}

function styleDetailSheet(sheet: ExcelJS.Worksheet, rowCount: number): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F5F' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle' };
  });
  const widths = [12,18,34,24,46,10,22,46,12,10,22,14,30];
  sheet.columns.forEach((column, index) => { column.width = widths[index]; });
  for (let row = 2; row <= rowCount + 1; row += 1) {
    sheet.getRow(row).alignment = { wrapText: true, vertical: 'top' };
    const label = String(sheet.getCell(row, 6).value ?? '');
    const colors: Record<string,string> = { 推荐: 'FFDCFCE7', 复核: 'FFFEF3C7', 排除: 'FFFEE2E2' };
    if (colors[label]) sheet.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors[label] } };
  }
  sheet.autoFilter = { from: 'A1', to: `M${Math.max(1, rowCount + 1)}` };
}

export async function buildWorkbook(db: DatabaseSync, jobId: string): Promise<Buffer> {
  const rows = queryRows(db, jobId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '谷露简历筛选 MVP';
  const groups: Array<[string, ExportRow[]]> = [
    ['全部', rows], ['推荐', rows.filter((r) => r.label === 'recommend')], ['复核', rows.filter((r) => r.label === 'review')], ['排除', rows.filter((r) => r.label === 'exclude')],
  ];
  for (const [name, group] of groups) {
    const sheet = workbook.addWorksheet(name, { properties: { showGridLines: false } });
    sheet.addRow(EXPORT_HEADERS); displayRows(group).forEach((row) => sheet.addRow(row)); styleDetailSheet(sheet, group.length);
  }
  const summary = workbook.addWorksheet('运行摘要', { properties: { showGridLines: false } });
  const latest = db.prepare('SELECT rule_version,input_tokens,output_tokens,created_at FROM runs WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(jobId) as {rule_version:number;input_tokens:number;output_tokens:number;created_at:string}|undefined;
  const summaryRows: Array<[string,string|number]> = [
    ['运行摘要','数值'],['岗位 ID',safeCell(jobId)],['候选人总数',rows.length],['推荐',rows.filter((r) => r.label==='recommend').length],
    ['复核',rows.filter((r) => r.label==='review').length],['排除',rows.filter((r) => r.label==='exclude').length],
    ['规则版本',latest?.rule_version ?? ''],['Token（输入 / 输出）',`${latest?.input_tokens ?? 0} / ${latest?.output_tokens ?? 0}`],
  ];
  summaryRows.forEach((row) => summary.addRow(row)); summary.columns = [{ width: 24 }, { width: 42 }];
  summary.getRow(1).eachCell((cell) => { cell.fill = { type:'pattern',pattern:'solid',fgColor:{argb:'FF173F5F'} }; cell.font = {bold:true,color:{argb:'FFFFFFFF'}}; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvEscape(value: string|number): string {
  const text = String(safeCell(value ?? ''));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function buildCsv(db: DatabaseSync, jobId: string): Promise<Buffer> {
  const lines = [EXPORT_HEADERS, ...displayRows(queryRows(db, jobId))].map((row) => row.map(csvEscape).join(','));
  return Buffer.from(`\ufeff${lines.join('\r\n')}`, 'utf8');
}

export async function deleteJobData(db: DatabaseSync, jobId: string, dataRoot: string): Promise<{deleted:boolean;filesDeleted:number;warning?:string}> {
  const row = db.prepare('SELECT source_path FROM jobs WHERE id=?').get(jobId) as { source_path: string|null }|undefined;
  if (!row) return { deleted: false, filesDeleted: 0 };
  let targetDirectory: string | null = null;
  if (row.source_path) {
    const expectedDirectory = resolve(join(dataRoot, 'uploads', jobId)); const target = resolve(row.source_path);
    if (!target.startsWith(expectedDirectory + sep)) throw new Error('unsafe_source_path');
    targetDirectory = expectedDirectory;
  }
  db.exec('BEGIN');
  try { db.prepare('DELETE FROM jobs WHERE id=?').run(jobId); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  if (!targetDirectory) return { deleted: true, filesDeleted: 0 };
  try { await rm(targetDirectory, { recursive: true, force: true }); return { deleted: true, filesDeleted: 1 }; }
  catch { return { deleted: true, filesDeleted: 0, warning: 'upload_cleanup_failed' }; }
}
