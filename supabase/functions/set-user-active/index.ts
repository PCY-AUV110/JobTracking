// ============================================================
// Edge Function: set-user-active
// 功能：启用 / 禁用指定用户账户
//   - 禁用：profiles.is_active = false + 调用 Auth Admin API 封禁登录
//   - 启用：profiles.is_active = true + 解除登录封禁
// 权限：admin 及以上（admin / super_admin）
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

// @ts-ignore - Deno.serve 在 Supabase Edge Functions 运行时可用
(Deno as any).serve(async (req: Request) => {
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
      return json({ error: "权限不足，仅管理员可执行此操作" }, 403);
    }

    // ---- 3. 解析参数 ----
    const { targetUserId, isActive } = await req.json();
    if (!targetUserId || typeof targetUserId !== "string") {
      return json({ error: "缺少 targetUserId" }, 400);
    }
    if (typeof isActive !== "boolean") {
      return json({ error: "isActive 必须为布尔值" }, 400);
    }
    if (targetUserId === user.id) {
      return json({ error: "不能修改自己的启用状态" }, 400);
    }

    // ---- 4. 读取目标用户并校验 ----
    const { data: target, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, role, email, is_active")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ error: "目标用户不存在" }, 404);

    // 普通管理员不能操作超级管理员
    if (target.role === "super_admin" && caller.role !== "super_admin") {
      return json({ error: "无权操作超级管理员账户" }, 403);
    }

    // ---- 5. 同步 Auth 登录封禁状态 ----
    // 禁用时设为 315576000 秒（约 10 年），这是 Supabase 的常见做法
    const banDuration = isActive ? "none" : "315576000";
    const { error: banErr } = await adminClient.auth.admin.updateUserById(
      targetUserId,
      { ban_duration: banDuration }
    );
    if (banErr) {
      // 仅记录日志，不阻断流程：即使 Auth 封禁失败，profiles.is_active 仍可更新
      console.error("[set-user-active] Auth 封禁失败:", banErr.message);
    }

    // ---- 6. 更新 profiles.is_active ----
    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", targetUserId);
    if (updateErr) throw updateErr;

    return json({
      ok: true,
      userId: targetUserId,
      email: target.email,
      isActive,
      authBanned: !isActive,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
