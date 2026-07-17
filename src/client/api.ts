export type JobSummary = { id:string;title:string;current_rule_version:number;created_at:string;status:'draft'|'approved' };
export type JobPack = any;
export type ResultItem = {candidateId:string;name:string;guluId?:string;detailUrl?:string;currentCompany:string;currentRole:string;sourceRound:string;label:'recommend'|'review'|'exclude';reasonCode:string;evidence:string[];ruleVersion:number;reviewStatus:string;note:string};
export type RunRecord={id:string;jobId:string;ruleVersion:number;status:'running'|'paused'|'completed'|'failed';cursor:number;total:number;inputTokens:number;outputTokens:number};

async function json<T>(url:string, init?:RequestInit):Promise<T>{
  const response=await fetch(url,{...init,headers:{'content-type':'application/json',...init?.headers}});
  const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||`请求失败 ${response.status}`); return data;
}
export const api={
  jobs:()=>json<{items:JobSummary[]}>('/api/jobs'),
  create:(input:{title:string;sourceText:string})=>json<JobPack>('/api/jobs',{method:'POST',body:JSON.stringify(input)}),
  importFile:async(title:string,file:File)=>{const form=new FormData();form.append('title',title);form.append('file',file);const r=await fetch('/api/jobs/import',{method:'POST',body:form});const d=await r.json();if(!r.ok)throw new Error(d.error);return d as JobPack},
  getJob:(id:string)=>json<{job:any;pack:JobPack}>(`/api/jobs/${id}`),
  revise:(id:string,pack:JobPack)=>json<JobPack>(`/api/jobs/${id}/rules`,{method:'PUT',body:JSON.stringify(pack)}),
  approve:(id:string,v:number)=>json<JobPack>(`/api/jobs/${id}/rules/${v}/approve`,{method:'POST'}),
  runDemo:(id:string)=>json<RunRecord>(`/api/jobs/${id}/runs/demo`,{method:'POST'}),
  processRun:(id:string,limit=5)=>json<RunRecord>(`/api/runs/${id}/process`,{method:'POST',body:JSON.stringify({limit})}),
  pauseRun:(id:string)=>json<RunRecord>(`/api/runs/${id}/pause`,{method:'POST'}),
  resumeRun:(id:string)=>json<RunRecord>(`/api/runs/${id}/resume`,{method:'POST'}),
  results:(id:string)=>json<{items:ResultItem[]}>(`/api/jobs/${id}/results`),
  review:(jobId:string,candidateId:string,ruleVersion:number,status:string,note:string)=>json(`/api/jobs/${jobId}/reviews/${encodeURIComponent(candidateId)}`,{method:'PUT',body:JSON.stringify({ruleVersion,status,note})}),
  testDeepSeek:(baseUrl:string,model:string)=>json<any>('/api/settings/test-deepseek',{method:'POST',body:JSON.stringify({baseUrl,model})}),
  deleteJob:(id:string)=>json(`/api/jobs/${id}`,{method:'DELETE'}),
};
