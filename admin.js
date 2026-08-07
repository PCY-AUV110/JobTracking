// ============================================================
// admin.js — OfferFlow 管理员模块
// 职责：管理员控制台的渲染、事件绑定与数据管理
// 依赖：全局 supabase、SUPABASE_ANON_KEY、currentUser、currentProfile
// ============================================================

// ---- 常量 ----
const ADMIN_VIEWS = ["dashboard", "users", "data", "system"];
const ADMIN_PAGE_META = {
  dashboard: ["SYSTEM OVERVIEW", "系统概览", "全局数据与用户活跃情况一览。"],
  users: ["USER MANAGEMENT", "用户管理", "查看所有注册用户，管理角色与状态。"],
  data: ["DATA AUDIT", "数据审查", "跨用户浏览申请与面试数据。"],
  system: ["SYSTEM CONFIG", "系统配置", "仅超级管理员可访问。"]
};

// ---- 运行时状态 ----
let adminCurrentView = "dashboard";
let adminSystemStats = null;
let adminAllProfiles = [];
let adminUserDetails = {};
let adminUsersLoaded = false;
let adminDrawerUserId = null;
let adminRole = "user";

// 系统配置中的函数列表
const ADMIN_EDGE_FUNCTIONS = [
  { name: "get-system-stats", path: "/functions/v1/get-system-stats" },
  { name: "toggle-user-role", path: "/functions/v1/toggle-user-role" },
  { name: "set-user-active", path: "/functions/v1/set-user-active" },
  { name: "delete-user-data", path: "/functions/v1/delete-user-data" },
  { name: "get-user-detail", path: "/functions/v1/get-user-detail" },
  { name: "parse-link", path: "/functions/v1/parse-link" },
  { name: "parse-text", path: "/functions/v1/parse-text" },
  { name: "parse-screenshot", path: "/functions/v1/parse-screenshot" },
];

// 申请状态常量
const ADMIN_STATUSES = [
  "准备申请", "已申请", "审核中", "在线测评",
  "准备面试", "面试完成", "收到 Offer", "已终止"
];

// ============================================================
// 通用工具
// ============================================================

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function callAdminEdgeFunction(name, body = null, method = "POST") {
  const { data: { session } } = await supabase.auth.getSession();
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`
    }
  };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, options);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

// 兼容旧调用
async function callAdminFunction(name, opts = {}) {
  const { method = "POST", body } = opts;
  return callAdminEdgeFunction(name, body, method);
}

function roleBadgeClass(role) {
  if (role === "super_admin") return "super";
  if (role === "admin") return "admin";
  return "user";
}

function roleLabel(role) {
  return { user: "用户", admin: "管理员", super_admin: "超级管理员" }[role] || role;
}

// 兼容别名
const roleBadgeLabel = roleLabel;

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// 兼容别名
const esc = escapeHtml;

function statusColor(status) {
  const map = {
    "准备申请": "#8e8e93",
    "已申请": "#1E5FB8",
    "审核中": "#7B3FF2",
    "在线测评": "#FF9500",
    "准备面试": "#FF2D55",
    "面试完成": "#30b070",
    "收到 Offer": "#34C759",
    "已终止": "#ff3b30",
  };
  return map[status] || "#8e8e93";
}

// ============================================================
// 权限检查
// ============================================================

async function checkAdminAccess() {
  if (!currentUser) {
    console.warn("[admin] checkAdminAccess: currentUser is null");
    return false;
  }
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", currentUser.id)
      .single();
    if (error) {
      console.warn("[admin] checkAdminAccess query failed:", error.message);
      return false;
    }
    if (!data) {
      console.warn("[admin] checkAdminAccess: no profile found for user", currentUser.id);
      return false;
    }
    if (!data.is_active) {
      showToast("你的账户已被禁用，请联系管理员。");
      await supabase.auth.signOut();
      return false;
    }
    const isAdmin = ["admin", "super_admin"].includes(data.role);
    console.log("[admin] checkAdminAccess: role=", data.role, "isAdmin=", isAdmin);
    return isAdmin;
  } catch (err) {
    console.warn("[admin] checkAdminAccess exception:", err.message);
    return false;
  }
}

async function getAdminRole() {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", currentUser.id)
    .single();
  adminRole = data?.role || "user";
  return adminRole;
}

// ============================================================
// Shell 显示/隐藏
// ============================================================

function showAdminShell() {
  document.getElementById("appShell").style.display = "none";
  const adminShell = document.getElementById("adminShell");
  adminShell.style.display = "flex";
  updateAdminTopbar();
}

function hideAdminShell() {
  const adminShell = document.getElementById("adminShell");
  if (adminShell) adminShell.style.display = "none";
  document.getElementById("appShell").style.display = "grid";
}

function updateAdminTopbar() {
  const emailEl = document.getElementById("adminCurrentUserEmail");
  const badgeEl = document.getElementById("adminRoleBadge");
  if (emailEl && currentUser?.email) emailEl.textContent = currentUser.email;
  if (badgeEl) {
    badgeEl.className = "admin-role-badge role-badge " + roleBadgeClass(adminRole);
    badgeEl.textContent = adminRole === "super_admin" ? "SUPER ADMIN" : "ADMIN";
  }
}

// ============================================================
// 视图切换
// ============================================================

function switchAdminView(view) {
  if (!ADMIN_VIEWS.includes(view)) return;
  if (view === "system" && adminRole !== "super_admin") {
    showToast("仅超级管理员可访问系统配置。");
    return;
  }

  adminCurrentView = view;

  document.querySelectorAll(".admin-nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.adminView === view);
  });

  const targetId = `admin${capitalize(view)}View`;
  document.querySelectorAll(".admin-view").forEach(section => {
    section.classList.toggle("active", section.id === targetId);
  });

  if (view === "dashboard") loadAdminDashboard();
  else if (view === "users" && !adminUsersLoaded) loadAdminUsers();
  else if (view === "data") loadAdminData();
  else if (view === "system") loadAdminSystem();
}

// ============================================================
// 初始化（由 app.js 调用）
// ============================================================

function bindAdminEvents() {
  // 返回用户视图
  document.getElementById("adminBackBtn")?.addEventListener("click", hideAdminShell);

  // 管理员子导航
  document.querySelectorAll(".admin-nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchAdminView(btn.dataset.adminView));
  });

  // 刷新统计
  document.getElementById("adminRefreshStatsBtn")?.addEventListener("click", loadAdminDashboard);

  // 用户搜索与筛选（防抖）
  let searchTimer = null;
  document.getElementById("adminUserSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderAdminUserTable, 200);
  });
  document.getElementById("adminUserRoleFilter")?.addEventListener("change", renderAdminUserTable);
  document.getElementById("adminUserStatusFilter")?.addEventListener("change", renderAdminUserTable);

  // 用户操作按钮（事件委托）
  document.getElementById("adminUserTableBody")?.addEventListener("click", async (e) => {
    const viewId = e.target.dataset.viewUser;
    const toggleRoleId = e.target.dataset.toggleRole;
    const toggleActiveId = e.target.dataset.toggleActive;

    if (viewId) openUserDrawer(viewId);
    if (toggleRoleId) handleToggleRole(toggleRoleId);
    if (toggleActiveId) handleToggleActive(toggleActiveId);
  });

  // 抽屉关闭
  document.querySelectorAll("[data-close-drawer]").forEach(el => {
    el.addEventListener("click", () => {
      document.getElementById("adminUserDrawer").style.display = "none";
    });
  });

  // 数据审查筛选
  document.getElementById("adminDataUserFilter")?.addEventListener("change", () => loadAdminData());
  document.getElementById("adminDataStatusFilter")?.addEventListener("change", () => loadAdminData());
  let dataSearchTimer = null;
  document.getElementById("adminDataSearch")?.addEventListener("input", () => {
    clearTimeout(dataSearchTimer);
    dataSearchTimer = setTimeout(() => loadAdminData(), 200);
  });

  // 系统配置按钮
  document.getElementById("adminResetAllDataBtn")?.addEventListener("click", handleResetAllData);
  document.getElementById("adminExportAllDataBtn")?.addEventListener("click", handleExportAllData);
}

// 兼容旧名
const initAdmin = bindAdminEvents;

// ============================================================
// 管理员入口按钮
// ============================================================

function showAdminEntryButton() {
  const userCard = document.querySelector(".user-card");
  if (!userCard || document.getElementById("adminEntryBtn")) return;

  const btn = document.createElement("button");
  btn.id = "adminEntryBtn";
  btn.className = "admin-entry-btn";
  btn.innerHTML = `🛡 <span>管理控制台</span>`;
  btn.addEventListener("click", () => {
    showAdminShell();
    switchAdminView("dashboard");
  });

  userCard.parentNode.insertBefore(btn, userCard);
}

// ============================================================
// 系统概览（Dashboard）
// ============================================================

async function loadAdminDashboard() {
  const grid = document.getElementById("adminStatsGrid");
  if (!grid) return;
  grid.innerHTML = '<div class="admin-loading">加载中...</div>';

  try {
    const raw = await callAdminEdgeFunction("get-system-stats", null, "GET");
    // 扁平化映射，统一字段访问
    adminSystemStats = {
      totalUsers: raw.users?.total ?? 0,
      activeUsers: raw.users?.active ?? 0,
      totalApplications: raw.applications?.total ?? 0,
      totalInterviews: raw.interviews?.total ?? 0,
      recentSignups: raw.users?.newIn7d ?? 0,
      logged7d: raw.users?.logged7d ?? 0,
      byRole: raw.users?.byRole || {},
      byStatus: raw.applications?.byStatus || {},
      uniqueApplicants: raw.applications?.uniqueApplicants ?? 0,
      generatedAt: raw.generatedAt,
    };
    renderAdminStats();
    loadRecentUsers();
  } catch (err) {
    grid.innerHTML = `<div class="admin-error">加载失败：${escapeHtml(err.message || "未知错误")}</div>`;
  }
}

function renderAdminStats() {
  if (!adminSystemStats) return;
  const s = adminSystemStats;
  const grid = document.getElementById("adminStatsGrid");
  if (!grid) return;

  const byRole = s.byRole || {};
  const cards = [
    { label: "注册用户", value: s.totalUsers, foot: `${s.activeUsers} 位启用中`, accent: "blue" },
    { label: "管理员", value: (byRole.admin || 0) + (byRole.super_admin || 0), foot: `含 ${byRole.super_admin || 0} 位超级管理员`, accent: "purple" },
    { label: "新增（7天）", value: s.recentSignups, foot: `${s.logged7d} 位近 7 天登录`, accent: "green" },
    { label: "职位申请", value: s.totalApplications, foot: `${s.uniqueApplicants} 位用户提交`, accent: "amber" },
    { label: "面试记录", value: s.totalInterviews, foot: "全平台合计", accent: "pink" },
  ];

  grid.innerHTML = cards.map((c) => `
    <article class="admin-stat-card admin-accent-${c.accent}">
      <div class="admin-stat-label">${escapeHtml(c.label)}</div>
      <div class="admin-stat-value">${c.value}</div>
      <div class="admin-stat-foot">${escapeHtml(c.foot)}</div>
    </article>
  `).join("");

  // 申请状态分布
  const statusEntries = Object.entries(s.byStatus || {}).sort((a, b) => b[1] - a[1]);
  if (statusEntries.length) {
    const max = Math.max(...statusEntries.map(([, n]) => n), 1);
    grid.innerHTML += `
      <article class="admin-stat-card admin-stat-wide">
        <div class="admin-stat-label">申请状态分布（全平台）</div>
        <div class="admin-bar-list">
          ${statusEntries.map(([name, n]) => `
            <div class="admin-bar-row">
              <span class="admin-bar-name">${escapeHtml(name)}</span>
              <div class="admin-bar-track"><div class="admin-bar-fill" style="width:${Math.round((n / max) * 100)}%;background:${statusColor(name)}"></div></div>
              <span class="admin-bar-count">${n}</span>
            </div>
          `).join("")}
        </div>
      </article>`;
  }
}

async function loadRecentUsers() {
  const container = document.getElementById("adminRecentUsersList");
  if (!container) return;
  container.innerHTML = '<div class="admin-loading">加载中...</div>';

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false });
    if (error) throw error;

    if (!data?.length) {
      container.innerHTML = '<div class="admin-empty">近 7 天无新注册用户。</div>';
      return;
    }
    container.innerHTML = `<table class="admin-table">
      <thead><tr><th>邮箱</th><th>角色</th><th>注册时间</th></tr></thead>
      <tbody>${data.map(p => `<tr>
        <td>${escapeHtml(p.email)}</td>
        <td><span class="role-badge ${roleBadgeClass(p.role)}">${roleBadgeLabel(p.role)}</span></td>
        <td class="muted">${new Date(p.created_at).toLocaleString("zh-CN")}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  } catch (err) {
    container.innerHTML = `<div class="admin-error">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// 用户管理
// ============================================================

async function loadAdminUsers() {
  const tbody = document.getElementById("adminUserTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="admin-loading">加载中...</td></tr>';

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    adminAllProfiles = data || [];

    // 同步填充数据审查的用户筛选下拉
    populateDataUserFilter();

    adminUsersLoaded = true;
    renderAdminUserTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-error">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

function populateDataUserFilter() {
  const sel = document.getElementById("adminDataUserFilter");
  if (!sel) return;
  const options = ['<option value="all">全部用户</option>'];
  adminAllProfiles.forEach((u) => {
    const label = u.display_name || u.email || "未知";
    options.push(`<option value="${escapeHtml(u.id)}">${escapeHtml(label)}</option>`);
  });
  sel.innerHTML = options.join("");
}

function renderAdminUserTable() {
  const tbody = document.getElementById("adminUserTableBody");
  if (!tbody) return;

  const keyword = (document.getElementById("adminUserSearch")?.value || "").trim().toLowerCase();
  const roleFilter = document.getElementById("adminUserRoleFilter")?.value || "all";
  const statusFilter = document.getElementById("adminUserStatusFilter")?.value || "all";

  const filtered = adminAllProfiles.filter((p) => {
    const text = `${p.email} ${p.display_name || ""}`.toLowerCase();
    const searchMatch = !keyword || text.includes(keyword);
    const roleMatch = roleFilter === "all" || p.role === roleFilter;
    const statusMatch = statusFilter === "all" ||
      (statusFilter === "active" && p.is_active) ||
      (statusFilter === "disabled" && !p.is_active);
    return searchMatch && roleMatch && statusMatch;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">无匹配用户</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr data-user-id="${p.id}">
      <td>
        <div class="admin-user-cell">
          <div class="avatar avatar-sm">${(p.email || "?")[0].toUpperCase()}</div>
          <div>
            <div class="admin-user-name">${escapeHtml(p.display_name || p.email)}</div>
            <div class="admin-user-email small-muted">${escapeHtml(p.email)}</div>
          </div>
        </div>
      </td>
      <td><span class="role-badge ${roleBadgeClass(p.role)}">${roleLabel(p.role)}</span></td>
      <td>
        <span class="admin-status-dot ${p.is_active ? "active" : "disabled"}"></span>
        ${p.is_active ? "启用" : "禁用"}
      </td>
      <td class="muted">${new Date(p.created_at).toLocaleDateString("zh-CN")}</td>
      <td class="muted">${p.last_login_at ? new Date(p.last_login_at).toLocaleDateString("zh-CN") : "—"}</td>
      <td id="appCount-${p.id}">—</td>
      <td id="intCount-${p.id}">—</td>
      <td>
        <div class="admin-actions">
          <button class="icon-btn" title="查看详情" data-view-user="${p.id}">👁</button>
          ${p.id !== currentUser?.id ? `
            <button class="icon-btn" title="${p.is_active ? '禁用' : '启用'}" data-toggle-active="${p.id}">
              ${p.is_active ? "🚫" : "✅"}
            </button>
            ${adminRole === "super_admin" ? `
              <button class="icon-btn" title="切换角色" data-toggle-role="${p.id}">
                ${p.role === "admin" ? "👤" : "🛡"}
              </button>
            ` : ""}
          ` : '<span class="small-muted">当前用户</span>'}
        </div>
      </td>
    </tr>
  `).join("");

  // 绑定图标按钮事件
  tbody.querySelectorAll("[data-view-user]").forEach(btn => {
    btn.addEventListener("click", () => openUserDrawer(btn.dataset.viewUser));
  });
  tbody.querySelectorAll("[data-toggle-active]").forEach(btn => {
    btn.addEventListener("click", () => handleToggleActive(btn.dataset.toggleActive));
  });
  tbody.querySelectorAll("[data-toggle-role]").forEach(btn => {
    btn.addEventListener("click", () => handleToggleRole(btn.dataset.toggleRole));
  });

  // 异步加载每个用户的申请/面试计数
  filtered.forEach(p => loadUserCounts(p.id));
}

async function loadUserCounts(userId) {
  try {
    const { count: appCount } = await supabase
      .from("applications").select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    const { count: intCount } = await supabase
      .from("interviews").select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const appEl = document.getElementById(`appCount-${userId}`);
    const intEl = document.getElementById(`intCount-${userId}`);
    if (appEl) appEl.textContent = appCount ?? 0;
    if (intEl) intEl.textContent = intCount ?? 0;
  } catch { /* ignore */ }
}

// ============================================================
// 用户详情抽屉
// ============================================================

async function openUserDrawer(userId) {
  const profile = adminAllProfiles.find(p => p.id === userId);
  if (!profile) return;

  document.getElementById("adminDrawerUserName").textContent = profile.email;
  const drawer = document.getElementById("adminUserDrawer");
  drawer.style.display = "flex";
  adminDrawerUserId = userId;

  try {
    const { data: apps } = await supabase
      .from("applications").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    const { data: ints } = await supabase
      .from("interviews").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const content = document.getElementById("adminDrawerContent");
    content.innerHTML = `
      <div class="admin-drawer-section">
        <h4>基本信息</h4>
        <div class="admin-info-grid">
          <div><span class="small-muted">邮箱</span><div>${escapeHtml(profile.email)}</div></div>
          <div><span class="small-muted">昵称</span><div>${escapeHtml(profile.display_name || "—")}</div></div>
          <div><span class="small-muted">角色</span><div><span class="role-badge ${roleBadgeClass(profile.role)}">${roleLabel(profile.role)}</span></div></div>
          <div><span class="small-muted">状态</span><div>${profile.is_active ? "✅ 启用" : "🚫 禁用"}</div></div>
          <div><span class="small-muted">注册时间</span><div>${new Date(profile.created_at).toLocaleString("zh-CN")}</div></div>
        </div>
      </div>
      <div class="admin-drawer-section">
        <h4>申请记录 (${(apps || []).length})</h4>
        ${(apps || []).length ? `<table class="admin-table">
          <thead><tr><th>公司</th><th>职位</th><th>状态</th><th>日期</th></tr></thead>
          <tbody>${apps.map(a => `<tr>
            <td>${escapeHtml(a.company)}</td>
            <td>${escapeHtml(a.role)}</td>
            <td><span style="color:${statusColor(a.status)};font-weight:600;">${escapeHtml(a.status)}</span></td>
            <td>${a.applied_date || "—"}</td>
          </tr>`).join("")}</tbody>
        </table>` : '<div class="admin-empty">暂无申请记录</div>'}
      </div>
      <div class="admin-drawer-section">
        <h4>面试记录 (${(ints || []).length})</h4>
        ${(ints || []).length ? `<table class="admin-table">
          <thead><tr><th>日期</th><th>类型</th><th>形式</th><th>备注</th></tr></thead>
          <tbody>${ints.map(i => `<tr>
            <td>${i.date}</td>
            <td>${escapeHtml(i.type)}</td>
            <td>${escapeHtml(i.format)}</td>
            <td>${escapeHtml(i.notes || "—")}</td>
          </tr>`).join("")}</tbody>
        </table>` : '<div class="admin-empty">暂无面试记录</div>'}
      </div>
    `;
  } catch (err) {
    showToast("加载用户详情失败：" + err.message);
  }
}

function closeUserDrawer() {
  const drawer = document.getElementById("adminUserDrawer");
  if (!drawer) return;
  drawer.style.display = "none";
  adminDrawerUserId = null;
}

// ============================================================
// 数据审查
// ============================================================

async function loadAdminData() {
  try {
    const { data: profiles } = await supabase
      .from("profiles").select("id, email, display_name")
      .order("email");
    const select = document.getElementById("adminDataUserFilter");
    select.innerHTML = `<option value="all">全部用户</option>` +
      (profiles || []).map(p =>
        `<option value="${p.id}">${escapeHtml(p.email)}</option>`
      ).join("");

    const { data: apps, error } = await supabase
      .from("applications").select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    renderAdminDataList(apps || [], profiles || []);
  } catch (err) {
    showToast("加载数据失败：" + err.message);
  }
}

function renderAdminDataList(applications, profiles) {
  const userFilter = document.getElementById("adminDataUserFilter").value;
  const statusFilter = document.getElementById("adminDataStatusFilter").value;
  const keyword = document.getElementById("adminDataSearch").value.trim().toLowerCase();

  const emailMap = {};
  profiles.forEach(p => { emailMap[p.id] = p.email; });

  let filtered = applications.filter(a => {
    const userMatch = userFilter === "all" || a.user_id === userFilter;
    const statusMatch = statusFilter === "all" || a.status === statusFilter;
    const text = `${a.company} ${a.role} ${a.notes || ""}`.toLowerCase();
    const searchMatch = text.includes(keyword);
    return userMatch && statusMatch && searchMatch;
  });

  const container = document.getElementById("adminDataList");
  if (!filtered.length) {
    container.innerHTML = `<div class="admin-empty">暂无数据</div>`;
    return;
  }

  container.innerHTML = filtered.map(a => `
    <div class="admin-data-row">
      <span class="small-muted">${escapeHtml(emailMap[a.user_id] || "未知用户")}</span>
      <strong>${escapeHtml(a.company)}</strong>
      <span>${escapeHtml(a.role)}</span>
      <span class="role-badge ${statusToTag(a.status)}">${a.status}</span>
      <span class="small-muted">${a.applied_date || "—"}</span>
    </div>
  `).join("");
}

function statusToTag(status) {
  if (status === "收到 Offer") return "offer";
  if (status === "已终止") return "rejected";
  if (["准备面试", "面试完成"].includes(status)) return "interview";
  return "default";
}

// ============================================================
// 管理员操作
// ============================================================

async function handleToggleRole(targetUserId) {
  const user = adminAllProfiles.find(p => p.id === targetUserId);
  if (!user) return;
  const newRole = user.role === "admin" ? "user" : "admin";
  if (!confirm(`确定将 ${user.email} 的角色切换为「${roleLabel(newRole)}」吗？`)) return;

  try {
    await callAdminEdgeFunction("toggle-user-role", {
      targetUserId,
      newRole
    });
    showToast("角色已更新");
    loadAdminUsers();
  } catch (err) {
    showToast("操作失败：" + err.message);
  }
}

async function handleToggleActive(targetUserId) {
  const user = adminAllProfiles.find(p => p.id === targetUserId);
  if (!user) return;
  const action = user.is_active ? "禁用" : "启用";
  if (!confirm(`确定${action}用户 ${user.email} 吗？`)) return;

  try {
    await callAdminEdgeFunction("set-user-active", {
      targetUserId,
      isActive: !user.is_active
    });
    showToast(`用户已${action}`);
    loadAdminUsers();
  } catch (err) {
    showToast("操作失败：" + err.message);
  }
}

// 兼容旧名
const toggleUserRoleInAdmin = handleToggleRole;
const toggleUserActiveInAdmin = handleToggleActive;

async function deleteUserDataInAdmin(userId, mode) {
  const label = mode === "account" ? "注销账户并清除所有数据" : "清除所有业务数据（保留账户）";
  if (!confirm(`确认对此用户执行「${label}」？此操作不可撤销！`)) return;
  try {
    await callAdminEdgeFunction("delete-user-data", { targetUserId: userId, mode });
    showToast("操作已完成");
    await loadAdminUsers();
  } catch (err) {
    showToast("操作失败：" + (err?.message || "未知错误"));
  }
}

// ============================================================
// 系统配置（super_admin only）
// ============================================================

async function loadAdminSystem() {
  if (adminRole !== "super_admin") return;

  // 检测 Edge Function 状态
  const functions = ["toggle-user-role", "set-user-active", "get-system-stats"];
  const statusList = document.getElementById("adminEdgeFunctionStatus");
  const results = await Promise.allSettled(
    functions.map(fn => callAdminEdgeFunction(fn, null, "GET").catch(() => { throw new Error(fn); }))
  );
  statusList.innerHTML = functions.map((fn, i) => {
    const ok = results[i].status === "fulfilled";
    return `<div class="admin-status-item">
      <span class="admin-status-dot ${ok ? "active" : "error"}"></span>
      <code>${fn}</code>
      <span>${ok ? "✅ 正常" : "❌ 异常"}</span>
    </div>`;
  }).join("");
}

async function handleResetAllData() {
  if (adminRole !== "super_admin") {
    showToast("仅超级管理员可执行此操作");
    return;
  }
  if (!confirm("⚠️ 此操作将清空所有用户的申请与面试数据，且不可撤销！\n\n确定继续？")) return;
  if (!confirm("⚠️ 最后确认：真的要清空全部数据吗？")) return;

  try {
    showToast("正在清空数据...");
    await callAdminEdgeFunction("delete-user-data", { targetUserId: "all", mode: "data" });
    showToast("数据已清空");
    adminUsersLoaded = false;
    adminAllProfiles = [];
    if (adminCurrentView === "users") loadAdminUsers();
    else if (adminCurrentView === "data") loadAdminData();
    else if (adminCurrentView === "system") loadAdminSystemInfo();
    else if (adminCurrentView === "dashboard") loadAdminDashboard();
  } catch (err) {
    showToast("操作失败：" + (err?.message || "未知错误"));
  }
}

async function handleExportAllData() {
  if (adminRole !== "super_admin") {
    showToast("仅超级管理员可执行此操作");
    return;
  }

  try {
    showToast("正在导出数据...");

    const [appsRes, intsRes, profilesRes] = await Promise.all([
      supabase.from("applications").select("*"),
      supabase.from("interviews").select("*"),
      supabase.from("profiles").select("id, email, display_name, role, is_active, created_at, last_login_at"),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      exportBy: currentUser?.email || "unknown",
      profiles: profilesRes.data || [],
      applications: appsRes.data || [],
      interviews: intsRes.data || [],
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offerflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("导出成功");
  } catch (err) {
    showToast("导出失败：" + (err?.message || "未知错误"));
  }
}

// ============================================================
// 导出到全局（供 app.js 调用）
// ============================================================
window.initAdmin = bindAdminEvents;
window.switchAdminView = switchAdminView;
window.showAdminShell = showAdminShell;
window.hideAdminShell = hideAdminShell;
window.checkAdminAccess = checkAdminAccess;
window.getAdminRole = getAdminRole;
window.showAdminEntryButton = showAdminEntryButton;
window.loadAdminDashboard = loadAdminDashboard;
window.loadAdminUsers = loadAdminUsers;
window.loadAdminData = loadAdminData;
window.loadAdminSystem = loadAdminSystem;
window.openUserDrawer = openUserDrawer;
window.closeUserDrawer = closeUserDrawer;
window.handleToggleRole = handleToggleRole;
window.handleToggleActive = handleToggleActive;
window.adminGetCurrentRole = () => adminRole;
