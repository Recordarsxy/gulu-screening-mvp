import { describe, expect, it } from 'vitest';
import { assertNoSensitiveText, sanitizeCandidate } from '../src/server/services/redaction.js';

describe('candidate redaction', () => {
  it('removes identity fields and sensitive text before cloud use', () => {
    const safe = sanitizeCandidate({
      id: 'local-1', jobId: 'job-1', dedupeKey: 'key', name: '张三', guluId: 'gulu-9988',
      detailUrl: 'https://example.test/candidate/gulu-9988', currentCompany: '甲公司', currentRole: '销售总监', sourceRound: 'company',
      experiences: [{ company: '甲公司', role: '销售总监', period: '2020-2024', summary: '联系 13812345678，邮箱 zhangsan@example.com，微信 wx_zhang，身份证 110105199001011234，住址北京市朝阳区。' }],
    });
    const serialized = JSON.stringify(safe);
    for (const value of ['张三','local-1','job-1','key','gulu-9988','https://example.test','13812345678','zhangsan@example.com','wx_zhang','110105199001011234','北京市朝阳区']) {
      expect(serialized).not.toContain(value);
    }
    expect(safe.experiences[0].company).toBe('甲公司');
    expect(() => assertNoSensitiveText(safe)).not.toThrow();
  });
});
