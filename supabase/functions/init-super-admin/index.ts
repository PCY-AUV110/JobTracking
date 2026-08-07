/// <reference lib="deno.ns" />
// ============================================================
// Edge Function: init-super-admin
// 功能：首次部署时将指定邮箱提升为 super_admin（一次性引导）
// 安全策略：
//   - 公开可调用，但仅当系统中尚不存在任何 super_admin 时才生效
//   - 一旦存在 super_admin，本函数永久拒绝执行（自毁语义）
//   - 部署完成后建议在 Supabase Dashboard 中删除该 Function
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "仅支持 POST 请求" }, 405);
  }

  try {
    if (!SERVICE_ROLE_KEY) {
      return json({ error: "服务端未配置 SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- 1. 一次性守卫：若已存在 super_admin 则永久拒绝 ----
    const { data: existing, error: existErr } = await adminClient
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1);
    if (existErr) throw existErr;
    if (existing && existing.length > 0) {
      return json(
        { error: "系统已存在超级管理员，本接口已自毁，请通过管理员面板操作。" },
        403
      );
    }

    // ---- 2. 解析邮箱 ----
    const { email } = await req.json();
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return json({ error: "缺少合法的 email 字段" }, 400);
    }

    // ---- 3. 提升为 super_admin ----
    const { data: updated, error: updateErr } = await adminClient
      .from("profiles")
      .update({ role: "super_admin", updated_at: new Date().toISOString() })
      .eq("email", email)
      .select("id, email, role")
      .maybeSingle();
    if (updateErr) throw updateErr;
    if (!updated) {
      return json(
        { error: "未找到该邮箱对应的用户，请确认用户已注册后再执行。" },
        404
      );
    }

    return json({
      ok: true,
      message: "超级管理员初始化成功。本接口现已失效，建议尽快在 Dashboard 删除该 Function。",
      user: updated,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
