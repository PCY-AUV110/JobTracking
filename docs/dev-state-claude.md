# 前端开发状态（Claude Code 维护）

分支：`feature/day3-frontend`（已 push，从最新 main 切出，main 此时已含 Day1-3 前端主线 + Day2 修复 + 后端 v1 五个 Edge Function）
工区：`/Users/p.cy/Desktop/杂货铺/jobtrack-release`（独立 worktree，与主工区 `jobtrack_github_demo`、Codex 的 `jobtrack-backend` 平级），本地预览用 `python3 -m http.server 8000`

## Day3：新需求 2 项（2026-09-02，已 push，等 Codex 合并 main）

后端现状核实：v1.1 契约里的 `GET /jobs/feed`、`GET /jobs/history`、`PATCH /job_matches/:id/status` **还没有对应的 Edge Function 部署**（`supabase/functions/` 下只有 v1 的 5 个：parse-resume/crawl-jobs/score-jobs/vetting-flags/vetting-review）。所以本轮继续 mock，真实调用路径写好但关着（`JOBS_BACKEND_READY = false`，和 `resumes.js` 的 `RESUME_BACKEND_READY` 同一个模式）。

1. **"加入申请"改可撤销 toggle**：applied 状态的按钮变成 "✓ 已加入申请"，卡片上和详情弹窗里都能点它撤销回 viewed（清空 `applied_at`）。撤销**不会删除** `applications` 表里已经创建的申请记录，只回退这张卡片的匹配状态标签——如果这不是 Steven 想要的语义（比如撤销也要把申请看板里的记录一起删掉），需要再澄清。`applied -> viewed` 这个反向流转在 v1.1 契约文字里没写清楚允许还是禁止，等 Codex 发 v1.2 确认。
2. **岗位偏好新增两组**：实习时长（4m/8m/12m）、入职季节（fall/winter/summer），checkbox-pill 多选样式（跟雇佣类型那组一致），字段名 `internship_duration`/`start_season`，按 Steven 给的写，v1.2 契约若不一致要改。

commit: `7d18994`（applied 撤销 toggle + 偏好新字段）。

## 验证方式记录（这次踩了个测试脚本坑，别人接手要注意）

组合测试脚本里先测了偏好保存（里面有 `page.reload()`），再测卡片 toggle——reload 会清掉之前用 `page.evaluate` 打的 `window.dbUpsert` 桩，导致后面测 toggle 时打到真实（未登录会 401）的 `dbUpsert`，整条链路失败，但这是**测试脚本问题不是 app 问题**。改用两种独立方式验证过 toggle 逻辑本身是对的：① 直接 `page.evaluate` 调 `addJobToApplications`/`revokeApplication` 检查 `jobMatches` 状态字段（new→applied→viewed，`applied_at`/`viewed_at` 都对）；② 单独一个干净脚本里打桩后走真实 DOM 点击，卡片和按钮渲染都正确。以后写涉及 `page.reload()` 的组合测试，reload 后要重新打桩。

## Day2：生产反馈 4 项修复（2026-09-02，已 push，等 Codex 合并 main）

1. **PDF 提取报错**：本地 subpath 模拟 + 真实生产 URL（chromium+webkit 两引擎）均无法复现，判断是客户端缓存或旧 Safari worker 兼容问题。加固：加载失败自动带缓存戳重试一次；错误提示改成可操作文案；`service-worker.js` CACHE_NAME 已 bump，强制旧客户端刷新。**如果 Steven 那边还复现，需要他提供具体浏览器+版本号，以及是否是老标签页未强刷**。
2. 岗位偏好雇佣类型精简为 Part-time / Full-time / Co-op·Intern 三项，mock 数据同步。
3. 身份过滤开关配色：根因是 `.switch input:checked + span` 引用未定义的 `--claude-orange`（历史 dead variable），改用 `--accent`。
4. 智能岗位卡片流：🔄刷新按钮（mock 延迟+插入新岗位）、历史记录 tab（含 expired）、4 态状态徽标（new/viewed/applied/expired）、点卡片标记 viewed、加申请自动标记 applied。字段/端点名（`GET /jobs/feed?refresh=true`、`GET /jobs/history`、`PATCH /job_matches/:id/status`）提前对齐 Codex 即将发布的契约 v1.1。

commit: `d75279e`（PDF 修复第一版）→ `10a4411`（PDF 加固）→ `b733104`（雇佣类型+开关配色）→ `aa7349e`（卡片流刷新/历史/状态徽标）。

## 已做

- **简历中心**（`resumes.js`）：PDF 拖拽上传 → pdf.js 本地提取文本 → 预览确认 → 关键词启发式 mock 解析（技能/教育/经历/联系方式）→ 结构化结果可编辑 → 多简历版本管理（保存/设默认/编辑/删除）。`vendor/pdfjs/` 本地 vendor pdf.js 6.3.289，不走 CDN。Playwright + 真实简历 PDF 端到端验证通过。
- **岗位偏好**（`jobs.js`）：关键词/地点/雇佣类型/薪资底线/排除词 + 身份过滤开关（默认开启），localStorage 持久化。
- **智能岗位卡片流**（`jobs.js`）：8 条 mock 岗位数据，卡片含公司/岗位/地点/薪资/要求摘要/匹配等级(A-F 色)/背调风险徽标(红黄绿)/来源；按匹配分/风险/地点/来源排序，按风险筛选；详情弹窗；"加入申请"写入真实 `applications` 表（`dbUpsert` + `applicationToRow`，未登录时会被 RLS 正确拒绝并提示，逻辑已验证，真实写入效果需登录后确认）。
- 全部改动已 push 到 `origin/feature/day1-resume-center`（简历中心 + 岗位偏好/卡片流两次 commit 都已 push）。
- **契约对齐**（2026-09-02，Codex `docs/api-contracts-v1.md` frozen 后）：把本地 mock 数据形状改成和真实接口一致，字段名不用等真实接入时再改一遍：
  - `resumes.js`：`education`/`experience` 从纯字符串数组改成契约里的 `{institution/credential/field/...}`、`{company/title/highlights/...}` 结构化对象（textarea 每行仍是编辑入口，保存时包一层结构，展示时拼成一行——mock 阶段的已知简化，不做逐字段编辑器）；`contact` 加了 `location`；新增 `summary/certifications/languages` 占位字段；`callParseResumeBackend()` 改用契约里点名的 `supabase.functions.invoke("parse-resume", {body:{filename, raw_text, locale}})`，不再手写 fetch。
  - `jobs.js`：`job_preferences` 字段改 snake_case（`job_types`/`min_salary`/`excluded_keywords`/`filter_pr_citizen`），`MOCK_JOBS` 字段改成 `company_legal_name`/`location_city`/`salary_raw`/`jd_summary`/`llm_grade`/`llm_score`/`risk_rating`/`apply_url`/`ats_type`/`employment_type`，跟 `jobs`+`job_matches`+`vetting_reviews` 三表联查后一张岗位卡的字段对上；`llm_grade` 从 A-F 四档改成契约里的 A-F 六档（补了 E）。
  - localStorage key 从 v1 换成 v2（形状变了，避免读到旧结构）。
  - 已重跑 Playwright 全流程验证（简历中心 7 项 + 偏好/卡片流 6 项），全过，console 无报错。

## 在做 / 下一步

- Codex 的 `resumes`/`job_preferences`/`jobs`/`job_matches`/`vetting_reviews` migration 还没上生产库（他自己说"仍处于复核阶段"），所以 `RESUME_BACKEND_READY` 还是 false、`jobs.js` 还是读 `MOCK_JOBS`——字段已经对齐，migration 一上、client 封装函数（`parseResume`/`listMatchedJobs`/`upsertJobPreferences` 等）一给，直接换数据源，UI 不用改。
- 岗位详情弹窗目前只有基础信息占位，`jd_raw` 原文 + `job_matches.gaps` 差距分析等真实数据接入后再补。
- 背调徽标目前只做了简化的三色（`risk_rating` low/medium/high），真实 `vetting_reviews.status` 还有五态枚举（pending/auto_flagged/needs_human/approved/rejected）用于更细的状态展示，接入时再加。

## 卡点

- 无法用真实登录态验证"加入申请"完整成功路径（本机没有测试账号），只验证到 RLS 正确拦截未登录写入、前端错误处理不崩溃。
- 技术方案文档里的 `--brand` 变量命名和实际 `styles.css` 的 `--accent` 不一致（龙哥已确认是文档笔误，以实测代码为准，不用改）。

## 已知非阻塞问题（不在本次改动范围，仅记录）

- 现有 `.ai-dropzone` / `.icon-btn` / `.empty-state` 等组件引用的 `--claude-*` CSS 变量在 `styles.css` 里未定义，边框/强调色渲染会跟着丢失。新增组件都绕开用了真实定义的变量，没有动这些既有类。
