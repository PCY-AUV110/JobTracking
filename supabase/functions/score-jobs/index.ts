import { cors, admin, user, ok, fail, requestId } from "../_shared/core.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const identity = /(citizen|permanent resident|\bPR\b|security clearance|公民|永久居民|安全许可)/i;
const tokens = (v: string) => new Set(v.toLowerCase().match(/[a-z0-9+#.]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []);

function timingAdjustment(jd: string, preferences: any) {
  const durationPatterns: Record<string, RegExp> = {
    "4m": /(?:4|four)[ -]?(?:month|months|mo\b)|四个月/i,
    "8m": /(?:8|eight)[ -]?(?:month|months|mo\b)|八个月/i,
    "12m": /(?:12|twelve)[ -]?(?:month|months|mo\b)|一年/i,
  };
  const seasonPatterns: Record<string, RegExp> = {
    fall: /\b(?:fall|autumn)\b|秋季/i,
    winter: /\bwinter\b|冬季/i,
    summer: /\bsummer\b|夏季/i,
  };
  const preferredDurations: string[] = preferences?.internship_duration ?? [];
  const preferredSeasons: string[] = preferences?.start_season ?? [];
  const foundDurations = Object.keys(durationPatterns).filter((k) => durationPatterns[k].test(jd));
  const foundSeasons = Object.keys(seasonPatterns).filter((k) => seasonPatterns[k].test(jd));
  let points = 0;
  const signals: string[] = [];
  if (preferredDurations.length && foundDurations.length) {
    const match = foundDurations.some((v) => preferredDurations.includes(v));
    points += match ? 8 : -5;
    signals.push(match ? "duration_match" : "duration_conflict");
  }
  if (preferredSeasons.length && foundSeasons.length) {
    const match = foundSeasons.some((v) => preferredSeasons.includes(v));
    points += match ? 8 : -5;
    signals.push(match ? "season_match" : "season_conflict");
  }
  return { points, signals, found_durations: foundDurations, found_seasons: foundSeasons };
}

Deno.serve(async (req: Request) => {
  const rid = requestId();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "POST required", rid, 405);
  try {
    const u = await user(req);
    const body = await req.json();
    if (!body.resume_id) return fail("invalid_request", "resume_id required", rid);
    const db = admin();
    const { data: resume, error: resumeError } = await db.from("resumes").select("*").eq("id", body.resume_id).eq("user_id", u.id).single();
    if (resumeError || !resume) return fail("not_found", "Resume not found", rid, 404);
    const { data: preferences } = await db.from("job_preferences").select("*").eq("user_id", u.id).maybeSingle();
    let query = db.from("jobs").select("*").neq("status", "closed").limit(Math.min(Number(body.limit) || 100, 500));
    if (body.job_ids?.length) query = query.in("id", body.job_ids);
    const { data: jobs, error } = await query;
    if (error) throw error;
    const resumeTokens = tokens(`${resume.raw_text} ${(preferences?.keywords ?? []).join(" ")}`);
    let passed = 0, hardFiltered = 0, llmCalls = 0, totalTokens = 0;
    const results: any[] = [];
    for (const job of jobs ?? []) {
      const blocked = preferences?.filter_pr_citizen !== false && identity.test(`${job.identity_requirements_raw ?? ""} ${job.jd_raw ?? ""}`);
      const jobTokens = tokens(`${job.title} ${job.jd_raw}`);
      const overlap = [...jobTokens].filter((x) => resumeTokens.has(x)).length;
      const timing = timingAdjustment(job.jd_raw ?? "", preferences);
      const baseRule = 35 + 65 * overlap / Math.max(1, Math.min(jobTokens.size, 30));
      const ruleScore = Math.max(0, Math.min(100, Math.round(baseRule + timing.points)));
      if (blocked) {
        hardFiltered++;
        const { data: match } = await db.from("job_matches").upsert({job_id:job.id,resume_id:resume.id,user_id:u.id,rule_score:0,rule_passed:false,gaps:{hard_filter:["identity_requirement"],timing}},{onConflict:"job_id,resume_id,user_id"}).select("id").single();
        results.push({job_id:job.id,match_id:match?.id,rule_score:0,rule_passed:false,llm_grade:null,llm_score:null});
        continue;
      }
      passed++;
      let score = ruleScore;
      let grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : score >= 50 ? "E" : "F";
      let gaps: any = {missing_keywords:[...jobTokens].filter((x)=>!resumeTokens.has(x)).slice(0,15),timing};
      if (OPENAI_API_KEY) {
        const ai = await fetch("https://api.openai.com/v1/chat/completions", {method:"POST",headers:{authorization:`Bearer ${OPENAI_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini",response_format:{type:"json_object"},temperature:0,max_tokens:350,messages:[{role:"system",content:"Score resume-job fit. Return JSON {score:0-100,grade:A-F,gaps:{missing_skills:[],notes:[]}}. Timing preferences are soft signals only; do not reject on timing."},{role:"user",content:`RESUME\n${resume.raw_text.slice(0,10000)}\nPREFERENCES\n${JSON.stringify({internship_duration:preferences?.internship_duration??[],start_season:preferences?.start_season??[]})}\nJOB\n${job.jd_raw.slice(0,10000)}`}]})});
        if (ai.ok) {
          const payload = await ai.json(); const value = JSON.parse(payload.choices[0].message.content);
          score = Math.max(0, Math.min(100, (Number(value.score) || ruleScore) + timing.points));
          grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : score >= 50 ? "E" : "F";
          gaps = {...(value.gaps ?? {}),timing}; llmCalls++; totalTokens += payload.usage?.total_tokens ?? 0;
          await db.from("ai_usage_logs").insert({user_id:u.id,function_name:"score-jobs",model:"gpt-4o-mini",prompt_tokens:payload.usage?.prompt_tokens??0,completion_tokens:payload.usage?.completion_tokens??0,total_tokens:payload.usage?.total_tokens??0});
        }
      }
      const { data: match, error: matchError } = await db.from("job_matches").upsert({job_id:job.id,resume_id:resume.id,user_id:u.id,rule_score:ruleScore,rule_passed:true,llm_grade:grade,llm_score:score,gaps},{onConflict:"job_id,resume_id,user_id"}).select("id").single();
      if (matchError) throw matchError;
      results.push({job_id:job.id,match_id:match.id,rule_score:ruleScore,rule_passed:true,llm_grade:grade,llm_score:score});
    }
    const closed = (await db.from("jobs").select("id").eq("status","closed")).data?.map((x:any)=>x.id) ?? [];
    if (closed.length) await db.from("job_matches").update({status:"expired"}).eq("user_id",u.id).neq("status","applied").in("job_id",closed);
    return ok({batch_id:crypto.randomUUID(),considered:(jobs??[]).length,scored:results.length,passed,hard_filtered:hardFiltered,llm_calls:llmCalls,tokens_used:totalTokens,results},rid);
  } catch (e) {
    const message=e instanceof Error?e.message:String(e);
    return fail(message==="unauthenticated"?"unauthenticated":"internal_error",message,rid,message==="unauthenticated"?401:500);
  }
});
