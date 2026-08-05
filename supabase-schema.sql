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
