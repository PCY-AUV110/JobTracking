const DB_NAME = "JobTrackDB";
const DB_VERSION = 1;
const STORE_APPLICATIONS = "applications";
const STORE_INTERVIEWS = "interviews";
const STORE_SETTINGS = "settings";

const STATUSES = [
  "准备申请",
  "已申请",
  "审核中",
  "在线测评",
  "准备面试",
  "面试完成",
  "收到 Offer",
  "已终止"
];

const PAGE_META = {
  applications: ["APPLICATION TRACKER", "我的求职申请", "集中记录申请进度，快速查看下一步行动。"],
  interviews: ["INTERVIEW CALENDAR", "面试日程", "管理即将进行与已经完成的面试。"],
  analytics: ["CAREER ANALYTICS", "数据统计", "通过数据了解申请进度和转化情况。"],
  settings: ["LOCAL WORKSPACE", "系统设置", "管理本地数据、备份和界面偏好。"]
};

const seedApplications = [
  {
    id: crypto.randomUUID(),
    company: "TMX Group",
    role: "Corporate Functions Coordinator Intern",
    status: "在线测评",
    appliedDate: "2026-08-03",
    location: "Toronto, ON",
    source: "Company Website",
    jobUrl: "",
    notes: "完成在线 assessment 后跟进。",
    createdAt: Date.now() - 1000000,
    updatedAt: Date.now() - 900000
  },
  {
    id: crypto.randomUUID(),
    company: "University of Toronto",
    role: "Lab Assistant Position",
    status: "准备申请",
    appliedDate: "2026-08-04",
    location: "Toronto, ON",
    source: "Email Outreach",
    jobUrl: "",
    notes: "联系 EESC30 课程老师 Lauren Hemara。",
    createdAt: Date.now() - 800000,
    updatedAt: Date.now() - 700000
  },
  {
    id: crypto.randomUUID(),
    company: "Goodrec",
    role: "Marketing / Community Intern",
    status: "审核中",
    appliedDate: "2026-07-29",
    location: "Toronto, ON",
    source: "LinkedIn",
    jobUrl: "",
    notes: "突出社交媒体、活动摄影及球队社区运营经验。",
    createdAt: Date.now() - 600000,
    updatedAt: Date.now() - 500000
  },
  {
    id: crypto.randomUUID(),
    company: "Sample Company",
    role: "Business Operations Intern",
    status: "已终止",
    appliedDate: "2026-07-18",
    location: "Remote",
    source: "Indeed",
    jobUrl: "",
    notes: "岗位已关闭。",
    createdAt: Date.now() - 400000,
    updatedAt: Date.now() - 300000
  }
];

let db;
let applications = [];
let interviews = [];
let settings = {
  compactMode: false,
  defaultActive: true
};
let currentTab = "active";
let calendarCursor = new Date();

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_APPLICATIONS)) {
        const store = database.createObjectStore(STORE_APPLICATIONS, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("appliedDate", "appliedDate", { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_INTERVIEWS)) {
        const store = database.createObjectStore(STORE_INTERVIEWS, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("applicationId", "applicationId", { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }
    };

    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function seedIfNeeded() {
  const existing = await getAll(STORE_APPLICATIONS);
  if (!existing.length) {
    for (const app of seedApplications) await putRecord(STORE_APPLICATIONS, app);
  }
}

async function loadState() {
  applications = await getAll(STORE_APPLICATIONS);
  interviews = await getAll(STORE_INTERVIEWS);

  const storedSettings = await getAll(STORE_SETTINGS);
  storedSettings.forEach(item => {
    settings[item.key] = item.value;
  });

  document.body.classList.toggle("compact", !!settings.compactMode);
  document.getElementById("compactModeToggle").checked = !!settings.compactMode;
  document.getElementById("defaultActiveToggle").checked = settings.defaultActive !== false;

  if (settings.defaultActive === false) {
    currentTab = "all";
    document.querySelectorAll(".segment").forEach(el => {
      el.classList.toggle("active", el.dataset.tab === "all");
    });
  }
}

async function saveSetting(key, value) {
  settings[key] = value;
  await putRecord(STORE_SETTINGS, { key, value });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function initials(company) {
  return company.trim().split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(date) {
  if (!date) return "未填写";
  return new Date(`${date}T00:00:00`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatDateTime(date, time) {
  const dateText = formatDate(date);
  return time ? `${dateText} ${time}` : dateText;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function openModal(id) {
  document.getElementById(id).classList.add("show");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("show");
}

function statusGroup(status) {
  return status === "已终止" ? "closed" : "active";
}

function renderStats() {
  const total = applications.length;
  const active = applications.filter(item => statusGroup(item.status) === "active").length;
  const interviewsReady = applications.filter(item => item.status === "准备面试").length;
  const offers = applications.filter(item => item.status === "收到 Offer").length;

  document.getElementById("statsGrid").innerHTML = [
    ["总申请数", total, "所有已记录职位"],
    ["进行中", active, "仍有后续机会"],
    ["准备面试", interviewsReady, "需要重点准备"],
    ["收到 Offer", offers, "当前成功结果"]
  ].map(([label, value, foot]) => `
    <article class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-foot">${foot}</div>
    </article>
  `).join("");
}

function renderStatusOptions() {
  const filter = document.getElementById("statusFilter");
  const formSelect = document.getElementById("statusInput");
  filter.innerHTML = `<option value="全部">全部状态</option>` +
    STATUSES.map(status => `<option>${status}</option>`).join("");
  formSelect.innerHTML = STATUSES.map(status => `<option>${status}</option>`).join("");
}

function renderApplications() {
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();
  const statusFilter = document.getElementById("statusFilter").value;
  const sort = document.getElementById("sortFilter").value;

  let filtered = applications.filter(item => {
    const tabMatch = currentTab === "all" || statusGroup(item.status) === currentTab;
    const text = `${item.company} ${item.role} ${item.notes || ""} ${item.location || ""}`.toLowerCase();
    const searchMatch = text.includes(keyword);
    const statusMatch = statusFilter === "全部" || item.status === statusFilter;
    return tabMatch && searchMatch && statusMatch;
  });

  filtered.sort((a, b) => {
    if (sort === "company") return a.company.localeCompare(b.company, "zh-CN");
    if (sort === "updated") return (b.updatedAt || 0) - (a.updatedAt || 0);
    return (b.appliedDate || "").localeCompare(a.appliedDate || "");
  });

  const list = document.getElementById("applicationList");

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">当前没有符合条件的申请记录。</div>`;
    return;
  }

  list.innerHTML = filtered.map(item => `
    <article class="application-card">
      <div class="company-block">
        <div class="company-logo">${initials(item.company)}</div>
        <div style="min-width:0">
          <div class="application-title">${escapeHtml(item.role)}</div>
          <div class="application-meta">
            ${escapeHtml(item.company)} · ${escapeHtml(item.location || "地点未填写")}
          </div>
          <div class="application-note">${escapeHtml(item.notes || "暂无备注")}</div>
        </div>
      </div>

      <div>
        <div class="label">当前状态</div>
        <select class="status-select" data-status-id="${item.id}">
          ${STATUSES.map(status => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>

      <div>
        <div class="label">申请日期</div>
        <div>${formatDate(item.appliedDate)}</div>
        <div class="small-muted" style="margin-top:6px">${escapeHtml(item.source || "渠道未填写")}</div>
      </div>

      <div class="card-actions">
        ${item.jobUrl ? `<button class="icon-btn" title="打开职位链接" data-open-url="${escapeHtml(item.jobUrl)}">↗</button>` : ""}
        <button class="icon-btn" title="编辑" data-edit-app="${item.id}">✎</button>
        <button class="icon-btn" title="删除" data-delete-app="${item.id}">⌫</button>
      </div>
    </article>
  `).join("");
}

function applicationName(id) {
  const app = applications.find(item => item.id === id);
  return app ? `${app.company} · ${app.role}` : "未关联申请";
}

function renderInterviewApplicationOptions() {
  const select = document.getElementById("interviewApplicationInput");
  select.innerHTML = applications
    .filter(item => item.status !== "已终止")
    .map(item => `<option value="${item.id}">${escapeHtml(item.company)} · ${escapeHtml(item.role)}</option>`)
    .join("");
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  document.getElementById("calendarTitle").textContent =
    new Date(year, month, 1).toLocaleDateString("zh-CN", { year: "numeric", month: "long" });

  const firstDay = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstDay.getDay());
  const today = new Date();
  const cells = [];

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = date.toISOString().slice(0, 10);
    const dayInterviews = interviews.filter(item => item.date === iso);
    const isMuted = date.getMonth() !== month;
    const isToday = date.toDateString() === today.toDateString();

    cells.push(`
      <div class="calendar-day ${isMuted ? "muted" : ""} ${isToday ? "today" : ""}">
        <div class="day-number">${date.getDate()}</div>
        ${dayInterviews.slice(0, 2).map(item =>
          `<div class="interview-dot">${escapeHtml(applicationName(item.applicationId).split(" · ")[0])}</div>`
        ).join("")}
      </div>
    `);
  }

  document.getElementById("calendarDays").innerHTML = cells.join("");
}

function renderUpcomingInterviews() {
  const nowIso = new Date().toISOString().slice(0, 10);
  const upcoming = [...interviews]
    .filter(item => item.date >= nowIso)
    .sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`))
    .slice(0, 8);

  const container = document.getElementById("upcomingInterviews");

  if (!upcoming.length) {
    container.innerHTML = `<div class="empty-state" style="padding:28px 16px">暂无即将进行的面试。</div>`;
    return;
  }

  container.innerHTML = upcoming.map(item => `
    <article class="interview-item">
      <div class="interview-date">${formatDateTime(item.date, item.time)}</div>
      <div class="interview-title">${escapeHtml(applicationName(item.applicationId))}</div>
      <div class="small-muted">${escapeHtml(item.type)} · ${escapeHtml(item.format)}</div>
      <div class="interview-actions">
        <button class="icon-btn" data-edit-interview="${item.id}" title="编辑">✎</button>
        <button class="icon-btn" data-delete-interview="${item.id}" title="删除">⌫</button>
      </div>
    </article>
  `).join("");
}

function renderAnalytics() {
  const statusCounts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  applications.forEach(item => statusCounts[item.status] = (statusCounts[item.status] || 0) + 1);
  const maxCount = Math.max(1, ...Object.values(statusCounts));

  document.getElementById("statusChart").innerHTML = Object.entries(statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `
      <div class="bar-row">
        <div class="bar-label">${status}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / maxCount) * 100}%"></div></div>
        <div class="bar-value">${count}</div>
      </div>
    `).join("") || `<div class="empty-state">暂无数据</div>`;

  const sourceCounts = {};
  applications.forEach(item => {
    const source = item.source || "未填写";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });

  const sources = Object.entries(sourceCounts);
  const total = Math.max(1, applications.length);
  const colors = ["#D97757", "#58789A", "#4F806B", "#B7791F", "#8E6C8A", "#9A7565"];
  let current = 0;
  const stops = sources.map(([_, count], index) => {
    const start = current;
    current += (count / total) * 100;
    return `${colors[index % colors.length]} ${start}% ${current}%`;
  }).join(", ");

  document.getElementById("sourceChart").innerHTML = `
    <div class="donut" style="background:conic-gradient(${stops || "#E8E1D9 0 100%"})">
      <div class="donut-center">
        <div><strong>${applications.length}</strong><span class="small-muted">总申请</span></div>
      </div>
    </div>
  `;

  const active = applications.filter(item => item.status !== "已终止").length;
  const interviewStage = applications.filter(item =>
    ["准备面试", "面试完成", "收到 Offer"].includes(item.status)
  ).length;
  const offers = applications.filter(item => item.status === "收到 Offer").length;
  const interviewRate = applications.length ? Math.round(interviewStage / applications.length * 100) : 0;
  const offerRate = applications.length ? Math.round(offers / applications.length * 100) : 0;

  document.getElementById("metricCards").innerHTML = [
    ["进行中申请", active],
    ["进入面试阶段", interviewStage],
    ["面试转化率", `${interviewRate}%`],
    ["Offer 转化率", `${offerRate}%`]
  ].map(([label, value]) => `
    <div class="metric-item">
      <span class="small-muted">${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");

  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(now.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const count = applications.filter(item => {
      if (!item.appliedDate) return false;
      const date = new Date(`${item.appliedDate}T00:00:00`);
      return date >= start && date <= end;
    }).length;
    weeks.push({
      label: `${end.getMonth() + 1}/${end.getDate()}`,
      count
    });
  }

  const maxWeek = Math.max(1, ...weeks.map(item => item.count));
  document.getElementById("trendChart").innerHTML = weeks.map(item => `
    <div class="trend-col">
      <div class="small-muted">${item.count}</div>
      <div class="trend-bar" style="height:${Math.max(5, item.count / maxWeek * 170)}px"></div>
      <div class="trend-label">${item.label}</div>
    </div>
  `).join("");
}

function renderAll() {
  renderStats();
  renderApplications();
  renderInterviewApplicationOptions();
  renderCalendar();
  renderUpcomingInterviews();
  renderAnalytics();
}

function resetApplicationForm() {
  document.getElementById("applicationForm").reset();
  document.getElementById("applicationId").value = "";
  document.getElementById("applicationModalTitle").textContent = "添加职位申请";
  document.getElementById("appliedDateInput").value = new Date().toISOString().slice(0, 10);
  document.getElementById("statusInput").value = "准备申请";
}

function editApplication(id) {
  const item = applications.find(app => app.id === id);
  if (!item) return;

  document.getElementById("applicationId").value = item.id;
  document.getElementById("companyInput").value = item.company;
  document.getElementById("roleInput").value = item.role;
  document.getElementById("statusInput").value = item.status;
  document.getElementById("appliedDateInput").value = item.appliedDate || "";
  document.getElementById("locationInput").value = item.location || "";
  document.getElementById("sourceInput").value = item.source || "";
  document.getElementById("jobUrlInput").value = item.jobUrl || "";
  document.getElementById("notesInput").value = item.notes || "";
  document.getElementById("applicationModalTitle").textContent = "编辑职位申请";
  openModal("applicationModal");
}

function resetInterviewForm() {
  document.getElementById("interviewForm").reset();
  document.getElementById("interviewId").value = "";
  document.getElementById("interviewModalTitle").textContent = "添加面试";
  document.getElementById("interviewDateInput").value = new Date().toISOString().slice(0, 10);
}

function editInterview(id) {
  const item = interviews.find(interview => interview.id === id);
  if (!item) return;

  document.getElementById("interviewId").value = item.id;
  document.getElementById("interviewApplicationInput").value = item.applicationId;
  document.getElementById("interviewDateInput").value = item.date;
  document.getElementById("interviewTimeInput").value = item.time || "";
  document.getElementById("interviewTypeInput").value = item.type;
  document.getElementById("interviewFormatInput").value = item.format;
  document.getElementById("interviewLinkInput").value = item.link || "";
  document.getElementById("interviewNotesInput").value = item.notes || "";
  document.getElementById("interviewModalTitle").textContent = "编辑面试";
  openModal("interviewModal");
}

async function exportData() {
  const payload = {
    app: "JobTrack",
    version: 1,
    exportedAt: new Date().toISOString(),
    applications,
    interviews,
    settings
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `jobtrack-backup-${new Date().toISOString().slice(0,10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("备份已导出");
}

async function importData(file) {
  const text = await file.text();
  const payload = JSON.parse(text);

  if (!Array.isArray(payload.applications) || !Array.isArray(payload.interviews)) {
    throw new Error("备份文件格式不正确");
  }

  await clearStore(STORE_APPLICATIONS);
  await clearStore(STORE_INTERVIEWS);
  await clearStore(STORE_SETTINGS);

  for (const item of payload.applications) await putRecord(STORE_APPLICATIONS, item);
  for (const item of payload.interviews) await putRecord(STORE_INTERVIEWS, item);

  const importedSettings = payload.settings || {};
  for (const [key, value] of Object.entries(importedSettings)) {
    await putRecord(STORE_SETTINGS, { key, value });
  }

  await loadState();
  renderAll();
  showToast("备份已恢复");
}

function switchView(view) {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `${view}View`);
  });

  const [eyebrow, title, subtitle] = PAGE_META[view];
  document.getElementById("eyebrow").textContent = eyebrow;
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = subtitle;

  document.getElementById("topActions").style.display =
    view === "applications" ? "flex" : "none";

  if (view === "analytics") renderAnalytics();
  if (view === "interviews") {
    renderCalendar();
    renderUpcomingInterviews();
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });

  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.getElementById("addApplicationBtn").addEventListener("click", () => {
    resetApplicationForm();
    openModal("applicationModal");
  });

  document.getElementById("addInterviewBtn").addEventListener("click", () => {
    if (!applications.filter(item => item.status !== "已终止").length) {
      showToast("请先添加一条进行中的职位申请");
      return;
    }
    resetInterviewForm();
    openModal("interviewModal");
  });

  document.getElementById("applicationForm").addEventListener("submit", async event => {
    event.preventDefault();
    const id = document.getElementById("applicationId").value || crypto.randomUUID();
    const old = applications.find(item => item.id === id);

    const record = {
      id,
      company: document.getElementById("companyInput").value.trim(),
      role: document.getElementById("roleInput").value.trim(),
      status: document.getElementById("statusInput").value,
      appliedDate: document.getElementById("appliedDateInput").value,
      location: document.getElementById("locationInput").value.trim(),
      source: document.getElementById("sourceInput").value.trim(),
      jobUrl: document.getElementById("jobUrlInput").value.trim(),
      notes: document.getElementById("notesInput").value.trim(),
      createdAt: old?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    await putRecord(STORE_APPLICATIONS, record);
    await loadState();
    renderAll();
    closeModal("applicationModal");
    showToast(old ? "申请已更新" : "申请已添加");
  });

  document.getElementById("interviewForm").addEventListener("submit", async event => {
    event.preventDefault();
    const id = document.getElementById("interviewId").value || crypto.randomUUID();
    const old = interviews.find(item => item.id === id);

    const record = {
      id,
      applicationId: document.getElementById("interviewApplicationInput").value,
      date: document.getElementById("interviewDateInput").value,
      time: document.getElementById("interviewTimeInput").value,
      type: document.getElementById("interviewTypeInput").value,
      format: document.getElementById("interviewFormatInput").value,
      link: document.getElementById("interviewLinkInput").value.trim(),
      notes: document.getElementById("interviewNotesInput").value.trim(),
      createdAt: old?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    await putRecord(STORE_INTERVIEWS, record);
    await loadState();
    renderAll();
    closeModal("interviewModal");
    showToast(old ? "面试已更新" : "面试已添加");
  });

  document.getElementById("applicationList").addEventListener("change", async event => {
    const id = event.target.dataset.statusId;
    if (!id) return;
    const item = applications.find(app => app.id === id);
    item.status = event.target.value;
    item.updatedAt = Date.now();
    await putRecord(STORE_APPLICATIONS, item);
    await loadState();
    renderAll();
    showToast("状态已更新");
  });

  document.getElementById("applicationList").addEventListener("click", async event => {
    const editId = event.target.dataset.editApp;
    const deleteId = event.target.dataset.deleteApp;
    const url = event.target.dataset.openUrl;

    if (url) window.open(url, "_blank", "noopener");
    if (editId) editApplication(editId);

    if (deleteId && confirm("确定删除这条申请记录吗？")) {
      await deleteRecord(STORE_APPLICATIONS, deleteId);
      const related = interviews.filter(item => item.applicationId === deleteId);
      for (const interview of related) await deleteRecord(STORE_INTERVIEWS, interview.id);
      await loadState();
      renderAll();
      showToast("申请已删除");
    }
  });

  document.getElementById("upcomingInterviews").addEventListener("click", async event => {
    const editId = event.target.dataset.editInterview;
    const deleteId = event.target.dataset.deleteInterview;
    if (editId) editInterview(editId);

    if (deleteId && confirm("确定删除这条面试记录吗？")) {
      await deleteRecord(STORE_INTERVIEWS, deleteId);
      await loadState();
      renderAll();
      showToast("面试已删除");
    }
  });

  document.getElementById("searchInput").addEventListener("input", renderApplications);
  document.getElementById("statusFilter").addEventListener("change", renderApplications);
  document.getElementById("sortFilter").addEventListener("change", renderApplications);

  document.querySelectorAll(".segment").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segment").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      currentTab = button.dataset.tab;
      renderApplications();
    });
  });

  document.getElementById("prevMonth").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById("nextMonth").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById("exportQuickBtn").addEventListener("click", exportData);
  document.getElementById("exportDataBtn").addEventListener("click", exportData);

  document.getElementById("importDataInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await importData(file);
    } catch (error) {
      alert(error.message || "导入失败");
    } finally {
      event.target.value = "";
    }
  });

  document.getElementById("compactModeToggle").addEventListener("change", async event => {
    document.body.classList.toggle("compact", event.target.checked);
    await saveSetting("compactMode", event.target.checked);
  });

  document.getElementById("defaultActiveToggle").addEventListener("change", async event => {
    await saveSetting("defaultActive", event.target.checked);
  });

  document.getElementById("resetDataBtn").addEventListener("click", async () => {
    if (!confirm("确定清空所有本地数据吗？此操作不可撤销。")) return;

    await clearStore(STORE_APPLICATIONS);
    await clearStore(STORE_INTERVIEWS);
    await clearStore(STORE_SETTINGS);
    await seedIfNeeded();
    await loadState();
    renderAll();
    showToast("数据已重置");
  });
}

async function init() {
  try {
    db = await openDB();
    await seedIfNeeded();
    await loadState();
    renderStatusOptions();
    renderAll();
    bindEvents();

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  } catch (error) {
    console.error(error);
    alert("本地数据库初始化失败，请使用最新版 Chrome、Edge 或 Safari 打开。");
  }
}

init();
