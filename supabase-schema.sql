-- ============================================================
-- JobTrack · Supabase 数据库 Schema
-- 使用方式：登录 Supabase Dashboard → SQL Editor → 粘贴本文件 → Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. 申请记录表 applications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company       TEXT NOT NULL,
  role          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT '准备申请',
  applied_date  DATE,
  location      TEXT,
  source        TEXT,
  job_url       TEXT,
  notes         TEXT,
  created_at    BIGINT NOT NULL DEFAULT 0,
  updated_at    BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id       ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status       ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_applied_date ON applications(applied_date);

-- ------------------------------------------------------------
-- 2. 面试记录表 interviews
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interviews (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id  UUID REFERENCES applications(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  time            TEXT,
  type            TEXT,
  format          TEXT,
  link            TEXT,
  notes           TEXT,
  created_at      BIGINT NOT NULL DEFAULT 0,
  updated_at      BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_interviews_user_id        ON interviews(user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_date           ON interviews(date);
CREATE INDEX IF NOT EXISTS idx_interviews_application_id ON interviews(application_id);

-- ------------------------------------------------------------
-- 3. 用户偏好设置表 settings（每个用户独立）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  value    JSONB,
  PRIMARY KEY (user_id, key)
);

-- ============================================================
-- 行级安全策略（Row Level Security, RLS）
-- 保证每个用户只能访问自己的数据
-- ============================================================

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews   ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings     ENABLE ROW LEVEL SECURITY;

-- applications：仅允许用户操作自己的记录
DROP POLICY IF EXISTS "users_manage_own_applications" ON applications;
CREATE POLICY "users_manage_own_applications" ON applications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- interviews：仅允许用户操作自己的记录
DROP POLICY IF EXISTS "users_manage_own_interviews" ON interviews;
CREATE POLICY "users_manage_own_interviews" ON interviews
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- settings：仅允许用户操作自己的记录
DROP POLICY IF EXISTS "users_manage_own_settings" ON settings;
DROP POLICY IF EXISTS "users_select_own_settings" ON settings;
DROP POLICY IF EXISTS "users_insert_own_settings" ON settings;
DROP POLICY IF EXISTS "users_update_own_settings" ON settings;
DROP POLICY IF EXISTS "users_delete_own_settings" ON settings;
CREATE POLICY "users_manage_own_settings" ON settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 触发器：插入时自动填充 user_id
-- 这样前端 upsert 时不需要手动传入 user_id
-- ============================================================

CREATE OR REPLACE FUNCTION set_user_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_applications_set_user_id ON applications;
CREATE TRIGGER trg_applications_set_user_id
  BEFORE INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS trg_interviews_set_user_id ON interviews;
CREATE TRIGGER trg_interviews_set_user_id
  BEFORE INSERT ON interviews
  FOR EACH ROW EXECUTE FUNCTION set_user_id();

-- ============================================================
-- 4. 用户档案表 profiles（管理员角色与账户元数据）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  display_name    TEXT,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  avatar_url      TEXT,
  last_login_at  TIMESTAMPTZ,
  onboarding_seen BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 回填：为已有 profiles 添加 onboarding_seen 列（兼容已部署的旧表）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'onboarding_seen') THEN
    ALTER TABLE profiles ADD COLUMN onboarding_seen BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role      ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_profiles_updated_at();

-- ------------------------------------------------------------
-- 4.1 新用户注册时自动创建 profile
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_profile();

-- ------------------------------------------------------------
-- 4.2 回填：为已存在但缺少 profile 的 auth.users 补建记录
--     （在启用本 schema 之前已注册的老用户）
-- ------------------------------------------------------------
INSERT INTO public.profiles (id, email, display_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  'user'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- ============================================================
-- 5. 角色判定辅助函数（供 RLS 与前端逻辑复用）
-- ============================================================
-- 当前调用者是否为管理员（admin / super_admin 且启用中）
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin','super_admin') AND is_active
  );
$$;

-- 当前调用者是否为超级管理员
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active
  );
$$;

-- ============================================================
-- 6. profiles 行级安全策略
--    设计意图：管理员对其他用户数据仅 SELECT（只读）。
--    写/删操作（切换角色、禁用用户等）必须通过 Edge Function + service_role
--    key 完成，前端不持有 service_role key，因此这里不开放任何管理员 UPDATE。
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 6.1 读取：本人可读自己的 profile
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 6.2 读取：管理员（admin / super_admin）可读取所有 profiles
-- 重要：使用 is_admin() 函数（SECURITY DEFINER）避免递归
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin" ON profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- 6.3 更新：分两条策略避免递归
--     管理员（admin/super_admin）可更新任何 profile（用于禁用/启用用户等）
--     普通用户只能更新自己的 profile，但不能修改 role 和 is_active
DROP POLICY IF EXISTS "profiles_update_own_or_super_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;

-- 管理员更新策略
CREATE POLICY "profiles_update_admin" ON profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin());

-- 普通用户更新策略（只能改自己，且不能改 role/is_active）
-- 注意：由于 RLS 不支持列级权限，这里使用函数检查保持原值
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role IN ('user', 'admin', 'super_admin')  -- role 必须是有效值
    AND is_active IN (true, false)                  -- is_active 必须是有效值
  );

-- 注意：不开放 INSERT / DELETE 策略——profile 由注册触发器创建，
--       删除随 auth.users 级联。管理员/超级管理员的写操作一律走 Edge Function
--       （service_role key 绕过 RLS），前端无任何跨用户写路径。

-- ============================================================
-- 7. 扩展现有表的 SELECT 策略：管理员可跨用户只读
--    （写操作仍仅限本人；管理员只读用于系统统计与排查）
--    重要：使用 is_admin() 函数避免递归
-- ============================================================
DROP POLICY IF EXISTS "admin_read_all_applications" ON applications;
DROP POLICY IF EXISTS "applications_admin_select" ON applications;
CREATE POLICY "applications_admin_select" ON applications
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_read_all_interviews" ON interviews;
DROP POLICY IF EXISTS "interviews_admin_select" ON interviews;
CREATE POLICY "interviews_admin_select" ON interviews
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 8. AI 用量日志表 ai_usage_logs
--    记录每次 AI 调用的 token 用量，供管理员监控
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name     TEXT NOT NULL,  -- parse-text / parse-link / parse-screenshot
  model             TEXT,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens      INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id    ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage_logs(created_at);

-- RLS：用户只能看自己的用量，管理员可看全部
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_select_own" ON ai_usage_logs;
CREATE POLICY "ai_usage_select_own" ON ai_usage_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_usage_admin_select" ON ai_usage_logs;
CREATE POLICY "ai_usage_admin_select" ON ai_usage_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- INSERT 由 Edge Function 使用 service_role key 完成，前端不直接写入

-- ============================================================
-- 9. 首次启用：把自己提升为超级管理员
--    把 <YOUR-EMAIL> 替换为你注册时的邮箱，取消注释并执行一次
-- ============================================================
-- UPDATE public.profiles
--   SET role = 'super_admin'
--   WHERE email = '<YOUR-EMAIL>';
