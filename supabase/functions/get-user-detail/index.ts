/// <reference lib="deno.ns" />
// ============================================================
// Edge Function: get-user-detail
// 功能：获取指定用户的完整数据（profile + applications + interviews）
// 权限：admin 及以上（admin / super_admin）
// 说明：用于管理员查看某用户的申请与面试明细
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  if (req.method !== "GET") {
    return json({ error: "仅支持 GET 请求" }, 405);
  }

  try {
    // ---- 1. 验证调用者身份 ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "未提供 Authorization 头" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "未认证" }, 401);

    // ---- 2. 校验调用者为 admin+ ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: caller, error: callerErr } = await adminClient
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (callerErr) throw callerErr;
    if (!caller || !["admin", "super_admin"].includes(caller.role) || !caller.is_active) {
      return json({ error: "权限不足，仅管理员可查看用户明细" }, 403);
    }

    // ---- 3. 解析目标 userId ----
    const url = new URL(req.url);
    const targetUserId = url.searchParams.get("userId");
    if (!targetUserId) return json({ error: "缺少 userId 参数" }, 400);

    // ---- 4. 并行拉取该用户的全部数据 ----
    const [profileRes, appsRes, interviewsRes] = await Promise.all([
      adminClient.from("profiles").select("*").eq("id", targetUserId).maybeSingle(),
      adminClient.from("applications").select("*").eq("user_id", targetUserId).order("created_at", { ascending: false }),
      adminClient.from("interviews").select("*").eq("user_id", targetUserId).order("date", { ascending: false }),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) return json({ error: "目标用户不存在" }, 404);

    return json({
      profile: profileRes.data,
      applications: appsRes.data ?? [],
      interviews: interviewsRes.data ?? [],
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
