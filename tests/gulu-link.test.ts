import {describe,expect,it} from 'vitest';
import {safeGuluCandidateUrl} from '../src/shared/gulu-link.js';

describe('safe Gulu candidate links',()=>{
  it('allows only the known Gulu candidate detail route',()=>{
    expect(safeGuluCandidateUrl('http://121.43.105.7/crm#candidate/detail?id=C-100')).toBe('http://121.43.105.7/crm#candidate/detail?id=C-100');
    expect(safeGuluCandidateUrl(undefined,'C-200')).toBe('http://121.43.105.7/crm#candidate/detail?id=C-200');
  });
  it('rejects foreign hosts, credentials and non-detail routes',()=>{
    expect(safeGuluCandidateUrl('https://evil.test/#candidate/detail?id=C-1')).toBeNull();
    expect(safeGuluCandidateUrl('http://user@121.43.105.7/crm#candidate/detail?id=C-1')).toBeNull();
    expect(safeGuluCandidateUrl('http://121.43.105.7/crm#candidate/list?id=C-1')).toBeNull();
  });
});
