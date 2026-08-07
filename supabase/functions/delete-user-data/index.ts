/// <reference lib="deno.ns" />
// ============================================================
// Edge Function: delete-user-data
// 功能：清除指定用户的所有数据
//   - mode: "data"   仅删除 applications + interviews + settings（保留账户）
//   - mode: "account" 删除业务数据并注销 auth.users（账户级联删除 profile）
// 权限：仅 super_admin 可调用
// 警告：此操作不可逆，前端必须二次确认
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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
    // ---- 1. 验证调用者身份 ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "未提供 Authorization 头" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "未认证" }, 401);

    // ---- 2. 校验调用者为 super_admin ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: caller, error: callerErr } = await adminClient
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (callerErr) throw callerErr;
    if (!caller || caller.role !== "super_admin" || !caller.is_active) {
      return json({ error: "权限不足，仅超级管理员可清除用户数据" }, 403);
    }

    // ---- 3. 解析参数 ----
    const { targetUserId, mode = "data" } = await req.json();
    if (!targetUserId || typeof targetUserId !== "string") {
      return json({ error: "缺少 targetUserId" }, 400);
    }
    if (targetUserId === user.id) {
      return json({ error: "不能删除自己的数据" }, 400);
    }
    if (mode !== "data" && mode !== "account") {
      return json({ error: "mode 必须为 'data' 或 'account'" }, 400);
    }

    // 校验目标存在且非 super_admin（保护超级管理员账户）
    const { data: target, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, role, email")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ error: "目标用户不存在" }, 404);
    if (target.role === "super_admin") {
      return json({ error: "不能删除超级管理员的数据" }, 400);
    }

    // ---- 4. 删除业务数据 ----
    const [delApps, delInterviews, delSettings] = await Promise.all([
      adminClient.from("applications").delete().eq("user_id", targetUserId),
      adminClient.from("interviews").delete().eq("user_id", targetUserId),
      adminClient.from("settings").delete().eq("user_id", targetUserId),
    ]);
    if (delApps.error) throw delApps.error;
    if (delInterviews.error) throw delInterviews.error;
    if (delSettings.error) throw delSettings.error;

    // ---- 5. 若为账户模式，注销 auth.users（触发 profile 级联删除）----
    let accountDeleted = false;
    if (mode === "account") {
      const { error: delUserErr } = await adminClient.auth.admin.deleteUser(
        targetUserId
      );
      if (delUserErr) throw delUserErr;
      accountDeleted = true;
    }

    return json({
      ok: true,
      userId: targetUserId,
      email: target.email,
      mode,
      accountDeleted,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
