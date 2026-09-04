import { admin, fail, ok, requestId, user } from "./core.ts";

export async function resolveResume(userId:string, requested:string|null){
  const db=admin();
  let q=db.from("resumes").select("id").eq("user_id",userId).eq("status","parsed");
  q=requested?q.eq("id",requested):q.order("created_at",{ascending:false}).limit(1);
  const {data,error}=await q.maybeSingle();
  if(error)throw error;
  return data?.id??null;
}

export async function expireClosed(userId:string){
  const db=admin();
  const {data:closed}=await db.from("jobs").select("id").eq("status","closed");
  const ids=(closed??[]).map((x:any)=>x.id);
  if(ids.length)await db.from("job_matches").update({status:"expired"}).eq("user_id",userId).in("status",["new","viewed"]).in("job_id",ids);
}

export async function cards(userId:string,resumeId:string,params:URLSearchParams,history=false){
  const db=admin();const limit=Math.min(Number(params.get("limit"))|| (history?20:50),history?100:200);const offset=Math.max(Number(params.get("offset"))||0,0);
  let q=db.from("job_matches").select("*,jobs!inner(*)",{count:"exact"}).eq("user_id",userId).eq("resume_id",resumeId).order("created_at",{ascending:false}).range(offset,offset+limit-1);
  const status=params.get("status");if(status)q=q.eq("status",status);else if(!history)q=q.neq("status","expired");
  const grade=params.get("grade");if(grade)q=q.eq("llm_grade",grade);
  const modes=(params.get("work_mode")??"").split(",").filter(v=>["in_person","remote","hybrid"].includes(v));if(modes.length)q=q.in("jobs.work_mode",modes);
  const countries=(params.get("country")??"").split(",").filter(v=>["US","CA"].includes(v));if(countries.length)q=q.in("jobs.country_code",countries);
  const {data,error,count}=await q;if(error)throw error;
  const jobIds=(data??[]).map((m:any)=>m.job_id);const latest=new Map<string,any>();
  if(jobIds.length){const {data:reviews}=await db.from("vetting_reviews").select("job_id,risk_rating,status,created_at").in("job_id",jobIds).order("created_at",{ascending:false});for(const v of reviews??[])if(!latest.has(v.job_id))latest.set(v.job_id,v);}
  let rows=(data??[]).map((m:any)=>{const j=m.jobs??{},v=latest.get(m.job_id);return {match_id:m.id,job_id:m.job_id,company_legal_name:j.company_legal_name,title:j.title,location_city:j.location_city,work_mode:j.work_mode,country_code:j.country_code,salary_raw:j.salary_raw,jd_summary:j.jd_summary,apply_url:j.apply_url,employment_type:j.employment_type,llm_grade:m.llm_grade,llm_score:m.llm_score,risk_rating:v?.risk_rating??null,vetting_status:v?.status??"pending",match_status:m.status,job_status:j.status,viewed_at:m.viewed_at,applied_at:m.applied_at,created_at:m.created_at};});
  const risk=params.get("risk_rating");if(risk)rows=rows.filter((x:any)=>x.risk_rating===risk);
  return {jobs:rows,total:count??rows.length};
}

export async function authenticate(req:Request){const rid=requestId();try{return {caller:await user(req),rid,error:null};}catch{return {caller:null,rid,error:fail("unauthenticated","Authentication required",rid,401)};}}
export {ok,fail};
