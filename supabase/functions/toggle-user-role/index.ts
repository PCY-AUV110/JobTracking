// ============================================================
// Edge Function: toggle-user-role
// 功能：将指定用户的角色设置为 user 或 admin
// 权限：仅 super_admin 可调用
// 部署后通过 service_role key 绕过 RLS 写 profiles.role
// 类型：deno.json 已在项目根目录配置 Deno 类型
// ============================================================

// @ts-ignore - Supabase Edge Functions 使用 Deno 运行时，esm.sh 模块在 TS 中无法解析
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

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

// @ts-ignore - Supabase Edge Functions 运行时支持 Deno.serve，但类型定义可能缺失
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
      return json({ error: "权限不足，仅超级管理员可切换角色" }, 403);
    }

    // ---- 3. 解析参数 ----
    const { targetUserId, newRole } = await req.json();
    if (!targetUserId || typeof targetUserId !== "string") {
      return json({ error: "缺少 targetUserId" }, 400);
    }
    if (!["user", "admin"].includes(newRole)) {
      return json({ error: "newRole 必须为 'user' 或 'admin'" }, 400);
    }
    if (targetUserId === user.id) {
      return json({ error: "不能修改自己的角色" }, 400);
    }

    // ---- 4. 读取目标用户并校验 ----
    const { data: target, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, role, email")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ error: "目标用户不存在" }, 404);

    // super_admin 不可被修改（防止权限降级或循环授权）
    if (target.role === "super_admin") {
      return json({ error: "不能修改超级管理员的角色" }, 400);
    }

    // 目标已是该角色，无需更新
    if (target.role === newRole) {
      return json({
        ok: true,
        userId: targetUserId,
        email: target.email,
        role: newRole,
        note: "用户已是该角色，未做变更",
      });
    }

    // ---- 5. 执行更新 ----
    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq("id", targetUserId);
    if (updateErr) throw updateErr;

    return json({
      ok: true,
      userId: targetUserId,
      email: target.email,
      previousRole: target.role,
      newRole,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
