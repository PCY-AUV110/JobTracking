import { cors } from "../_shared/core.ts";
import { authenticate, resolveResume, expireClosed, cards, ok, fail } from "../_shared/feed.ts";

Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});const a=await authenticate(req);if(a.error)return a.error;if(req.method!=="GET")return fail("method_not_allowed","GET required",a.rid,405);try{const url=new URL(req.url);const resumeId=await resolveResume(a.caller!.id,url.searchParams.get("resume_id"));if(!resumeId)return fail("resume_required","Upload and parse a resume first",a.rid,422);await expireClosed(a.caller!.id);return ok(await cards(a.caller!.id,resumeId,url.searchParams,true),a.rid);}catch(e){return fail("internal_error",e instanceof Error?e.message:String(e),a.rid,500);}});
