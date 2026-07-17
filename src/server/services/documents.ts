import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { JobPack } from '../../shared/contracts.js';

export type SourceInput = { filename: string; mimeType: string; buffer: Buffer };
export type ParsedSource = { filename: string; text: string; sha256: string; size: number };

export async function parseSource(input: SourceInput): Promise<ParsedSource> {
  const lower = input.filename.toLowerCase();
  let text: string;
  if (lower.endsWith('.docx') || input.mimeType.includes('wordprocessingml')) {
    text = (await mammoth.extractRawText({ buffer: input.buffer })).value;
  } else if (lower.endsWith('.pdf') || input.mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: input.buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else {
    text = input.buffer.toString('utf8');
  }
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('document_has_no_extractable_text');
  return { filename: input.filename, text, sha256: createHash('sha256').update(input.buffer).digest('hex'), size: input.buffer.length };
}

function section(title: string, values: string[] | string): Paragraph[] {
  const items = Array.isArray(values) ? values : [values];
  return [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }),
    ...(items.length ? items : ['暂无，需人工补充']).map((text) => new Paragraph({ children: [new TextRun(text || '暂无，需人工补充')], bullet: { level: 0 } })),
  ];
}

export async function generateHumanGuide(pack: JobPack): Promise<Buffer> {
  const children = [
    new Paragraph({ text: '岗位筛选说明', heading: HeadingLevel.TITLE }),
    new Paragraph(`岗位 ID：${pack.job_id}　规则版本：${pack.rule_version}　状态：${pack.approval.status === 'approved' ? '已批准' : '草稿'}`),
    ...section('三十秒理解岗位', pack.summary),
    ...section('客户真正想找的人', pack.ideal_candidate),
    ...section('明确必须项', pack.constraints.hard),
    ...section('加分项', pack.constraints.soft),
    ...section('目标行业', [...pack.industries.target, ...pack.industries.adjacent]),
    ...section('目标公司地图', pack.companies.target),
    ...section('目标职位', [...pack.roles.exact, ...pack.roles.synonyms, ...pack.roles.adjacent]),
    ...section('正面证据', [...pack.evidence.required, ...pack.evidence.transferable]),
    ...section('明确反证', [...pack.evidence.negative, ...pack.constraints.ignore.map((x) => `${x}不得参与自动判断`)]),
    ...section('容易误判', ['信息缺失不能直接排除', '相邻经历或规则冲突进入复核']),
    ...section('稳定性与状态参考', ['仅作人工参考，不单独作为自动排除依据']),
    ...section('待客户确认问题', pack.questions),
  ];
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}
