# 前端开发状态（Claude Code 维护）

分支：`feature/day6-priority-badge`（已 push，从最新 main 切出）
工区：`/Users/p.cy/Desktop/杂货铺/jobtrack-release`（独立 worktree，与主工区 `jobtrack_github_demo`、Codex 的 `jobtrack-backend` 平级），本地预览用 `python3 -m http.server 8000`

## Day6（已 push，commit `fc5c5bd`）

「重点大厂」徽章：`job-feed` 行 `is_priority_employer === true` 时在卡片和详情弹窗显示 ⭐ 重点大厂（`--accent` 配色，跟 grade/risk/status 同一套视觉体系）。`mapFeedRow` 严格用 `=== true` 判断，字段缺失/false 都归为不显示，不报错——这个字段（job-feed v1.4）目前还没部署，验证时是手动注入了带/不带这个字段的 mock 行测的，不是真实数据。只改了这一处，没碰其他逻辑。桌面+390×844 移动端截图确认过。

## Day5（2026-09-02 深夜，已 push，commit `8ddbece`）

**Phase 1（`f0a79f6`，单独先 push 过一次给 Codex 优先 review）**：`.modal` 背景用了全仓未定义的 `--claude-paper`/`--claude-line`，导致所有弹窗背景透明、黑字看不清——这是我之前排查过的同一类 `--claude-*` dead variable 问题的第 3 次现身。改成 `rgba(255,255,255,.96)` 近不透明白底 + `--glass-blur` 轻微模糊 + 显式 `color: var(--ink)`，backdrop 遮罩加深到 `rgba(20,25,35,.58)`。影响所有弹窗（申请/面试/改密码/岗位详情），桌面+移动端截图确认过。

**Phase 2**：岗位偏好加"工作模式"(`work_modes`: in_person/remote/hybrid)和"国家"(`countries`: US/CA，UI 显示 America/Canada)两组 checkbox-pill。`job-feed`/`job-history` 请求带上 `work_mode`/`country` 查询参数（从保存的偏好取值，逗号分隔多选）。

**一个重要的风险判断，没有照单全收 Steven 的字面指令**：Steven 要求"接通 job_preferences 真实读写"，但我先查了 `supabase/migrations/` 确认 `work_modes`/`countries` 这两列**还没有任何迁移文件**（只有 Day3 的 `internship_duration`/`start_season` 已经上线）。如果直接把这两个新字段塞进 `upsert`，字段不存在会导致**整条 upsert 失败**——不止新字段存不进去，连 keywords/job_types 这些已经能存的老字段也会一起存失败。所以真实读写函数写好了，但用新开关 `JOB_PREFS_BACKEND_READY`（当前 false）挡住，偏好目前还是主要存 localStorage，等 Codex 确认 migration 上线后开关一开就通。

**顺手做的卡片展示**：如果 `job-feed` 返回行里有 `work_mode`/`country_code`，卡片和详情弹窗会显示图标+文字标签；没有这两个字段时不显示任何东西（不会出现"undefined"）——这两个字段目前是否已经在真实返回行里也没confirm，先做好兜底。

**验证**：本地跑了一轮——弹窗背景修复截图确认（桌面+移动端），新偏好字段保存后刷新页面仍在，智能岗位视图无回归、console 无报错。

## Day4 收口（2026-09-02 深夜，已 push，commit `3f5ab50`）

Codex 部署确认：真实 slug 是 `job-feed`/`job-history`（不是我猜的 `jobs-feed`/`jobs-history`）。已改 `callJobsReadFunction` 两处调用、`JOBS_FEED_BACKEND_READY` 置 true、清理了文件里几处已经过时的"还没部署"注释（之前有个大段头部注释因为编辑指令没匹配上，一直没跟着状态更新，这次一并修了）。`mapFeedRow` 逐字段核对过 v1.1 响应示例，16 个字段全部对得上，没改。

**两个开关现在都是 true**：`JOBS_BACKEND_READY`（状态写入）和 `JOBS_FEED_BACKEND_READY`（岗位流/历史读取）。`node --check` 通过，本地验证了未登录态下 feed/history/刷新按钮都给清楚的登录提示、没有 mock 数据泄漏、偏好页和简历中心不受影响。**真实登录态端到端验收做不了**（本机没账号），按计划由 Codex review 合并后 Steven 验收。

## Day4：mock 开关切真实后端（2026-09-02，已 push）

**核实到的后端现状**（直接读 `supabase/functions/` 目录，不是听转述）：`job-matches-status`（viewed/applied 状态写入）已部署，main 已经确认 `db36ab0` 把这部分打开了；但 `jobs-feed`/`jobs-history`（读取岗位流/历史）**这次提交时还没有对应目录**，没部署。所以把原来一个 `JOBS_BACKEND_READY` 开关拆成两个：
- `JOBS_BACKEND_READY = true`：控制 viewed/applied 状态同步，已确认可用，不用等。
- `JOBS_FEED_BACKEND_READY = false`：控制岗位流/历史的真实读取，真实调用代码已经按契约写好（猜测的 Edge Function 名字是 `jobs-feed`/`jobs-history`，kebab-case 跟 `job-matches-status` 一个习惯，契约文档没点名具体 slug，Codex 确认部署后如果实际名字不一样只需要改 `callJobsReadFunction` 里那两个字符串），**等 Codex 在群里报 ACTIVE 后把这个改成 true 就行，不用再改别的地方**。

`resumes.js` 的 `RESUME_BACKEND_READY` 已经置 true（`parse-resume` 函数 + `resumes` 表都确认部署了）：上传 PDF → 提取文本 → 真实调用 parse-resume → 落库，这条链路走通了；未登录时上传解析和查看简历列表都会给出明确的"请先登录"提示，不会报原始错误或空白。

**记录两个诚实的已知缺口（没有假装做了）**：
1. `resumes` 表没有 `is_default` 列，"默认简历"只在浏览器本地记一个 id，换设备/清缓存会丢，不是服务端字段。
2. 契约里没有"更新已解析简历字段"的接口（`parse-resume` 只能整段重新解析），所以真实后端模式下编辑按钮直接隐藏了，没有做一个点了没用的假按钮。

**没做完的部分，如实说**：Steven 要的"生产 URL 端到端验收（上传简历→feed 出真实岗位→点卡片 viewed→加入申请→撤销，硬刷新后仍持久化）"这次做不完整——这个分支还没部署到生产，而且本机没有真实登录账号，没法登录后走全链路。已经验证了：mock 模式下所有交互没有回归（关掉 feed 开关时行为和 Day3 一致）、未登录态的简历中心提示清楚、toggle 逻辑在异步改造后没坏。真正的端到端验收需要等这个分支部署上线 + 有真实账号的人（比如 Steven）登录跑一遍，或者告诉我一个测试账号的邮箱密码我来跑。

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
