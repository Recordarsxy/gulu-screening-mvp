import {afterEach,describe,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {migrate} from '../src/server/db/migrate.js';
import {approveVersion,createDraft,makeDefaultJobPack} from '../src/server/services/job-pack.js';
import {GuluService} from '../src/server/services/gulu.js';

describe('two-round task progress',()=>{
  const dbs:DatabaseSync[]=[];afterEach(()=>dbs.splice(0).forEach((db)=>db.close()));
  it('records seven company candidates then completes an empty role round',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);migrate(db);const pack=makeDefaultJobPack('job-1','BD','JD');createDraft(db,{jobId:'job-1',title:'BD',sourceText:'JD',pack});approveVersion(db,'job-1',1);const service=new GuluService(db);
    const draft={jobId:'job-1',ruleVersion:1,status:'draft' as const,confirmedAt:null,rounds:[{kind:'company' as const,limit:50,filters:{companies:['Qupital'],keywords:[],roles:[],cities:[],industries:[],functions:[]}},{kind:'role' as const,limit:50,filters:{roles:['Relationship Manager'],keywords:[],companies:[],cities:[],industries:[],functions:[]}}] as const};
    service.confirmPlan('job-1',draft);const task=service.startTask('job-1');service.setStatus(task.id,'running');service.startRound(task.id,'company');
    for(let index=0;index<7;index+=1)service.recordCandidate(task.id,`company-${index}`,{guluId:`G-${index}`,name:`Candidate ${index}`,detailUrl:`http://121.43.105.7/crm#candidate/detail?id=G-${index}`,sourceRound:'company',page:1,capturedAt:new Date().toISOString()});
    service.completeRound(task.id,'company',false);service.updateCheckpoint(task.id,{currentRound:'role',page:1,candidateCursor:0});service.startRound(task.id,'role');service.completeRound(task.id,'role',true);service.setStatus(task.id,'completed');
    expect(service.getTask(task.id)).toMatchObject({status:'completed',companyReadCount:7,roleReadCount:0,companyStatus:'completed',roleStatus:'empty'});
  });
});
