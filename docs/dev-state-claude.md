# 前端开发状态（Claude Code 维护）

分支：`feature/day1-resume-center`（基于 `feature/day0-security-hardening`，已含安全修复）
工区：`/Users/p.cy/Desktop/杂货铺/jobtrack_github_demo`，本地预览用 `python3 -m http.server 8000`

## 已做

- **简历中心**（`resumes.js`）：PDF 拖拽上传 → pdf.js 本地提取文本 → 预览确认 → 关键词启发式 mock 解析（技能/教育/经历/联系方式）→ 结构化结果可编辑 → 多简历版本管理（保存/设默认/编辑/删除）。`vendor/pdfjs/` 本地 vendor pdf.js 6.3.289，不走 CDN。Playwright + 真实简历 PDF 端到端验证通过。
- **岗位偏好**（`jobs.js`）：关键词/地点/雇佣类型/薪资底线/排除词 + 身份过滤开关（默认开启），localStorage 持久化。
- **智能岗位卡片流**（`jobs.js`）：8 条 mock 岗位数据，卡片含公司/岗位/地点/薪资/要求摘要/匹配等级(A-F 色)/背调风险徽标(红黄绿)/来源；按匹配分/风险/地点/来源排序，按风险筛选；详情弹窗；"加入申请"写入真实 `applications` 表（`dbUpsert` + `applicationToRow`，未登录时会被 RLS 正确拒绝并提示，逻辑已验证，真实写入效果需登录后确认）。
- 全部改动已 push 到 `origin/feature/day1-resume-center`（首次 push，含简历中心部分；岗位偏好+卡片流待下次 push）。

## 在做 / 下一步

- 等 Codex `docs/api-contracts-v1.md` 定稿（crawl-jobs / score-jobs / vetting-flags / parse-resume / vetting-review），把 `jobs.js` 的 `MOCK_JOBS` 换成真实数据源，`resumes.js` 的 `RESUME_BACKEND_READY` 打开切真实 `parse-resume` 调用。
- 岗位详情弹窗目前只有基础信息占位，JD 原文 + LLM 差距分析等 score-jobs 数据结构定下来后再补。
- 背调徽标目前只做了简化的三色（低/中/高映射 low/medium/high），真实 `vetting_reviews.status` 是五态枚举（pending/auto_flagged/needs_human/approved/rejected），接入时要重新映射成三色展示逻辑。

## 卡点

- 无法用真实登录态验证"加入申请"完整成功路径（本机没有测试账号），只验证到 RLS 正确拦截未登录写入、前端错误处理不崩溃。
- 技术方案文档里的 `--brand` 变量命名和实际 `styles.css` 的 `--accent` 不一致（龙哥已确认是文档笔误，以实测代码为准，不用改）。

## 已知非阻塞问题（不在本次改动范围，仅记录）

- 现有 `.ai-dropzone` / `.icon-btn` / `.empty-state` 等组件引用的 `--claude-*` CSS 变量在 `styles.css` 里未定义，边框/强调色渲染会跟着丢失。新增组件都绕开用了真实定义的变量，没有动这些既有类。
