import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';
import mammoth from 'mammoth';
import { readFile } from 'node:fs/promises';
import { generateHumanGuide, parseSource } from '../src/server/services/documents.js';
import { makeDefaultJobPack } from '../src/server/services/job-pack.js';

describe('local document handling', () => {
  it('extracts DOCX text and computes SHA-256 locally', async () => {
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('高级销售经理岗位')] }] }));
    const parsed = await parseSource({ filename: 'JD.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
    expect(parsed.text).toContain('高级销售经理岗位');
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('extracts text from a real PDF locally', async () => {
    const buffer = await readFile(new URL('./fixtures/sample.pdf', import.meta.url));
    const parsed = await parseSource({ filename: 'JD.pdf', mimeType: 'application/pdf', buffer });
    expect(parsed.text).toContain('Senior Sales Manager JD');
    expect(parsed.text).toContain('manufacturing sales experience');
  });

  it('generates a readable DOCX with all required sections', async () => {
    const pack = makeDefaultJobPack('job-1', '高级销售经理', '负责大客户业务增长');
    const output = await generateHumanGuide(pack);
    const text = (await mammoth.extractRawText({ buffer: output })).value;
    for (const title of ['三十秒理解岗位','客户真正想找的人','明确必须项','加分项','目标行业','目标公司地图','目标职位','正面证据','明确反证','容易误判','稳定性与状态参考','待客户确认问题']) {
      expect(text).toContain(title);
    }
  });
});
