// ============================================================
// Supabase 客户端配置
// ============================================================
//
// 使用步骤：
// 1. 访问 https://supabase.com 注册并创建一个新项目
// 2. 进入项目后打开 Settings → API
// 3. 复制 "Project URL" 和 "anon public" key，填入下方两个常量
// 4. 打开 Supabase Dashboard → SQL Editor
// 5. 粘贴 supabase-schema.sql 全部内容并执行
// 6. （可选）Authentication → Providers → Email
//    确认 "Enable Email signup" 已开启
//    开发期可在 Authentication → Settings 中关闭 "Confirm email"
// ============================================================

const SUPABASE_URL = "https://kcivqdtnxygtfkohdvgn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KvNFPZVa-xa_0DVY190a7A_7N_vsNDk";

// 检查凭证是否已填写
const SUPABASE_CONFIGURED =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  SUPABASE_URL !== "YOUR_SUPABASE_URL" &&
  SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY" &&
  SUPABASE_URL.startsWith("https://");

// 初始化 Supabase 客户端（window.supabase 由 CDN 提供）
let supabase = null;
if (SUPABASE_CONFIGURED && window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,   // 本地持久化登录状态
      autoRefreshToken: true,  // 自动刷新 token
      detectSessionInUrl: true
    }
  });
}
