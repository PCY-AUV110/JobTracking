// ============================================================
// jobs.js — 岗位偏好 + 智能岗位卡片流模块
// 职责：偏好设置表单、岗位卡片渲染/筛选排序、刷新/历史、加入申请看板
// 依赖：全局 escapeHtml、showToast、openModal、closeModal、dbUpsert、
//       TABLE_APPLICATIONS、applicationToRow、loadState、renderAll、
//       currentUser、getFunctionsBase、SUPABASE_ANON_KEY（来自 app.js）
//
// Day4 收口：两个后端开关都已确认部署并置 true——
// - JOBS_BACKEND_READY：PATCH job-matches-status（viewed/applied 写入）。
// - JOBS_FEED_BACKEND_READY：GET job-feed / GET job-history（岗位流/历史读取），
//   真实 slug 是 job-feed/job-history（不是命名习惯猜的 jobs-feed/jobs-history）。
// MOCK_JOB_SEED/MOCK_REFRESH_POOL 只在两个开关关闭时的本地演示路径里使用，
// 后端异常时不会自动回退到 mock（避免真出问题时界面看起来"正常"掩盖故障）。
// ============================================================

const JOB_MATCHES_STORAGE_KEY = "offerflow_mock_job_matches_v1";
const JOB_PREF_STORAGE_KEY = "offerflow_mock_job_preferences_v3";

const JOBS_BACKEND_READY = true;
const JOBS_FEED_BACKEND_READY = true; // Day4 收口：Codex 确认 job-feed/job-history 已部署 ACTIVE v1，JWT 开启

// 契约里 llm_grade 是 A|B|C|D|E|F 六档
const MATCH_GRADE_STYLE = {
  A: { bg: "rgba(48, 176, 112, 0.14)", color: "#1f7a4d" },
  B: { bg: "rgba(10, 132, 255, 0.14)", color: "#0a5bb0" },
  C: { bg: "rgba(255, 159, 10, 0.14)", color: "#a15c00" },
  D: { bg: "rgba(255, 69, 58, 0.12)", color: "#b53327" },
  E: { bg: "rgba(255, 69, 58, 0.15)", color: "#a02828" },
  F: { bg: "rgba(255, 69, 58, 0.18)", color: "#8f1f1f" }
};

// 契约里 vetting_reviews.risk_rating 是 low|medium|high
const RISK_STYLE = {
  low: { bg: "rgba(48, 176, 112, 0.14)", color: "#1f7a4d", label: "低风险" },
  medium: { bg: "rgba(255, 159, 10, 0.14)", color: "#a15c00", label: "中风险" },
  high: { bg: "rgba(255, 69, 58, 0.14)", color: "#a02828", label: "高风险" }
};

// job_matches.status 四态（契约 v1.1）：new -> viewed -> applied，expired 系统判定
const MATCH_STATUS_STYLE = {
  new: { bg: "rgba(10, 132, 255, 0.14)", color: "#0a5bb0", label: "新" },
  viewed: { bg: "rgba(120, 120, 128, 0.14)", color: "#5a5a60", label: "已查看" },
  applied: { bg: "rgba(48, 176, 112, 0.16)", color: "#1f7a4d", label: "已申请" },
  expired: { bg: "rgba(120, 120, 128, 0.1)", color: "#8a8a90", label: "已过期" }
};

const ATS_LABELS = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday" };

// 本地演示岗位种子数据——JOBS_FEED_BACKEND_READY=true 时不再使用，只在关掉
// 开关做本地回归测试时才会用到（见 loadJobMatches()）
const MOCK_JOB_SEED = [
  { id: "job-1", company_legal_name: "Shopify Inc.", title: "Data Analyst Intern", location_city: "Toronto, ON", salary_raw: "CAD 28-32/hr", jd_summary: "SQL、Python、有电商数据分析经验优先", employment_type: "Co-op·Intern", llm_grade: "A", llm_score: 92, risk_rating: "low", ats_type: "greenhouse", apply_url: "https://www.shopify.com/careers", match_status: "new" },
  { id: "job-2", company_legal_name: "Royal Bank of Canada", title: "Technology Summer Analyst", location_city: "Toronto, ON", salary_raw: "CAD 26-30/hr", jd_summary: "计算机/统计相关专业，需加拿大工作授权", employment_type: "Co-op·Intern", llm_grade: "B", llm_score: 78, risk_rating: "medium", ats_type: "workday", apply_url: "https://jobs.rbc.com/", match_status: "viewed" },
  { id: "job-3", company_legal_name: "Deloitte Canada", title: "Business Analytics Intern", location_city: "Toronto, ON", salary_raw: "CAD 25-27/hr", jd_summary: "Excel、PowerBI，沟通表达能力强", employment_type: "Co-op·Intern", llm_grade: "B", llm_score: 74, risk_rating: "low", ats_type: "lever", apply_url: "https://jobs.deloitte.ca/", match_status: "new" },
  { id: "job-4", company_legal_name: "The Toronto-Dominion Bank", title: "Data & Analytics Co-op", location_city: "Toronto, ON", salary_raw: "CAD 24-28/hr", jd_summary: "需 PR 或 Citizen（合规安全审查岗位）", employment_type: "Co-op·Intern", llm_grade: "C", llm_score: 61, risk_rating: "high", ats_type: "workday", apply_url: "https://jobs.td.com/", match_status: "new" },
  { id: "job-5", company_legal_name: "Wealthsimple Technologies Inc.", title: "Growth Analyst Intern", location_city: "Toronto, ON (Remote friendly)", salary_raw: "CAD 30/hr", jd_summary: "SQL、A/B 测试基础，喜欢快节奏环境", employment_type: "Co-op·Intern", llm_grade: "A", llm_score: 88, risk_rating: "low", ats_type: "ashby", apply_url: "https://www.wealthsimple.com/careers", match_status: "applied" },
  { id: "job-6", company_legal_name: "The Bank of Nova Scotia", title: "Analytics Intern (Fall 2027)", location_city: "Toronto, ON", salary_raw: "CAD 24-26/hr", jd_summary: "统计/金融相关专业，需 Security Clearance", employment_type: "Co-op·Intern", llm_grade: "D", llm_score: 45, risk_rating: "high", ats_type: "workday", apply_url: "https://jobs.scotiabank.com/", match_status: "expired" },
  { id: "job-7", company_legal_name: "Clio (Themis Solutions Inc.)", title: "Business Intelligence Intern", location_city: "Remote (Canada)", salary_raw: "CAD 27/hr", jd_summary: "SQL、数据可视化工具经验", employment_type: "Co-op·Intern", llm_grade: "B", llm_score: 80, risk_rating: "low", ats_type: "greenhouse", apply_url: "https://www.clio.com/careers/", match_status: "new" },
  { id: "job-8", company_legal_name: "Canadian Imperial Bank of Commerce", title: "Data Science Intern", location_city: "Toronto, ON", salary_raw: "CAD 26-29/hr", jd_summary: "Python/R，机器学习基础，需加拿大身份", employment_type: "Co-op·Intern", llm_grade: "C", llm_score: 58, risk_rating: "medium", ats_type: "workday", apply_url: "https://jobs.cibc.com/", match_status: "new" }
];

// "刷新岗位" 时模拟拉到的下一批新岗位，按顺序逐个补入，用完为止
const MOCK_REFRESH_POOL = [
  { id: "job-9", company_legal_name: "Manulife Financial Corporation", title: "Data Insights Co-op", location_city: "Toronto, ON", salary_raw: "CAD 25-28/hr", jd_summary: "SQL、Tableau，保险行业数据分析", employment_type: "Co-op·Intern", llm_grade: "B", llm_score: 76, risk_rating: "low", ats_type: "greenhouse", apply_url: "https://jobs.manulife.com/" },
  { id: "job-10", company_legal_name: "Loblaw Digital", title: "Product Analytics Intern", location_city: "Toronto, ON", salary_raw: "CAD 27-30/hr", jd_summary: "A/B 测试、电商漏斗分析", employment_type: "Co-op·Intern", llm_grade: "A", llm_score: 90, risk_rating: "low", ats_type: "lever", apply_url: "https://jobs.loblawdigital.com/" },
  { id: "job-11", company_legal_name: "OMERS Administration Corporation", title: "Investment Data Analyst Co-op", location_city: "Toronto, ON", salary_raw: "CAD 26-29/hr", jd_summary: "金融数据处理，需较强 Excel/SQL", employment_type: "Co-op·Intern", llm_grade: "C", llm_score: 63, risk_rating: "medium", ats_type: "workday", apply_url: "https://jobs.omers.com/" }
];

let jobPreferences = null;
let jobMatches = [];
let currentJobTab = "feed"; // "feed" | "history"

// ============================================================
// 岗位偏好：本地存储读写（字段名对齐 job_preferences 表）
// ============================================================
function loadJobPreferences() {
  try {
    const raw = localStorage.getItem(JOB_PREF_STORAGE_KEY);
    jobPreferences = raw ? JSON.parse(raw) : null;
  } catch {
    jobPreferences = null;
  }
  if (!jobPreferences) {
    jobPreferences = {
      keywords: [], locations: [], job_types: [], min_salary: null, excluded_keywords: [], filter_pr_citizen: true,
      // 字段名先按 Steven 给的写，Codex v1.2 契约确认后如有出入再改
      internship_duration: [], start_season: []
    };
  }
  return jobPreferences;
}

function persistJobPreferences() {
  // TODO(后端就绪): 换成 await upsertJobPreferences(jobPreferences)
  localStorage.setItem(JOB_PREF_STORAGE_KEY, JSON.stringify(jobPreferences));
}

// 进入视图时调用：从 localStorage 读一次后渲染
function renderJobPreferencesForm() {
  loadJobPreferences();
  renderJobPreferencesFormUI();
}

// chip 增删等本地状态变更后调用：只重渲染当前内存状态，不重新读取 localStorage
// （避免把尚未保存的修改被 loadJobPreferences() 覆盖掉）
function renderJobPreferencesFormUI() {
  renderChipList("prefKeywordsChips", jobPreferences.keywords, removePrefKeyword);
  renderChipList("prefLocationsChips", jobPreferences.locations, removePrefLocation);
  renderChipList("prefExcludeChips", jobPreferences.excluded_keywords, removePrefExclude);
  document.querySelectorAll("#prefJobTypesGroup input[type=checkbox]").forEach(box => {
    box.checked = jobPreferences.job_types.includes(box.value);
  });
  document.querySelectorAll("#prefInternshipDurationGroup input[type=checkbox]").forEach(box => {
    box.checked = jobPreferences.internship_duration.includes(box.value);
  });
  document.querySelectorAll("#prefStartSeasonGroup input[type=checkbox]").forEach(box => {
    box.checked = jobPreferences.start_season.includes(box.value);
  });
  document.getElementById("prefMinSalary").value = jobPreferences.min_salary ?? "";
  document.getElementById("prefFilterIdentityToggle").checked = jobPreferences.filter_pr_citizen !== false;
}

// 通用 chip 列表渲染（关键词/地点/排除词共用同一个视觉组件）
function renderChipList(containerId, values, onRemove) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (!values.length) {
    wrap.innerHTML = `<span class="small-muted">暂未添加，在下方输入后按回车。</span>`;
    return;
  }
  wrap.innerHTML = values.map((value, idx) => `
    <span class="skill-chip">
      ${escapeHtml(value)}
      <button type="button" class="skill-chip-remove" data-chip-idx="${idx}" aria-label="删除">×</button>
    </span>
  `).join("");
  wrap.onclick = e => {
    const btn = e.target.closest("[data-chip-idx]");
    if (btn) onRemove(Number(btn.dataset.chipIdx));
  };
}

function addPrefChip(listKey, inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;
  if (!jobPreferences[listKey].includes(value)) jobPreferences[listKey].push(value);
  input.value = "";
  renderJobPreferencesFormUI();
}

function removePrefKeyword(idx) { jobPreferences.keywords.splice(idx, 1); renderJobPreferencesFormUI(); }
function removePrefLocation(idx) { jobPreferences.locations.splice(idx, 1); renderJobPreferencesFormUI(); }
function removePrefExclude(idx) { jobPreferences.excluded_keywords.splice(idx, 1); renderJobPreferencesFormUI(); }

function handlePrefSaveClick() {
  jobPreferences.job_types = Array.from(document.querySelectorAll("#prefJobTypesGroup input:checked")).map(b => b.value);
  jobPreferences.internship_duration = Array.from(document.querySelectorAll("#prefInternshipDurationGroup input:checked")).map(b => b.value);
  jobPreferences.start_season = Array.from(document.querySelectorAll("#prefStartSeasonGroup input:checked")).map(b => b.value);
  const minSalaryVal = document.getElementById("prefMinSalary").value;
  jobPreferences.min_salary = minSalaryVal ? Number(minSalaryVal) : null;
  jobPreferences.filter_pr_citizen = document.getElementById("prefFilterIdentityToggle").checked;
  persistJobPreferences();
  showToast("岗位偏好已保存");
}

// ============================================================
// 智能岗位卡片流：本地存储读写（字段名对齐 job_matches 表 + jobs/vetting_reviews 联查）
// ============================================================
async function loadJobMatches() {
  if (JOBS_FEED_BACKEND_READY) {
    if (!currentUser) { jobMatches = []; return jobMatches; }
    const riskFilter = document.getElementById("jobRiskFilter").value;
    const statusFilter = document.getElementById("jobStatusFilter").value;
    const params = {
      risk_rating: riskFilter === "all" ? undefined : riskFilter,
      status: statusFilter === "all" ? undefined : statusFilter
    };
    const result = currentJobTab === "history" ? await getJobHistory(params) : await getJobFeed(params);
    jobMatches = (result.jobs || []).map(mapFeedRow);
    return jobMatches;
  }

  try {
    const raw = localStorage.getItem(JOB_MATCHES_STORAGE_KEY);
    jobMatches = raw ? JSON.parse(raw) : null;
  } catch {
    jobMatches = null;
  }
  if (!jobMatches) {
    jobMatches = MOCK_JOB_SEED.map((job, idx) => ({
      ...job,
      match_id: `match-${job.id}`,
      viewed_at: job.match_status !== "new" ? new Date(Date.now() - (8 - idx) * 3600_000).toISOString() : null,
      applied_at: job.match_status === "applied" ? new Date(Date.now() - (8 - idx) * 1800_000).toISOString() : null,
      created_at: new Date(Date.now() - (8 - idx) * 86400_000).toISOString()
    }));
    persistJobMatches();
  }
  return jobMatches;
}

function persistJobMatches() {
  // 只有 mock 路径才需要本地持久化；JOBS_FEED_BACKEND_READY=true 时数据直接来自服务端
  if (JOBS_FEED_BACKEND_READY) return;
  localStorage.setItem(JOB_MATCHES_STORAGE_KEY, JSON.stringify(jobMatches));
}

// docs/api-contracts-v1.md #6/#7 GET /jobs/feed、GET /jobs/history
// Edge Function 真实 slug 是 job-feed / job-history（Codex Day4 收口确认，
// 不是我之前按命名习惯猜的 jobs-feed/jobs-history）。ACTIVE v1，JWT 开启，
// 首次 feed 无匹配会服务端自动触发 score-jobs。
async function callJobsReadFunction(name, params) {
  const { data: { session } } = await supabase.auth.getSession();
  const query = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  const res = await fetch(`${getFunctionsBase()}/${name}${query ? `?${query}` : ""}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`
    }
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message || body.error || `请求失败（${res.status}）`);
  return body.data;
}

async function getJobFeed(params) {
  return callJobsReadFunction("job-feed", params);
}

async function getJobHistory(params) {
  return callJobsReadFunction("job-history", params);
}

// 契约里 feed/history 行没有 ats_type（来源字段是 mock 阶段自己加的展示信息），
// 真实数据里“来源”这一格就先不显示，而不是显示 undefined
function mapFeedRow(row) {
  return {
    id: row.job_id,
    match_id: row.match_id,
    company_legal_name: row.company_legal_name,
    title: row.title,
    location_city: row.location_city,
    salary_raw: row.salary_raw,
    jd_summary: row.jd_summary,
    apply_url: row.apply_url,
    employment_type: row.employment_type,
    llm_grade: row.llm_grade,
    llm_score: row.llm_score,
    risk_rating: row.risk_rating,
    vetting_status: row.vetting_status,
    match_status: row.match_status,
    job_status: row.job_status,
    viewed_at: row.viewed_at,
    applied_at: row.applied_at,
    ats_type: row.ats_type || null,
    created_at: row.created_at || null
  };
}

function getFilteredSortedJobs() {
  loadJobPreferences();
  const riskFilter = document.getElementById("jobRiskFilter").value;
  const statusFilter = document.getElementById("jobStatusFilter").value;
  const sortBy = document.getElementById("jobSortSelect").value;

  // 当前推荐（feed）默认不展示已过期的匹配；历史记录（history）展示全部，含 expired
  let jobs = jobMatches.filter(job => currentJobTab === "history" || job.match_status !== "expired");
  jobs = jobs.filter(job => riskFilter === "all" || job.risk_rating === riskFilter);
  jobs = jobs.filter(job => statusFilter === "all" || job.match_status === statusFilter);

  const riskRank = { high: 0, medium: 1, low: 2 };
  const sorters = {
    match: (a, b) => b.llm_score - a.llm_score,
    risk: (a, b) => riskRank[a.risk_rating] - riskRank[b.risk_rating],
    location: (a, b) => (a.location_city || "").localeCompare(b.location_city || "", "zh-CN"),
    source: (a, b) => (a.ats_type || "").localeCompare(b.ats_type || "", "zh-CN")
  };
  if (currentJobTab === "history") {
    jobs = [...jobs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    jobs = [...jobs].sort(sorters[sortBy] || sorters.match);
  }
  return jobs;
}

function jobCardHtml(job) {
  const grade = MATCH_GRADE_STYLE[job.llm_grade] || MATCH_GRADE_STYLE.C;
  const risk = RISK_STYLE[job.risk_rating] || RISK_STYLE.medium;
  const statusStyle = MATCH_STATUS_STYLE[job.match_status] || MATCH_STATUS_STYLE.new;
  const isExpired = job.match_status === "expired";
  return `
    <article class="job-card${isExpired ? " is-expired" : ""}" data-job-id="${job.id}" data-match-id="${job.match_id}">
      <div class="job-card-head">
        <div>
          <div class="job-card-title">${escapeHtml(job.title)}</div>
          <div class="small-muted">${escapeHtml(job.company_legal_name)} · ${escapeHtml(job.location_city)}</div>
        </div>
        <span class="grade-badge" style="background:${grade.bg};color:${grade.color}">${job.llm_grade}</span>
      </div>
      <div class="job-card-meta">
        <span>${escapeHtml(job.salary_raw)}</span>
        <span class="risk-badge" style="background:${risk.bg};color:${risk.color}">${risk.label}</span>
        <span class="status-badge" style="background:${statusStyle.bg};color:${statusStyle.color}">${statusStyle.label}</span>
        ${job.ats_type ? `<span class="small-muted">来源 ${escapeHtml(ATS_LABELS[job.ats_type] || job.ats_type)}</span>` : ""}
      </div>
      <p class="job-card-requirements">${escapeHtml(job.jd_summary)}</p>
      <div class="card-actions job-card-actions">
        <button type="button" class="btn secondary" data-view-job="${job.id}">查看详情</button>
        ${job.match_status === "applied"
          ? `<button type="button" class="btn secondary applied-toggle" data-revoke-job="${job.id}" title="点击撤销申请">✓ 已加入申请</button>`
          : isExpired
            ? `<button type="button" class="btn secondary" disabled>岗位已过期</button>`
            : `<button type="button" class="btn primary" data-add-job="${job.id}">加入申请</button>`}
      </div>
    </article>
  `;
}

async function renderJobCardGrid() {
  const grid = document.getElementById("jobCardGrid");
  if (!grid) return;

  if (JOBS_FEED_BACKEND_READY && !currentUser) {
    grid.innerHTML = `<div class="empty-state">请先登录后查看智能岗位推荐。</div>`;
    return;
  }

  let jobs;
  try {
    await loadJobMatches();
    jobs = getFilteredSortedJobs();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">岗位加载失败：${escapeHtml(err?.message || String(err))}</div>`;
    return;
  }
  if (!jobs.length) {
    grid.innerHTML = `<div class="empty-state">${currentJobTab === "history" ? "还没有历史推荐记录。" : "当前筛选条件下没有匹配的岗位。"}</div>`;
    return;
  }
  grid.innerHTML = jobs.map(jobCardHtml).join("");
}

function switchJobTab(tab) {
  currentJobTab = tab;
  document.querySelectorAll('[data-job-tab]').forEach(btn => {
    btn.classList.toggle("active", btn.dataset.jobTab === tab);
  });
  document.getElementById("jobSortSelect").disabled = tab === "history";
  renderJobCardGrid();
}

// 本地状态变更：立即更新，不等网络往返（乐观更新），网络同步是旁路副作用
function setMatchStatusLocal(job, status) {
  job.match_status = status;
  if (status === "viewed") {
    if (!job.viewed_at) job.viewed_at = new Date().toISOString();
    job.applied_at = null; // 从 applied 撤销回 viewed 时清空 applied_at
  }
  if (status === "applied") job.applied_at = new Date().toISOString();
  persistJobMatches();
}

// docs/api-contracts-v1.md #8 PATCH /job_matches/{id}/status，函数名 job-matches-status
// 已部署确认（Day4，commit db36ab0）。applied -> viewed 回退已在 v1.2 契约里
// 明确允许（幂等，清空 applied_at、保留/设置 viewed_at）。
async function patchMatchStatusBackend(matchId, status) {
  const { data, error } = await supabase.functions.invoke("job-matches-status", {
    method: "PATCH",
    body: { id: matchId, status }
  });
  if (error) throw error;
  return data.match;
}

function syncMatchStatusToBackend(matchId, status) {
  if (!JOBS_BACKEND_READY) return;
  patchMatchStatusBackend(matchId, status).catch(err => {
    console.warn("[jobs] 同步匹配状态到后端失败（本地状态已更新，不阻塞交互）:", err);
  });
}

// 点卡片（非点按钮）标记 viewed；new -> viewed，其余状态不变
function markJobViewed(matchId) {
  const job = jobMatches.find(j => j.match_id === matchId);
  if (!job || job.match_status !== "new") return;
  setMatchStatusLocal(job, "viewed");
  syncMatchStatusToBackend(matchId, "viewed");
  renderJobCardGrid();
}

// 撤销申请：applied -> viewed（不删除 applications 表里已创建的申请记录，
// 那是用户自己在申请看板里的数据，只回退这张卡片的匹配状态标签）
function revokeApplication(jobId) {
  const job = jobMatches.find(j => j.id === jobId);
  if (!job || job.match_status !== "applied") return;
  setMatchStatusLocal(job, "viewed");
  syncMatchStatusToBackend(job.match_id, "viewed");
  renderJobCardGrid();
  showToast("已撤销申请标记");
}

async function refreshJobFeed() {
  const btn = document.getElementById("jobRefreshBtn");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "🔄 刷新中…";
  try {
    if (JOBS_FEED_BACKEND_READY) {
      if (!currentUser) { showToast("请先登录后再刷新岗位推荐"); return; }
      const result = await getJobFeed({ refresh: true });
      jobMatches = (result.jobs || []).map(mapFeedRow);
      renderJobCardGrid();
      showToast(result.refreshed ? "已刷新岗位推荐" : "岗位库已是最新");
      return;
    }

    await loadJobMatches();
    await new Promise(resolve => setTimeout(resolve, 700));
    const existingIds = new Set(jobMatches.map(j => j.id));
    const nextBatch = MOCK_REFRESH_POOL.filter(j => !existingIds.has(j.id)).slice(0, 1);
    if (!nextBatch.length) {
      showToast("岗位库已是最新，暂无新推荐");
      return;
    }
    const now = new Date().toISOString();
    nextBatch.forEach(job => {
      jobMatches.unshift({ ...job, match_status: "new", match_id: `match-${job.id}`, viewed_at: null, applied_at: null, created_at: now });
    });
    persistJobMatches();
    renderJobCardGrid();
    showToast(`已拉取 ${nextBatch.length} 个新岗位`);
  } catch (err) {
    showToast("刷新失败：" + (err?.message || "未知错误"));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function openJobDetail(jobId) {
  const job = jobMatches.find(j => j.id === jobId);
  if (!job) return;
  const grade = MATCH_GRADE_STYLE[job.llm_grade] || MATCH_GRADE_STYLE.C;
  const risk = RISK_STYLE[job.risk_rating] || RISK_STYLE.medium;
  const statusStyle = MATCH_STATUS_STYLE[job.match_status] || MATCH_STATUS_STYLE.new;
  document.getElementById("jobDetailTitle").textContent = `${job.title} · ${job.company_legal_name}`;
  document.getElementById("jobDetailBody").innerHTML = `
    <div class="chip-input" style="margin-bottom:14px">
      <span class="grade-badge" style="background:${grade.bg};color:${grade.color}">匹配等级 ${job.llm_grade}（${job.llm_score} 分）</span>
      <span class="risk-badge" style="background:${risk.bg};color:${risk.color}">背调 ${risk.label}</span>
      <span class="status-badge" style="background:${statusStyle.bg};color:${statusStyle.color}">${statusStyle.label}</span>
    </div>
    <p><strong>地点：</strong>${escapeHtml(job.location_city)}</p>
    <p><strong>薪资：</strong>${escapeHtml(job.salary_raw)}</p>
    <p><strong>雇佣类型：</strong>${escapeHtml(job.employment_type)}</p>
    ${job.ats_type ? `<p><strong>来源：</strong>${escapeHtml(ATS_LABELS[job.ats_type] || job.ats_type)}</p>` : ""}
    <p><strong>核心要求：</strong>${escapeHtml(job.jd_summary)}</p>
    <p class="small-muted" style="margin-top:14px">JD 原文（jd_raw）与匹配差距分析（job_matches.gaps）等真实 score-jobs 数据接入后展示，目前为本地演示数据占位。</p>
  `;
  document.getElementById("jobDetailApplyLink").href = job.apply_url;
  const addBtn = document.getElementById("jobDetailAddBtn");
  addBtn.dataset.addJob = job.id;
  if (job.match_status === "applied") {
    addBtn.disabled = false;
    addBtn.textContent = "✓ 已加入申请（点击撤销）";
    addBtn.dataset.action = "revoke";
    addBtn.classList.remove("primary");
    addBtn.classList.add("secondary");
  } else if (job.match_status === "expired") {
    addBtn.disabled = true;
    addBtn.textContent = "岗位已过期";
    addBtn.dataset.action = "";
  } else {
    addBtn.disabled = false;
    addBtn.textContent = "加入申请看板";
    addBtn.dataset.action = "add";
    addBtn.classList.remove("secondary");
    addBtn.classList.add("primary");
  }
  markJobViewed(job.match_id);
  openModal("jobDetailModal");
}

async function addJobToApplications(jobId) {
  const job = jobMatches.find(j => j.id === jobId);
  if (!job || job.match_status === "applied" || job.match_status === "expired") return;
  const record = {
    id: crypto.randomUUID(),
    company: job.company_legal_name,
    role: job.title,
    status: "准备申请",
    appliedDate: new Date().toISOString().slice(0, 10),
    location: job.location_city,
    source: job.ats_type ? `智能岗位推荐 · ${ATS_LABELS[job.ats_type] || job.ats_type}` : "智能岗位推荐",
    jobUrl: job.apply_url,
    notes: `匹配等级 ${job.llm_grade}（${job.llm_score} 分）· 背调风险：${(RISK_STYLE[job.risk_rating] || {}).label || job.risk_rating}\n核心要求：${job.jd_summary}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  try {
    await dbUpsert(TABLE_APPLICATIONS, applicationToRow(record));
    await loadState();
    renderAll();
    setMatchStatusLocal(job, "applied");
    syncMatchStatusToBackend(job.match_id, "applied");
    renderJobCardGrid();
    showToast("已加入申请看板");
    closeModal("jobDetailModal");
  } catch (err) {
    showToast("加入失败：" + (err?.message || "未知错误"));
  }
}

// ============================================================
// 事件绑定
// ============================================================
function initJobsModule() {
  const prefKeywordInput = document.getElementById("prefKeywordInput");
  if (!prefKeywordInput) return; // HTML 版本不匹配时跳过

  prefKeywordInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addPrefChip("keywords", "prefKeywordInput"); }
  });
  document.getElementById("prefLocationInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addPrefChip("locations", "prefLocationInput"); }
  });
  document.getElementById("prefExcludeInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addPrefChip("excluded_keywords", "prefExcludeInput"); }
  });
  document.getElementById("prefSaveBtn").addEventListener("click", handlePrefSaveClick);

  document.getElementById("jobSortSelect").addEventListener("change", renderJobCardGrid);
  document.getElementById("jobRiskFilter").addEventListener("change", renderJobCardGrid);
  document.getElementById("jobStatusFilter").addEventListener("change", renderJobCardGrid);
  document.getElementById("jobRefreshBtn").addEventListener("click", refreshJobFeed);

  document.querySelectorAll('[data-job-tab]').forEach(btn => {
    btn.addEventListener("click", () => switchJobTab(btn.dataset.jobTab));
  });

  document.getElementById("jobCardGrid").addEventListener("click", e => {
    const viewBtn = e.target.closest("[data-view-job]");
    const addBtn = e.target.closest("[data-add-job]");
    const revokeBtn = e.target.closest("[data-revoke-job]");
    const card = e.target.closest(".job-card");
    if (viewBtn) { openJobDetail(viewBtn.dataset.viewJob); return; }
    if (addBtn) { addJobToApplications(addBtn.dataset.addJob); return; }
    if (revokeBtn) { revokeApplication(revokeBtn.dataset.revokeJob); return; }
    // 点卡片空白处（非按钮）标记已查看
    if (card && !e.target.closest("button")) markJobViewed(card.dataset.matchId);
  });

  document.getElementById("jobDetailAddBtn").addEventListener("click", e => {
    const action = e.target.dataset.action;
    const jobId = e.target.dataset.addJob;
    if (action === "revoke") { revokeApplication(jobId); openJobDetail(jobId); } // 撤销后刷新弹窗按钮状态
    else if (action === "add") addJobToApplications(jobId);
  });
}

document.addEventListener("DOMContentLoaded", initJobsModule);

window.renderJobPreferencesForm = renderJobPreferencesForm;
window.renderJobCardGrid = renderJobCardGrid;
