export type JobSummary={id:string;title:string;current_rule_version:number;created_at:string;status:'draft'|'approved'};
export type JobPack=any;
export type ResultItem={candidateId:string;name:string;guluId?:string;detailUrl?:string;currentCompany:string;currentRole:string;sourceRound:string;label:'recommend'|'review'|'exclude';reasonCode:string;evidence:string[];ruleVersion:number;reviewStatus:string;note:string};
export type RunRecord={id:string;jobId:string;ruleVersion:number;status:'running'|'paused'|'completed'|'failed';cursor:number;total:number;inputTokens:number;outputTokens:number};
export type GuluFilters={keywords:string[];companies:string[];roles:string[];cities:string[];industries:string[];functions:string[]};
export type GuluPlan={jobId:string;ruleVersion:number;status:'draft'|'confirmed';confirmedAt:string|null;rollout:{dryRunCompleted:boolean;pilotCompleted:boolean};rounds:[{kind:'company';limit:number;filters:GuluFilters},{kind:'role';limit:number;filters:GuluFilters}]};
export type GuluTask={id:string;jobId:string;ruleVersion:number;mode:'dry-run'|'pilot'|'formal';status:string;currentRound:'company'|'role';page:number;candidateCursor:number;readCount:number;roundReadCount:number;dedupedCount:number;analyzedCount:number;inputTokens:number;outputTokens:number;lastError:string|null};
export type ConnectorStatus={paired:boolean;extensionOnline:boolean;chromeOnline:boolean;guluStatus:string;extensionVersion?:string;lastError?:string};

async function json<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{...init,headers:{'content-type':'application/json',...init?.headers}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`请求失败 ${response.status}`);return data;}
export const api={
 jobs:()=>json<{items:JobSummary[]}>('/api/jobs'),create:(input:{title:string;sourceText:string})=>json<JobPack>('/api/jobs',{method:'POST',body:JSON.stringify(input)}),
 importFile:async(title:string,file:File)=>{const form=new FormData();form.append('title',title);form.append('file',file);const response=await fetch('/api/jobs/import',{method:'POST',body:form});const data=await response.json();if(!response.ok)throw new Error(data.error);return data as JobPack},
 getJob:(id:string)=>json<{job:any;pack:JobPack}>(`/api/jobs/${id}`),revise:(id:string,pack:JobPack)=>json<JobPack>(`/api/jobs/${id}/rules`,{method:'PUT',body:JSON.stringify(pack)}),approve:(id:string,v:number)=>json<JobPack>(`/api/jobs/${id}/rules/${v}/approve`,{method:'POST'}),
 runDemo:(id:string)=>json<RunRecord>(`/api/jobs/${id}/runs/demo`,{method:'POST'}),processRun:(id:string,limit=5)=>json<RunRecord>(`/api/runs/${id}/process`,{method:'POST',body:JSON.stringify({limit})}),
 connectorStatus:()=>json<ConnectorStatus>('/api/connectors/gulu/status'),createPairing:()=>json<{code:string;expiresAt:string}>('/api/connectors/gulu/pairing',{method:'POST'}),
 getGuluPlan:(id:string)=>json<GuluPlan>(`/api/jobs/${id}/gulu-plan`),generateGuluPlan:(id:string)=>json<GuluPlan>(`/api/jobs/${id}/gulu-plan/generate`,{method:'POST'}),confirmGuluPlan:(id:string,plan:GuluPlan)=>json<GuluPlan>(`/api/jobs/${id}/gulu-plan/confirm`,{method:'PUT',body:JSON.stringify(plan)}),
 startGulu:(id:string,mode:GuluTask['mode'])=>json<GuluTask>(`/api/jobs/${id}/runs/gulu`,{method:'POST',body:JSON.stringify({mode})}),getRun:<T=RunRecord>(id:string)=>json<T>(`/api/runs/${id}`),
 pauseRun:<T=RunRecord>(id:string)=>json<T>(`/api/runs/${id}/pause`,{method:'POST'}),resumeRun:<T=RunRecord>(id:string)=>json<T>(`/api/runs/${id}/resume`,{method:'POST'}),stopRun:(id:string)=>json<GuluTask>(`/api/runs/${id}/stop`,{method:'POST'}),
 results:(id:string)=>json<{items:ResultItem[]}>(`/api/jobs/${id}/results`),review:(jobId:string,candidateId:string,ruleVersion:number,status:string,note:string)=>json(`/api/jobs/${jobId}/reviews/${encodeURIComponent(candidateId)}`,{method:'PUT',body:JSON.stringify({ruleVersion,status,note})}),
 testDeepSeek:(baseUrl:string,model:string)=>json<any>('/api/settings/test-deepseek',{method:'POST',body:JSON.stringify({baseUrl,model})}),deleteJob:(id:string)=>json(`/api/jobs/${id}`,{method:'DELETE'}),
};
