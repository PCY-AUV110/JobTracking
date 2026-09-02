import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

export const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, PATCH, OPTIONS"};
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const admin = () => createClient(url, service, {auth:{persistSession:false}});
export const requestId = () => crypto.randomUUID();
export const ok = (data:unknown,id:string,status=200) => new Response(JSON.stringify({data,meta:{request_id:id}}),{status,headers:{...cors,"content-type":"application/json"}});
export const fail = (code:string,message:string,id:string,status=400,details:unknown={}) => new Response(JSON.stringify({error:{code,message,details},meta:{request_id:id}}),{status,headers:{...cors,"content-type":"application/json"}});
export async function user(req:Request) {
  const auth = req.headers.get("authorization") ?? "";
  const client = createClient(url, anon, {global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:{user},error} = await client.auth.getUser();
  if (error || !user) throw new Error("unauthenticated");
  return user;
}
export function requireService(req:Request) {
  const token=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  let role="";
  try { role=JSON.parse(atob(token.split(".")[1])).role??""; } catch { /* opaque secret key */ }
  // Gateway JWT verification already validates legacy JWT signatures. Modern
  // opaque secret keys are compared against the runtime-provided service key.
  if ((!service || token !== service) && role !== "service_role") throw new Error("forbidden");
}
export const text = (v:unknown) => typeof v === "string" ? v : "";
export function stripHtml(v:string){return v.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();}
export async function sha256(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
