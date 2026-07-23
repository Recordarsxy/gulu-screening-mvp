import {afterEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../src/server/db/connection.js';
import {migrate} from '../src/server/db/migrate.js';
import {GuluService} from '../src/server/services/gulu.js';

describe('Gulu taxonomy synchronization',()=>{
  const dbs:Array<{close():void}>=[];
  afterEach(()=>dbs.splice(0).forEach(db=>db.close()));

  const setup=()=>{
    const db=openDatabase(':memory:');
    dbs.push(db);
    migrate(db);
    return{db,service:new GuluService(db)};
  };

  it('queues one refresh, stores hierarchical fields and reports visible counts',()=>{
    const {service}=setup();
    const sync=service.startTaxonomySync();
    expect(sync).toMatchObject({status:'queued',counts:{cities:0,industries:0,functions:0}});
    expect(service.claimNextTaxonomySync()).toMatchObject({id:sync.id,status:'running'});
    service.recordTaxonomyField(sync.id,'industries',[
      {label:'Technology 科技',parent:null,depth:1},
      {label:'Gaming 游戏',parent:'Technology 科技',depth:2},
    ]);
    service.recordTaxonomyField(sync.id,'cities',[
      {label:'China',parent:null,depth:1},
      {label:'Shanghai - 上海',parent:'China',depth:2},
    ]);
    service.recordTaxonomyField(sync.id,'functions',[{label:'Sales 销售',parent:null,depth:1}]);
    const completed=service.completeTaxonomySync(sync.id);

    expect(completed).toMatchObject({status:'completed',counts:{cities:2,industries:2,functions:1},total:5});
    expect(service.listTaxonomy()).toEqual(expect.arrayContaining([
      expect.objectContaining({field:'industries',requestedValue:'Gaming 游戏',parentValue:'Technology 科技',depth:2,source:'full_scan'}),
      expect.objectContaining({field:'cities',requestedValue:'Shanghai - 上海',parentValue:'China',depth:2,source:'full_scan'}),
    ]));
  });

  it('reuses an active refresh and maps unique dictionary labels into campaigns',()=>{
    const {service}=setup();
    const sync=service.startTaxonomySync();
    expect(service.startTaxonomySync().id).toBe(sync.id);
    service.claimNextTaxonomySync();
    service.recordTaxonomyField(sync.id,'industries',[
      {label:'Technology 科技',parent:null,depth:1},
      {label:'Gaming 游戏',parent:'Technology 科技',depth:2},
    ]);
    service.recordTaxonomyField(sync.id,'cities',[{label:'Shanghai - 上海',parent:null,depth:1}]);
    service.recordTaxonomyField(sync.id,'functions',[{label:'Channel Sales 渠道销售',parent:null,depth:1}]);
    service.completeTaxonomySync(sync.id);

    const campaign={
      id:'campaign-1',jobId:'job-1',ruleVersion:1,version:1,status:'draft' as const,
      summary:'test',targetShortlist:5,maxUniqueCandidates:20,maxSteps:1,sourceNotes:'',
      steps:[{
        id:'step-1',order:0,type:'manual' as const,title:'test',objective:'test',rationale:'test',
        expectedSignals:[],limit:10,enabled:true,
        filters:{keywords:[],companies:[],roles:[],cities:['上海'],industries:['游戏','不存在行业'],functions:['渠道销售']},
        sources:[],
      }],
      confirmedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    };
    const normalized=service.applyTaxonomyDictionary(campaign);
    expect(normalized.steps[0].filters).toMatchObject({
      cities:['Shanghai - 上海'],
      industries:['Gaming 游戏'],
      functions:['Channel Sales 渠道销售'],
      keywords:[],
    });
    const fallback=service.applyTaxonomyDictionary({...campaign,steps:[{
      ...campaign.steps[0],
      filters:{...campaign.steps[0].filters,cities:[],functions:[],industries:['不存在行业']},
    }]});
    expect(fallback.steps[0].filters).toMatchObject({industries:[],keywords:['不存在行业']});
  });

  it('replaces an abandoned running refresh instead of remaining blocked forever',()=>{
    const {db,service}=setup();
    const abandoned=service.startTaxonomySync();
    service.claimNextTaxonomySync();
    db.prepare("UPDATE gulu_taxonomy_syncs SET started_at=datetime('now','-10 minutes') WHERE id=?").run(abandoned.id);
    const retry=service.startTaxonomySync();
    expect(retry).toMatchObject({status:'queued'});
    expect(retry.id).not.toBe(abandoned.id);
    expect(db.prepare('SELECT status,error FROM gulu_taxonomy_syncs WHERE id=?').get(abandoned.id)).toEqual({status:'failed',error:'taxonomy_sync_stale'});
  });

  it('publishes all three fields atomically and discards a failed partial refresh',()=>{
    const {service}=setup();
    const first=service.startTaxonomySync();service.claimNextTaxonomySync();
    service.recordTaxonomyField(first.id,'cities',[{label:'Shanghai - 上海',parent:null,depth:1}]);
    service.recordTaxonomyField(first.id,'industries',[{label:'Gaming 游戏',parent:null,depth:1}]);
    service.recordTaxonomyField(first.id,'functions',[{label:'Sales 销售',parent:null,depth:1}]);
    service.completeTaxonomySync(first.id);

    const second=service.startTaxonomySync();service.claimNextTaxonomySync();
    service.recordTaxonomyField(second.id,'cities',[{label:'Beijing - 北京',parent:null,depth:1}]);
    service.failTaxonomySync(second.id,'industry_failed');
    const labels=service.listTaxonomy().map((item:any)=>item.requestedValue);
    expect(labels).toContain('Shanghai - 上海');
    expect(labels).not.toContain('Beijing - 北京');
  });
});
