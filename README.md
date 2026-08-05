# JobTrack

一个云端求职申请管理系统，支持邮箱密码登录、多设备数据同步。

## 功能

- 邮箱 + 密码登录注册（基于 Supabase Auth）
- 职位申请新增、编辑、删除
- 状态快速切换
- 进行中 / 已终止 / 全部记录
- 面试日程与月历
- 状态、渠道、转化率与趋势统计
- Supabase 云端数据库（多设备同步）
- JSON 导入与导出（账户级备份）
- 行级安全策略（RLS）：每个用户只能看到自己的数据
- Claude 风格主题设计

## 技术栈

- 前端：原生 HTML / CSS / JavaScript（无构建工具）
- 后端：[Supabase](https://supabase.com)（PostgreSQL + Auth + RLS）
- Supabase JS SDK 通过 CDN 引入

## 项目结构

```text
jobtrack_github_demo/
├── index.html            # 应用入口与 UI 结构
├── app.js                # 主逻辑（数据层 + 渲染 + 认证）
├── supabase-config.js    # Supabase 客户端配置（需自行填入凭证）
├── supabase-schema.sql   # Supabase 数据库表结构 + RLS 策略
├── styles.css            # 应用样式
├── service-worker.js     # PWA 静态资源缓存
├── manifest.json         # PWA 配置
└── README.md             # 本文件
```

## 首次配置（重要）

### 1. 创建 Supabase 项目

访问 <https://supabase.com> 注册账号并创建一个新项目。
新建项目时记下你设置的数据库密码与区域。

### 2. 执行数据库 Schema

进入 Supabase Dashboard → SQL Editor → New query，
将本仓库根目录下的 `supabase-schema.sql` 全部内容粘贴进去并点击 Run。

该脚本会创建以下三张表并配置 RLS 策略：

| 表名          | 用途                       |
| ------------- | -------------------------- |
| applications   | 职位申请记录               |
| interviews    | 面试记录                   |
| settings      | 用户偏好（紧凑模式等）     |

每张表都启用 RLS，并通过 `auth.uid() = user_id` 确保用户只能访问自己的数据。
插入时 `user_id` 会被触发器自动填充，前端无需传入。

### 3. 配置认证方式

进入 Supabase Dashboard → Authentication → Providers → Email：

- 确认 Email 已启用
- 开发期可在 Authentication → Settings 中关闭 "Confirm email"，
  这样注册即可直接登录，方便调试

### 3.1（可选）启用第三方 OAuth 登录

应用已内置 Google 与 GitHub 登录按钮。若要启用，需在 Supabase 中配置对应 Provider：

**Google OAuth：**

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)，创建一个项目
2. 进入 APIs & Services → Credentials → Create Credentials → OAuth client ID
3. Application type 选 Web application
4. Authorized redirect URIs 填入：
   ```
   https://kcivqdtnxygtfkohdvgn.supabase.co/auth/v1/callback
   ```
   （把 `kcivqdtnxygtfkohdvgn` 替换为你的项目 ID）
5. 创建后复制 Client ID 与 Client Secret
6. 回到 Supabase Dashboard → Authentication → Providers → Google
7. 开启 Enable，粘贴 Client ID 与 Client Secret，保存

**GitHub OAuth：**

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 New OAuth App
3. Homepage URL 填你的网站地址（如 `https://你的用户名.github.io/仓库名/`）
4. Authorization callback URL 填：
   ```
   https://kcivqdtnxygtfkohdvgn.supabase.co/auth/v1/callback
   ```
5. 注册后复制 Client ID 与 Client Secret
6. 回到 Supabase Dashboard → Authentication → Providers → GitHub
7. 开启 Enable，粘贴 Client ID 与 Client Secret，保存

配置完成后，应用登录页的 Google / GitHub 按钮即可使用。

### 4. 填写项目凭证

进入 Supabase Dashboard → Settings → API，复制：

- **Project URL**（形如 `https://xxxxx.supabase.co`）
- **Project API Keys** 中的 `anon` `public` key

编辑本仓库根目录的 `supabase-config.js`，将占位符替换为你的值：

```js
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5...你的 anon key";
```

> 请勿提交 `service_role` 密钥到公开仓库，本应用只使用 anon key。

## 本地运行

推荐通过本地服务器打开（保证 Service Worker 与相对路径正常工作）：

```bash
python3 -m http.server 8000
```

访问 <http://localhost:8000>，注册账号并登录即可使用。

## GitHub Pages 部署

1. 新建 GitHub 仓库。
2. 上传本项目内全部文件（包括 `.gitignore`、`supabase-config.js`、`supabase-schema.sql`）。
3. 打开仓库 Settings → Pages。
4. 选择 Deploy from a branch → main 分支 → /root 目录。
5. 保存后等待 GitHub Pages 生成网址（形如 `https://你的用户名.github.io/仓库名/`）。

部署后数据存储在 Supabase 云端，与 GitHub Pages 仓库无关，
任何设备登录同一邮箱即可看到同一份数据。

### 重要：部署后配置 OAuth 重定向 URL

部署到 GitHub Pages 后，如果使用了 Google / GitHub 第三方登录，需在 Supabase 中追加重定向 URL：

1. Supabase Dashboard → Authentication → URL Configuration
2. Site URL 填你的 GitHub Pages 网址（如 `https://你的用户名.github.io/仓库名/`）
3. Redirect URLs 添加：
   ```
   https://你的用户名.github.io/仓库名/
   http://localhost:8000/
   ```
   （前者用于线上，后者用于本地开发）

邮箱密码登录不受影响，无需此配置。

## 安全说明

- 所有读写都受 RLS 策略限制，匿名用户和已登录用户都只能访问自己的数据。
- `anon` key 是公开密钥，可安全暴露在前端代码中（受 RLS 保护）。
- `service_role` 密钥具有绕过 RLS 的权限，**绝不可** 提交到前端代码或公开仓库。

## 数据备份

进入 "系统设置 → 数据管理"：

- **导出 JSON**：下载当前账户下所有职位、面试与设置到本地文件。
- **导入 JSON**：将本地备份恢复到当前登录的云端账户（会覆盖现有数据）。
