// ============================================================
// Edge Function: get-system-stats
// 功能：后端聚合系统级统计数据（用户、申请、面试、状态分布）
// 权限：admin 及以上（admin / super_admin）
// 说明：使用 service_role 跨用户聚合，head:true 高效计数
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
      return json({ error: "权限不足，仅管理员可查看系统统计" }, 403);
    }

    // ---- 3. 并行聚合：head:true 高效计数 + 必要数据拉取 ----
    // 3a. 用 head:true 获取总量计数（不返回行数据，仅 count）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      totalUsersRes,
      activeUsersRes,
      totalAppsRes,
      totalInterviewsRes,
      recentSignupsRes,
      // 3b. 拉取必要的维度数据用于聚合
      profilesRes,
      applicationsRes,
    ] = await Promise.all([
      adminClient.from("profiles").select("*", { count: "exact", head: true }),
      adminClient.from("profiles").select("*", { count: "exact", head: true }).eq("is_active", true),
      adminClient.from("applications").select("*", { count: "exact", head: true }),
      adminClient.from("interviews").select("*", { count: "exact", head: true }),
      adminClient.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      adminClient.from("profiles").select("id, role, created_at, last_login_at"),
      adminClient.from("applications").select("id, status, user_id"),
    ]);

    if (totalUsersRes.error) throw totalUsersRes.error;
    if (activeUsersRes.error) throw activeUsersRes.error;
    if (totalAppsRes.error) throw totalAppsRes.error;
    if (totalInterviewsRes.error) throw totalInterviewsRes.error;
    if (recentSignupsRes.error) throw recentSignupsRes.error;
    if (profilesRes.error) throw profilesRes.error;
    if (applicationsRes.error) throw applicationsRes.error;

    // ---- 4. 用户维度统计 ----
    const totalUsers = totalUsersRes.count ?? 0;
    const activeUsers = activeUsersRes.count ?? 0;
    const recentSignups = recentSignupsRes.count ?? 0;
    const profiles = profilesRes.data ?? [];
    const roleCount = { user: 0, admin: 0, super_admin: 0 };
    profiles.forEach((p) => {
      if (p.role in roleCount) roleCount[p.role as keyof typeof roleCount]++;
    });

    // 最近 7 天有登录的用户
    const logged7d = profiles.filter((p) => {
      if (!p.last_login_at) return false;
      return new Date(p.last_login_at).getTime() >= new Date(sevenDaysAgo).getTime();
    }).length;

    // ---- 5. 申请维度统计 ----
    const totalApplications = totalAppsRes.count ?? 0;
    const applications = applicationsRes.data ?? [];
    const statusCount: Record<string, number> = {};
    applications.forEach((a) => {
      statusCount[a.status] = (statusCount[a.status] ?? 0) + 1;
    });
    const uniqueApplicants = new Set(applications.map((a) => a.user_id)).size;

    // ---- 6. 面试维度统计 ----
    const totalInterviews = totalInterviewsRes.count ?? 0;

    // ---- 7. 返回聚合结果 ----
    return json({
      generatedAt: new Date().toISOString(),
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        byRole: roleCount,
        newIn7d: recentSignups,
        logged7d,
      },
      applications: {
        total: totalApplications,
        byStatus: statusCount,
        uniqueApplicants,
      },
      interviews: {
        total: totalInterviews,
      },
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
