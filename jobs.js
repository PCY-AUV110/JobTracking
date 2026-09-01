// ============================================================
// jobs.js — 岗位偏好 + 智能岗位卡片流模块（Day4+）
// 职责：偏好设置表单、mock 岗位卡片渲染/筛选排序、加入申请看板
// 依赖：全局 escapeHtml、showToast、openModal、closeModal、dbUpsert、
//       TABLE_APPLICATIONS、applicationToRow、loadState、renderAll（来自 app.js）
//
// ⚠️ Mock 说明：job_preferences 表、crawl-jobs/score-jobs/vetting-flags
// 契约均未就绪，本文件用 localStorage 存偏好、用硬编码数组模拟岗位数据。
// Codex 契约定稿后（docs/api-contracts-v1.md），把 MOCK_JOBS 换成真实
// dbGetAll(TABLE_JOBS, ...) + job_matches/vetting_reviews 联表结果即可，
// 卡片渲染与筛选排序逻辑不需要重写。
// ============================================================

const JOB_PREF_STORAGE_KEY = "offerflow_mock_job_preferences_v1";

const MATCH_GRADE_STYLE = {
  A: { bg: "rgba(48, 176, 112, 0.14)", color: "#1f7a4d" },
  B: { bg: "rgba(10, 132, 255, 0.14)", color: "#0a5bb0" },
  C: { bg: "rgba(255, 159, 10, 0.14)", color: "#a15c00" },
  D: { bg: "rgba(255, 69, 58, 0.12)", color: "#b53327" },
  F: { bg: "rgba(255, 69, 58, 0.18)", color: "#a02828" }
};

const RISK_STYLE = {
  low: { bg: "rgba(48, 176, 112, 0.14)", color: "#1f7a4d", label: "低风险" },
  medium: { bg: "rgba(255, 159, 10, 0.14)", color: "#a15c00", label: "中风险" },
  high: { bg: "rgba(255, 69, 58, 0.14)", color: "#a02828", label: "高风险" }
};

// 本地演示岗位数据（等 Codex crawl-jobs/score-jobs/vetting-flags 契约就绪后替换为真实数据）
const MOCK_JOBS = [
  { id: "job-1", company: "Shopify", title: "Data Analyst Intern", location: "Toronto, ON", salary: "CAD 28-32/hr", requirements: "SQL、Python、有电商数据分析经验优先", matchGrade: "A", matchScore: 92, riskLevel: "low", source: "Greenhouse", applyUrl: "https://www.shopify.com/careers" },
  { id: "job-2", company: "RBC", title: "Technology Summer Analyst", location: "Toronto, ON", salary: "CAD 26-30/hr", requirements: "计算机/统计相关专业，需加拿大工作授权", matchGrade: "B", matchScore: 78, riskLevel: "medium", source: "Workday", applyUrl: "https://jobs.rbc.com/" },
  { id: "job-3", company: "Deloitte", title: "Business Analytics Intern", location: "Toronto, ON", salary: "CAD 25-27/hr", requirements: "Excel、PowerBI，沟通表达能力强", matchGrade: "B", matchScore: 74, riskLevel: "low", source: "Lever", applyUrl: "https://jobs.deloitte.ca/" },
  { id: "job-4", company: "TD Bank", title: "Data & Analytics Co-op", location: "Toronto, ON", salary: "CAD 24-28/hr", requirements: "需 PR 或 Citizen（合规安全审查岗位）", matchGrade: "C", matchScore: 61, riskLevel: "high", source: "Workday", applyUrl: "https://jobs.td.com/" },
  { id: "job-5", company: "Wealthsimple", title: "Growth Analyst Intern", location: "Toronto, ON (Remote friendly)", salary: "CAD 30/hr", requirements: "SQL、A/B 测试基础，喜欢快节奏环境", matchGrade: "A", matchScore: 88, riskLevel: "low", source: "Ashby", applyUrl: "https://www.wealthsimple.com/careers" },
  { id: "job-6", company: "Scotiabank", title: "Analytics Intern (Fall 2027)", location: "Toronto, ON", salary: "CAD 24-26/hr", requirements: "统计/金融相关专业，需 Security Clearance", matchGrade: "D", matchScore: 45, riskLevel: "high", source: "Workday", applyUrl: "https://jobs.scotiabank.com/" },
  { id: "job-7", company: "Clio", title: "Business Intelligence Intern", location: "Remote (Canada)", salary: "CAD 27/hr", requirements: "SQL、数据可视化工具经验", matchGrade: "B", matchScore: 80, riskLevel: "low", source: "Greenhouse", applyUrl: "https://www.clio.com/careers/" },
  { id: "job-8", company: "CIBC", title: "Data Science Intern", location: "Toronto, ON", salary: "CAD 26-29/hr", requirements: "Python/R，机器学习基础，需加拿大身份", matchGrade: "C", matchScore: 58, riskLevel: "medium", source: "Workday", applyUrl: "https://jobs.cibc.com/" }
];

let jobPreferences = null;

// ============================================================
// 岗位偏好：本地存储读写
// ============================================================
function loadJobPreferences() {
  try {
    const raw = localStorage.getItem(JOB_PREF_STORAGE_KEY);
    jobPreferences = raw ? JSON.parse(raw) : null;
  } catch {
    jobPreferences = null;
  }
  if (!jobPreferences) {
    jobPreferences = { keywords: [], locations: [], jobTypes: [], minSalary: null, excludeWords: [], filterIdentity: true };
  }
  return jobPreferences;
}

function persistJobPreferences() {
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
  renderChipList("prefExcludeChips", jobPreferences.excludeWords, removePrefExclude);
  document.querySelectorAll("#prefJobTypesGroup input[type=checkbox]").forEach(box => {
    box.checked = jobPreferences.jobTypes.includes(box.value);
  });
  document.getElementById("prefMinSalary").value = jobPreferences.minSalary ?? "";
  document.getElementById("prefFilterIdentityToggle").checked = jobPreferences.filterIdentity !== false;
}

// 通用 chip 列表渲染（技能/关键词/地点/排除词共用同一个视觉组件）
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
function removePrefExclude(idx) { jobPreferences.excludeWords.splice(idx, 1); renderJobPreferencesFormUI(); }

function handlePrefSaveClick() {
  jobPreferences.jobTypes = Array.from(document.querySelectorAll("#prefJobTypesGroup input:checked")).map(b => b.value);
  const minSalaryVal = document.getElementById("prefMinSalary").value;
  jobPreferences.minSalary = minSalaryVal ? Number(minSalaryVal) : null;
  jobPreferences.filterIdentity = document.getElementById("prefFilterIdentityToggle").checked;
  // TODO(Day后端就绪): 换成 dbUpsert(TABLE_JOB_PREFERENCES, ...)
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

  let jobs = MOCK_JOBS.filter(job => riskFilter === "all" || job.riskLevel === riskFilter);

  const sorters = {
    match: (a, b) => b.matchScore - a.matchScore,
    risk: (a, b) => ({ high: 0, medium: 1, low: 2 }[a.riskLevel] - { high: 0, medium: 1, low: 2 }[b.riskLevel]),
    location: (a, b) => a.location.localeCompare(b.location, "zh-CN"),
    source: (a, b) => a.source.localeCompare(b.source, "zh-CN")
  };
  jobs = [...jobs].sort(sorters[sortBy] || sorters.match);
  return jobs;
}

function jobCardHtml(job) {
  const grade = MATCH_GRADE_STYLE[job.matchGrade] || MATCH_GRADE_STYLE.C;
  const risk = RISK_STYLE[job.riskLevel] || RISK_STYLE.medium;
  return `
    <article class="job-card" data-job-id="${job.id}">
      <div class="job-card-head">
        <div>
          <div class="job-card-title">${escapeHtml(job.title)}</div>
          <div class="small-muted">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</div>
        </div>
        <span class="grade-badge" style="background:${grade.bg};color:${grade.color}">${job.matchGrade}</span>
      </div>
      <div class="job-card-meta">
        <span>${escapeHtml(job.salary)}</span>
        <span class="risk-badge" style="background:${risk.bg};color:${risk.color}">${risk.label}</span>
        <span class="small-muted">来源 ${escapeHtml(job.source)}</span>
      </div>
      <p class="job-card-requirements">${escapeHtml(job.requirements)}</p>
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
  const grade = MATCH_GRADE_STYLE[job.matchGrade] || MATCH_GRADE_STYLE.C;
  const risk = RISK_STYLE[job.riskLevel] || RISK_STYLE.medium;
  document.getElementById("jobDetailTitle").textContent = `${job.title} · ${job.company}`;
  document.getElementById("jobDetailBody").innerHTML = `
    <div class="chip-input" style="margin-bottom:14px">
      <span class="grade-badge" style="background:${grade.bg};color:${grade.color}">匹配等级 ${job.matchGrade}（${job.matchScore} 分）</span>
      <span class="risk-badge" style="background:${risk.bg};color:${risk.color}">背调 ${risk.label}</span>
    </div>
    <p><strong>地点：</strong>${escapeHtml(job.location)}</p>
    <p><strong>薪资：</strong>${escapeHtml(job.salary)}</p>
    <p><strong>来源：</strong>${escapeHtml(job.source)}</p>
    <p><strong>核心要求：</strong>${escapeHtml(job.requirements)}</p>
    <p class="small-muted" style="margin-top:14px">JD 原文与差距分析等待 Codex parse-resume/score-jobs 联动后展示，目前为本地演示数据占位。</p>
  `;
  document.getElementById("jobDetailApplyLink").href = job.applyUrl;
  document.getElementById("jobDetailAddBtn").dataset.addJob = job.id;
  openModal("jobDetailModal");
}

async function addJobToApplications(jobId) {
  const job = MOCK_JOBS.find(j => j.id === jobId);
  if (!job) return;
  const record = {
    id: crypto.randomUUID(),
    company: job.company,
    role: job.title,
    status: "准备申请",
    appliedDate: new Date().toISOString().slice(0, 10),
    location: job.location,
    source: `智能岗位推荐 · ${job.source}`,
    jobUrl: job.applyUrl,
    notes: `匹配等级 ${job.matchGrade}（${job.matchScore} 分）· 背调风险：${(RISK_STYLE[job.riskLevel] || {}).label || job.riskLevel}\n核心要求：${job.requirements}`,
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
    if (e.key === "Enter") { e.preventDefault(); addPrefChip("excludeWords", "prefExcludeInput"); }
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
