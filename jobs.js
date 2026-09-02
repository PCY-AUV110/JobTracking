// ============================================================
// jobs.js — 岗位偏好 + 智能岗位卡片流模块（Day4+）
// 职责：偏好设置表单、mock 岗位卡片渲染/筛选排序、加入申请看板
// 依赖：全局 escapeHtml、showToast、openModal、closeModal、dbUpsert、
//       TABLE_APPLICATIONS、applicationToRow、loadState、renderAll（来自 app.js）
//
// ⚠️ Mock 说明：契约已在 docs/api-contracts-v1.md（Codex，2026-09-02 frozen）
// 定稿，但 job_preferences/jobs/job_matches/vetting_reviews 的 migration
// 还没跑到生产库。字段名已按契约的 snake_case 对齐（job_preferences 的
// keywords/locations/job_types/min_salary/filter_pr_citizen/excluded_keywords，
// 岗位卡片的 company_legal_name/location_city/salary_raw/jd_summary/
// llm_grade/llm_score/risk_rating/apply_url/ats_type/employment_type），
// 等 upsertJobPreferences()/listMatchedJobs() 等 client 封装函数就位后，
// 直接替换 persistJobPreferences()/MOCK_JOBS 数据源即可，渲染逻辑不用重写。
// ============================================================

const JOB_PREF_STORAGE_KEY = "offerflow_mock_job_preferences_v2";

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

const ATS_LABELS = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday" };

// 本地演示岗位数据，字段名对齐 jobs/job_matches/vetting_reviews 三表联查后的岗位卡片形状
// （等 Codex 的 listMatchedJobs()/getJobCard() 就位后替换为真实数据）
const MOCK_JOBS = [
  { id: "job-1", company_legal_name: "Shopify Inc.", title: "Data Analyst Intern", location_city: "Toronto, ON", salary_raw: "CAD 28-32/hr", jd_summary: "SQL、Python、有电商数据分析经验优先", employment_type: "Internship", llm_grade: "A", llm_score: 92, risk_rating: "low", ats_type: "greenhouse", apply_url: "https://www.shopify.com/careers" },
  { id: "job-2", company_legal_name: "Royal Bank of Canada", title: "Technology Summer Analyst", location_city: "Toronto, ON", salary_raw: "CAD 26-30/hr", jd_summary: "计算机/统计相关专业，需加拿大工作授权", employment_type: "Internship", llm_grade: "B", llm_score: 78, risk_rating: "medium", ats_type: "workday", apply_url: "https://jobs.rbc.com/" },
  { id: "job-3", company_legal_name: "Deloitte Canada", title: "Business Analytics Intern", location_city: "Toronto, ON", salary_raw: "CAD 25-27/hr", jd_summary: "Excel、PowerBI，沟通表达能力强", employment_type: "Internship", llm_grade: "B", llm_score: 74, risk_rating: "low", ats_type: "lever", apply_url: "https://jobs.deloitte.ca/" },
  { id: "job-4", company_legal_name: "The Toronto-Dominion Bank", title: "Data & Analytics Co-op", location_city: "Toronto, ON", salary_raw: "CAD 24-28/hr", jd_summary: "需 PR 或 Citizen（合规安全审查岗位）", employment_type: "Co-op", llm_grade: "C", llm_score: 61, risk_rating: "high", ats_type: "workday", apply_url: "https://jobs.td.com/" },
  { id: "job-5", company_legal_name: "Wealthsimple Technologies Inc.", title: "Growth Analyst Intern", location_city: "Toronto, ON (Remote friendly)", salary_raw: "CAD 30/hr", jd_summary: "SQL、A/B 测试基础，喜欢快节奏环境", employment_type: "Internship", llm_grade: "A", llm_score: 88, risk_rating: "low", ats_type: "ashby", apply_url: "https://www.wealthsimple.com/careers" },
  { id: "job-6", company_legal_name: "The Bank of Nova Scotia", title: "Analytics Intern (Fall 2027)", location_city: "Toronto, ON", salary_raw: "CAD 24-26/hr", jd_summary: "统计/金融相关专业，需 Security Clearance", employment_type: "Internship", llm_grade: "D", llm_score: 45, risk_rating: "high", ats_type: "workday", apply_url: "https://jobs.scotiabank.com/" },
  { id: "job-7", company_legal_name: "Clio (Themis Solutions Inc.)", title: "Business Intelligence Intern", location_city: "Remote (Canada)", salary_raw: "CAD 27/hr", jd_summary: "SQL、数据可视化工具经验", employment_type: "Internship", llm_grade: "B", llm_score: 80, risk_rating: "low", ats_type: "greenhouse", apply_url: "https://www.clio.com/careers/" },
  { id: "job-8", company_legal_name: "Canadian Imperial Bank of Commerce", title: "Data Science Intern", location_city: "Toronto, ON", salary_raw: "CAD 26-29/hr", jd_summary: "Python/R，机器学习基础，需加拿大身份", employment_type: "Internship", llm_grade: "C", llm_score: 58, risk_rating: "medium", ats_type: "workday", apply_url: "https://jobs.cibc.com/" }
];

let jobPreferences = null;

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
    jobPreferences = { keywords: [], locations: [], job_types: [], min_salary: null, excluded_keywords: [], filter_pr_citizen: true };
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
  const minSalaryVal = document.getElementById("prefMinSalary").value;
  jobPreferences.min_salary = minSalaryVal ? Number(minSalaryVal) : null;
  jobPreferences.filter_pr_citizen = document.getElementById("prefFilterIdentityToggle").checked;
  persistJobPreferences();
  showToast("岗位偏好已保存");
}

// ============================================================
// 智能岗位卡片流
// ============================================================
function getFilteredSortedJobs() {
  loadJobPreferences();
  const riskFilter = document.getElementById("jobRiskFilter").value;
  const sortBy = document.getElementById("jobSortSelect").value;

  let jobs = MOCK_JOBS.filter(job => riskFilter === "all" || job.risk_rating === riskFilter);

  const riskRank = { high: 0, medium: 1, low: 2 };
  const sorters = {
    match: (a, b) => b.llm_score - a.llm_score,
    risk: (a, b) => riskRank[a.risk_rating] - riskRank[b.risk_rating],
    location: (a, b) => a.location_city.localeCompare(b.location_city, "zh-CN"),
    source: (a, b) => a.ats_type.localeCompare(b.ats_type, "zh-CN")
  };
  jobs = [...jobs].sort(sorters[sortBy] || sorters.match);
  return jobs;
}

function jobCardHtml(job) {
  const grade = MATCH_GRADE_STYLE[job.llm_grade] || MATCH_GRADE_STYLE.C;
  const risk = RISK_STYLE[job.risk_rating] || RISK_STYLE.medium;
  return `
    <article class="job-card" data-job-id="${job.id}">
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
        <span class="small-muted">来源 ${escapeHtml(ATS_LABELS[job.ats_type] || job.ats_type)}</span>
      </div>
      <p class="job-card-requirements">${escapeHtml(job.jd_summary)}</p>
      <div class="card-actions job-card-actions">
        <button type="button" class="btn secondary" data-view-job="${job.id}">查看详情</button>
        <button type="button" class="btn primary" data-add-job="${job.id}">加入申请</button>
      </div>
    </article>
  `;
}

function renderJobCardGrid() {
  const grid = document.getElementById("jobCardGrid");
  if (!grid) return;
  const jobs = getFilteredSortedJobs();
  if (!jobs.length) {
    grid.innerHTML = `<div class="empty-state">当前筛选条件下没有匹配的岗位。</div>`;
    return;
  }
  grid.innerHTML = jobs.map(jobCardHtml).join("");
}

function openJobDetail(jobId) {
  const job = MOCK_JOBS.find(j => j.id === jobId);
  if (!job) return;
  const grade = MATCH_GRADE_STYLE[job.llm_grade] || MATCH_GRADE_STYLE.C;
  const risk = RISK_STYLE[job.risk_rating] || RISK_STYLE.medium;
  document.getElementById("jobDetailTitle").textContent = `${job.title} · ${job.company_legal_name}`;
  document.getElementById("jobDetailBody").innerHTML = `
    <div class="chip-input" style="margin-bottom:14px">
      <span class="grade-badge" style="background:${grade.bg};color:${grade.color}">匹配等级 ${job.llm_grade}（${job.llm_score} 分）</span>
      <span class="risk-badge" style="background:${risk.bg};color:${risk.color}">背调 ${risk.label}</span>
    </div>
    <p><strong>地点：</strong>${escapeHtml(job.location_city)}</p>
    <p><strong>薪资：</strong>${escapeHtml(job.salary_raw)}</p>
    <p><strong>雇佣类型：</strong>${escapeHtml(job.employment_type)}</p>
    <p><strong>来源：</strong>${escapeHtml(ATS_LABELS[job.ats_type] || job.ats_type)}</p>
    <p><strong>核心要求：</strong>${escapeHtml(job.jd_summary)}</p>
    <p class="small-muted" style="margin-top:14px">JD 原文（jd_raw）与匹配差距分析（job_matches.gaps）等真实 score-jobs 数据接入后展示，目前为本地演示数据占位。</p>
  `;
  document.getElementById("jobDetailApplyLink").href = job.apply_url;
  document.getElementById("jobDetailAddBtn").dataset.addJob = job.id;
  openModal("jobDetailModal");
}

async function addJobToApplications(jobId) {
  const job = MOCK_JOBS.find(j => j.id === jobId);
  if (!job) return;
  const record = {
    id: crypto.randomUUID(),
    company: job.company_legal_name,
    role: job.title,
    status: "准备申请",
    appliedDate: new Date().toISOString().slice(0, 10),
    location: job.location_city,
    source: `智能岗位推荐 · ${ATS_LABELS[job.ats_type] || job.ats_type}`,
    jobUrl: job.apply_url,
    notes: `匹配等级 ${job.llm_grade}（${job.llm_score} 分）· 背调风险：${(RISK_STYLE[job.risk_rating] || {}).label || job.risk_rating}\n核心要求：${job.jd_summary}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  try {
    await dbUpsert(TABLE_APPLICATIONS, applicationToRow(record));
    await loadState();
    renderAll();
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

  document.getElementById("jobCardGrid").addEventListener("click", e => {
    const viewBtn = e.target.closest("[data-view-job]");
    const addBtn = e.target.closest("[data-add-job]");
    if (viewBtn) openJobDetail(viewBtn.dataset.viewJob);
    if (addBtn) addJobToApplications(addBtn.dataset.addJob);
  });

  document.getElementById("jobDetailAddBtn").addEventListener("click", e => {
    addJobToApplications(e.target.dataset.addJob);
  });
}

document.addEventListener("DOMContentLoaded", initJobsModule);

window.renderJobPreferencesForm = renderJobPreferencesForm;
window.renderJobCardGrid = renderJobCardGrid;
