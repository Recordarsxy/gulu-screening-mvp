import {describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';

describe('v1.2 non-technical workflow UI',()=>{
  it('contains job changes, colleague plan import, and two-round progress',async()=>{
    const source=await readFile(new URL('../src/client/App.tsx',import.meta.url),'utf8');
    for(const text of ['岗位变化','粘贴同事搜索方案','公司轮进度','岗位轮进度','岗位轮已完成，没有匹配结果'])expect(source).toContain(text);
  });

  it('contains a confirmed fresh formal run and task-scoped history workflow',async()=>{
    const source=await readFile(new URL('../src/client/App.tsx',import.meta.url),'utf8');
    for(const text of ['开启新任务','确认并开始正式任务','历史任务','岗位变化摘要','公司轮条件','岗位轮条件'])expect(source).toContain(text);
    expect(source).toContain("api.startGulu(selected,'formal',true)");
    expect(source).toContain('api.listGuluRuns(id)');
    expect(source).toContain('api.results(selected,run.id)');
  });
});
