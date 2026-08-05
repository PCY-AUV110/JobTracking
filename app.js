// ============================================================
// OfferFlow 应用主逻辑（Supabase 云端版本）
// ============================================================

// ---- Supabase 表名常量 ----
const TABLE_APPLICATIONS = "applications";
const TABLE_INTERVIEWS = "interviews";
const TABLE_SETTINGS = "settings";

// ---- 业务常量 ----
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
  settings: ["CLOUD WORKSPACE", "系统设置", "管理云端账户、备份和界面偏好。"]
};

// ---- 新用户首次登录时的演示数据（id 与时间戳在写入时生成）----
const seedApplications = [
  {
    company: "公司 A",
    role: "软件工程师",
    status: "已申请",
    appliedDate: "2026-08-01",
    location: "远程",
    source: "LinkedIn",
    jobUrl: "",
    notes: "Demo 示例：完成 OA 测试后跟进。"
  },
  {
    company: "公司 B",
    role: "数据分析师",
    status: "面试中",
    appliedDate: "2026-08-03",
    location: "上海",
    source: "官网",
    jobUrl: "",
    notes: "Demo 示例：下周二技术面试。"
  },
  {
    company: "公司 C",
    role: "产品经理",
    status: "Offer",
    appliedDate: "2026-07-20",
    location: "北京",
    source: "猎头推荐",
    jobUrl: "",
    notes: "Demo 示例：Offer 已收到，待确认。"
  },
  {
    company: "公司 D",
    role: "市场营销实习生",
    status: "已拒绝",
    appliedDate: "2026-07-15",
    location: "深圳",
    source: "Boss 直聘",
    jobUrl: "",
    notes: "Demo 示例：简历未通过初筛。"
  }
];

// ---- 运行时状态 ----
let applications = [];
let interviews = [];
let settings = {
  compactMode: false,
  defaultActive: true
};
let currentTab = "active";
let calendarCursor = new Date();
let currentUser = null;
let authMode = "login"; // "login" | "signup"

// ---- 新用户引导 ----
const ONBOARDING_STEPS = [
  {
    title: "欢迎使用 OfferFlow",
    text: "这是你的求职管理中心。我们已准备了 4 条示例数据（Demo），帮助你快速上手。",
    highlight: "sidebar",
    posClass: "tip-pos-sidebar",
    arrowDir: "right"
  },
  {
    title: "添加新申请",
    text: "点击右上角「＋ 添加申请」，记录你投递的每一个岗位，包括公司、职位、状态等。",
    highlight: "addBtn",
    posClass: "tip-pos-add",
    arrowDir: "bottom"
  },
  {
    title: "搜索与筛选",
    text: "在搜索框中输入关键词，或用状态筛选快速定位特定阶段的申请。",
    highlight: "searchBox",
    posClass: "tip-pos-search",
    arrowDir: "bottom"
  },
  {
    title: "侧边栏导航",
    text: "左侧栏切换申请看板、面试日程、数据统计和系统设置。数据自动同步到云端。",
    highlight: "navItems",
    posClass: "tip-pos-nav",
    arrowDir: "right"
  }
];
let onboardingIndex = 0;
const ONBOARDING_SEEN_KEY = "offerflow:onboarding_seen";

// ============================================================
// Supabase 数据访问层
// 数据库列名为 snake_case，前端对象为 camelCase，下面做映射
// ============================================================

function rowToApplication(row) {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    status: row.status,
    appliedDate: row.applied_date,
    location: row.location,
    source: row.source,
    jobUrl: row.job_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function applicationToRow(app) {
  return {
    id: app.id,
    company: app.company,
    role: app.role,
    status: app.status,
    applied_date: app.appliedDate,
    location: app.location,
    source: app.source,
    job_url: app.jobUrl,
    notes: app.notes,
    created_at: app.createdAt,
    updated_at: app.updatedAt
  };
}

function rowToInterview(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    date: row.date,
    time: row.time,
    type: row.type,
    format: row.format,
    link: row.link,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function interviewToRow(interview) {
  return {
    id: interview.id,
    application_id: interview.applicationId,
    date: interview.date,
    time: interview.time,
    type: interview.type,
    format: interview.format,
    link: interview.link,
    notes: interview.notes,
    created_at: interview.createdAt,
    updated_at: interview.updatedAt
  };
}

// 通用：通过 id 字段筛选删除（受 RLS 限制，只会删除当前用户的数据）
async function dbGetAll(table, mapper) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw error;
  return (data || []).map(mapper);
}

async function dbUpsert(table, row) {
  const { error } = await supabase.from(table).upsert(row);
  if (error) throw error;
}

async function dbDeleteById(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

// 清空当前用户在某张表的所有数据
// 由于 RLS 限制只会影响当前用户的行；用 neq 配合占位 UUID 命中所有现有行
const NEVER_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

async function dbClearApplications() {
  const { error } = await supabase
    .from(TABLE_APPLICATIONS)
    .delete()
    .neq("id", NEVER_MATCH_UUID);
  if (error) throw error;
}

async function dbClearInterviews() {
  const { error } = await supabase
    .from(TABLE_INTERVIEWS)
    .delete()
    .neq("id", NEVER_MATCH_UUID);
  if (error) throw error;
}

async function dbClearSettings() {
  const { error } = await supabase
    .from(TABLE_SETTINGS)
    .delete()
    .neq("key", "__never_match__");
  if (error) throw error;
}

async function dbGetSettings() {
  const { data, error } = await supabase.from(TABLE_SETTINGS).select("*");
  if (error) throw error;
  const result = {};
  (data || []).forEach(item => {
    result[item.key] = item.value;
  });
  return result;
}

async function dbSaveSetting(key, value) {
  const { error } = await supabase
    .from(TABLE_SETTINGS)
    .upsert({ key, value });
  if (error) throw error;
}

// ============================================================
// 认证相关
// ============================================================

function showConfigScreen() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("configScreen").style.display = "flex";
  document.getElementById("appShell").style.display = "none";
}

function showAuthScreen() {
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("configScreen").style.display = "none";
  document.getElementById("appShell").style.display = "none";
}

function showAppShell() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("configScreen").style.display = "none";
  document.getElementById("appShell").style.display = "grid";
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.authTab === mode);
  });
  // 切换按钮文案与密码占位符
  const submitBtn = document.getElementById("authSubmitBtn");
  const btnText = submitBtn.querySelector(".btn-text");
  btnText.textContent = mode === "login" ? "登录" : "注册";
  document.getElementById("authPasswordInput").placeholder =
    mode === "signup" ? "建议 8 位以上，含字母与数字" : "请输入密码";
  document.getElementById("authError").textContent = "";
  document.getElementById("authSuccess").textContent = "";
  // 切换密码强度条显示
  document.getElementById("passwordStrength").classList.toggle("visible", mode === "signup");
  updatePasswordStrength(document.getElementById("authPasswordInput").value);
}

function updateAuthUI() {
  const emailEl = document.getElementById("authUserEmail");
  const avatarEl = document.getElementById("userAvatar");
  const menuAvatarEl = document.getElementById("userMenuAvatar");
  const menuEmailEl = document.getElementById("userMenuEmail");

  if (currentUser?.email) {
    emailEl.textContent = currentUser.email;
    const initial = currentUser.email.charAt(0).toUpperCase();
    avatarEl.textContent = initial;
    menuAvatarEl.textContent = initial;
    menuEmailEl.textContent = currentUser.email;
  } else {
    emailEl.textContent = "未登录";
    avatarEl.textContent = "U";
    menuAvatarEl.textContent = "U";
    menuEmailEl.textContent = "未登录";
  }
}

// 密码强度评估：返回 0-4 的等级
function evalPasswordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

function updatePasswordStrength(password) {
  const container = document.getElementById("passwordStrength");
  const fill = container.querySelector(".strength-fill");
  const text = container.querySelector(".strength-text");
  const score = evalPasswordStrength(password);
  const levels = ["", "弱", "一般", "良好", "强"];
  const colors = ["", "#B44E4E", "#B7791F", "#58789A", "#4F806B"];
  fill.style.width = `${(score / 4) * 100}%`;
  fill.style.background = colors[score];
  text.textContent = levels[score] || "";
  text.style.color = colors[score] || "var(--claude-muted)";
}

// 切换密码可见性
function togglePasswordVisibility(event) {
  // 阻止冒泡与默认行为，避免触发外层 <label> 的 input 聚焦
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const input = document.getElementById("authPasswordInput");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  document.getElementById("passwordToggleBtn").classList.toggle("active", isPassword);
  // 重新聚焦到输入框末尾
  input.focus();
  const len = input.value.length;
  input.setSelectionRange(len, len);
}

// 记住邮箱功能（仅本地存储邮箱，不存储密码）
const REMEMBER_EMAIL_KEY = "jobtrack:remembered_email";

function loadRememberedEmail() {
  const email = localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  if (email) {
    document.getElementById("authEmailInput").value = email;
    document.getElementById("rememberEmail").checked = true;
  }
}

function saveRememberedEmail(email, remember) {
  if (remember) {
    localStorage.setItem(REMEMBER_EMAIL_KEY, email);
  } else {
    localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }
}

// 第三方 OAuth 登录（Google / GitHub）
async function handleOAuthSignIn(provider) {
  const errorEl = document.getElementById("authError");
  const successEl = document.getElementById("authSuccess");
  errorEl.textContent = "";
  successEl.textContent = `正在跳转到 ${provider === "google" ? "Google" : "GitHub"} 完成授权…`;

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
    // 成功时浏览器会跳转，无需在前端处理
  } catch (err) {
    successEl.textContent = "";
    errorEl.textContent = friendlyAuthError(err);
  }
}

// 忘记密码：发送重置邮件
async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById("forgotEmailInput").value.trim();
  const successEl = document.getElementById("forgotSuccess");
  const errorEl = document.getElementById("forgotError");
  successEl.textContent = "";
  errorEl.textContent = "";

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
    successEl.textContent = "重置邮件已发送，请查收邮箱并按提示重置密码。";
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err);
  }
}

// 设置按钮加载状态（spinner）
function setSubmitLoading(loading) {
  const submitBtn = document.getElementById("authSubmitBtn");
  submitBtn.disabled = loading;
  submitBtn.classList.toggle("loading", loading);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("authEmailInput").value.trim();
  const password = document.getElementById("authPasswordInput").value;
  const errorEl = document.getElementById("authError");
  const successEl = document.getElementById("authSuccess");
  const remember = document.getElementById("rememberEmail").checked;

  // 前端基础校验
  errorEl.textContent = "";
  successEl.textContent = "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = "邮箱格式不正确。";
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = "密码至少需要 6 位。";
    return;
  }

  setSubmitLoading(true);

  try {
    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // 部分项目会要求邮箱验证后才创建会话
      if (data.user && !data.session) {
        successEl.textContent = "注册成功，请前往邮箱点击确认链接后再登录。";
        saveRememberedEmail(email, true);
        document.getElementById("rememberEmail").checked = true;
        setAuthMode("login");
      }
      // 如果直接拿到 session，onAuthStateChange 会接管 UI 切换
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      saveRememberedEmail(email, remember);
      // onAuthStateChange 会接管 UI 切换
    }
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err);
  } finally {
    setSubmitLoading(false);
  }
}

// 把 Supabase 报错翻译成更友好的中文提示
function friendlyAuthError(err) {
  const message = err?.message || "操作失败，请稍后重试。";
  if (/Invalid login credentials/i.test(message)) return "邮箱或密码错误。";
  if (/User already registered/i.test(message)) return "该邮箱已注册，请直接登录。";
  if (/Password should be at least/i.test(message)) return "密码至少需要 6 位。";
  if (/Email not confirmed/i.test(message)) return "邮箱尚未验证，请先查收验证邮件。";
  if (/email rate limit exceeded/i.test(message)) return "邮件发送过于频繁，请稍后再试或更换邮箱。";
  if (/over_email_send_rate_limit/i.test(message)) return "邮件发送过于频繁，请稍后再试。";
  if (/invalid email/i.test(message)) return "邮箱格式不正确。";
  if (/Email rate limit exceeded/i.test(message)) return "邮箱发送已达上限，请稍后再试。";
  if (/provider is not enabled/i.test(message)) return "该第三方登录未启用，请联系管理员或在 Supabase 中开启。";
  if (/Invalid API key/i.test(message)) return "Supabase 配置错误，请检查 anon key。";
  return message;
}

async function handleLogout() {
  if (!confirm("确定退出登录吗？退出后需要重新登录才能查看数据。")) return;
  try {
    await supabase.auth.signOut();
  } catch (err) {
    showToast("退出失败：" + (err?.message || "未知错误"));
  }
}

// 修改密码
async function handleChangePassword(e) {
  e.preventDefault();
  const newPwd = document.getElementById("newPasswordInput").value;
  const confirmPwd = document.getElementById("confirmPasswordInput").value;
  const errEl = document.getElementById("changePwdError");
  const sucEl = document.getElementById("changePwdSuccess");
  errEl.textContent = "";
  sucEl.classList.remove("show");

  if (newPwd !== confirmPwd) {
    errEl.textContent = "两次输入的密码不一致";
    return;
  }
  if (newPwd.length < 6) {
    errEl.textContent = "密码至少 6 位";
    return;
  }

  try {
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) throw error;
    sucEl.textContent = "密码修改成功！";
    sucEl.classList.add("show");
    document.getElementById("newPasswordInput").value = "";
    document.getElementById("confirmPasswordInput").value = "";
    setTimeout(() => {
      closeModal("changePasswordModal");
      sucEl.classList.remove("show");
    }, 1500);
  } catch (err) {
    errEl.textContent = err?.message || "修改失败";
  }
}

// 导出数据为 JSON
async function exportData() {
  try {
    const { data: { applications }, error: err1 } = await supabase
      .from("applications")
      .select("*");
    if (err1) throw err1;
    const { data: { interviews }, error: err2 } = await supabase
      .from("interviews")
      .select("*");
    if (err2) throw err2;

    const payload = {
      app: "OfferFlow",
      exportedAt: new Date().toISOString(),
      applications: applications || [],
      interviews: interviews || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offerflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("数据已导出");
  } catch (err) {
    showToast("导出失败：" + (err?.message || "未知错误"));
  }
}

// 注销账户
async function handleDeleteAccount() {
  if (!confirm("⚠️ 注销账户将永久删除你的所有数据（申请记录、面试、设置），此操作不可恢复！")) return;
  const email = prompt("请输入你的邮箱地址以确认注销：");
  if (!email) return;
  if (email.trim() !== (currentUser?.email || "")) {
    alert("邮箱不匹配，注销已取消。");
    return;
  }

  try {
    // 先删除用户数据
    await supabase.from("applications").delete().eq("user_id", currentUser.id);
    await supabase.from("interviews").delete().eq("user_id", currentUser.id);
    await supabase.from("settings").delete().eq("user_id", currentUser.id);
    // 再删除 auth 用户（需通过管理员 API，这里先清除本地会话）
    // 注意：完整删除需要 Edge Function + service_role key
    await supabase.auth.signOut();
    showToast("账户已注销");
  } catch (err) {
    showToast("注销失败：" + (err?.message || "未知错误"));
  }
}

// 认证状态变化时的统一入口
async function onAuthStateChanged(event, session) {
  // SIGNED_OUT 可能是用户主动退出，也可能是 token 过期 / 被服务端吊销
  if (event === "SIGNED_OUT" && currentUser) {
    showToast("登录状态已失效，请重新登录。");
  }

  if (session?.user) {
    currentUser = session.user;
    updateAuthUI();
    showAppShell();

    try {
      await seedIfNeeded();
      await loadState();
      renderStatusOptions();
      renderAll();
      // 首次登录且未看过引导时展示 onboarding
      if (!isOnboardingSeen()) {
        setTimeout(startOnboarding, 400);
      }
    } catch (err) {
      console.error(err);
      showToast("加载数据失败：" + (err?.message || "未知错误"));
    }
  } else {
    // 已登出
    currentUser = null;
    applications = [];
    interviews = [];
    settings = { compactMode: false, defaultActive: true };
    updateAuthUI();
    showAuthScreen();
  }
}

// ============================================================
// 状态加载 / 种子数据
// ============================================================

async function seedIfNeeded() {
  const existing = await dbGetAll(TABLE_APPLICATIONS, rowToApplication);
  if (!existing.length) {
    for (const seed of seedApplications) {
      const now = Date.now();
      const record = {
        ...seed,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now
      };
      await dbUpsert(TABLE_APPLICATIONS, applicationToRow(record));
      applications.push(record);
    }
  } else {
    applications = existing;
  }
}

async function loadState() {
  applications = await dbGetAll(TABLE_APPLICATIONS, rowToApplication);
  interviews = await dbGetAll(TABLE_INTERVIEWS, rowToInterview);

  const storedSettings = await dbGetSettings();
  settings = {
    compactMode: false,
    defaultActive: true,
    ...storedSettings
  };

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
  await dbSaveSetting(key, value);
}

// ============================================================
// 渲染相关（与原版基本一致）
// ============================================================

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
  const clearBtn = document.getElementById("searchClearBtn");
  const countEl = document.getElementById("searchResultCount");

  // 清除按钮可见性
  clearBtn.style.display = keyword ? "flex" : "none";

  let filtered = applications.filter(item => {
    const tabMatch = currentTab === "all" || statusGroup(item.status) === currentTab;
    const text = `${item.company} ${item.role} ${item.notes || ""} ${item.location || ""}`.toLowerCase();
    const searchMatch = text.includes(keyword);
    const statusMatch = statusFilter === "全部" || item.status === statusFilter;
    return tabMatch && searchMatch && statusMatch;
  });

  // 搜索结果计数
  if (keyword || statusFilter !== "全部") {
    countEl.textContent = `找到 ${filtered.length} 条结果`;
  } else {
    countEl.textContent = "";
  }

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

// ============================================================
// AI 智能识别模块
// 调用 Supabase Edge Functions：parse-screenshot / parse-text
// ============================================================

// 边缘函数根地址（在 supabase-config.js 中定义的 SUPABASE_URL 全局可用）
function getFunctionsBase() {
  return `${SUPABASE_URL}/functions/v1`;
}

// 当前选中的图片（base64 + mime），供解析按钮使用
let aiSelectedImage = null;

// 重置 AI 面板到初始状态
function resetAIPanel() {
  aiSelectedImage = null;
  const fileInput = document.getElementById("aiFileInput");
  if (fileInput) fileInput.value = "";
  const previewImg = document.getElementById("aiPreviewImg");
  if (previewImg) previewImg.hidden = true;
  const dropzone = document.getElementById("aiDropzone");
  if (dropzone) dropzone.classList.remove("has-preview", "dragover");
  const emailText = document.getElementById("aiEmailText");
  if (emailText) emailText.value = "";
  setAIParseBtnState();
  setAILoading(false);
  showAIMessage(null);
  // 默认折叠面板（每次打开模态框都收起，避免干扰手动填写）
  const panel = document.getElementById("aiPanel");
  if (panel) panel.classList.add("collapsed");
}

// 切换 AI 面板展开/折叠
function toggleAIPanel() {
  document.getElementById("aiPanel").classList.toggle("collapsed");
}

// 切换截图/邮件 Tab
function switchAITab(tabName) {
  document.querySelectorAll(".ai-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.aiTab === tabName);
  });
  document.querySelectorAll(".ai-tab-pane").forEach(pane => {
    pane.classList.toggle("active", pane.dataset.aiPane === tabName);
  });
}

// 处理文件选择（来自 input 或拖拽）
async function handleAIFileSelect(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showAIMessage("error", "请选择图片文件（PNG / JPG / WEBP）。");
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showAIMessage("error", "图片过大（超过 4MB），请选择更小的图片。");
    return;
  }
  try {
    // 压缩图片：长边限制 1280，JPEG 质量 0.8
    // 降低传输体积与 OpenAI tokens 消耗
    const { base64, mime } = await compressImage(file, 1280, 0.8);
    aiSelectedImage = { base64, mime };
    // 显示预览
    const previewImg = document.getElementById("aiPreviewImg");
    previewImg.src = `data:${mime};base64,${base64}`;
    previewImg.hidden = false;
    document.getElementById("aiDropzone").classList.add("has-preview");
    showAIMessage(null);
    setAIParseBtnState();
  } catch (err) {
    showAIMessage("error", "图片读取失败：" + (err.message || err));
  }
}

// 图片压缩：通过 canvas 缩放并转 base64
// 返回 { base64, mime }
function compressImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxEdge) {
          height = Math.round((height * maxEdge) / width);
          width = maxEdge;
        } else if (height > maxEdge) {
          width = Math.round((width * maxEdge) / height);
          height = maxEdge;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        // PNG 透明通道会被合并到白底，避免 OpenAI 解析异常
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1];
        resolve({ base64, mime: "image/jpeg" });
      };
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

// 根据当前输入状态启用/禁用解析按钮
function setAIParseBtnState() {
  const screenshotBtn = document.getElementById("aiParseScreenshotBtn");
  const emailBtn = document.getElementById("aiParseEmailBtn");
  screenshotBtn.disabled = !aiSelectedImage;
  const emailText = document.getElementById("aiEmailText").value.trim();
  emailBtn.disabled = emailText.length === 0;
}

// 设置加载状态
function setAILoading(loading) {
  const loadingEl = document.getElementById("aiLoading");
  loadingEl.hidden = !loading;
  // 禁用解析按钮，防止重复点击
  document.getElementById("aiParseScreenshotBtn").classList.toggle("loading", loading);
  document.getElementById("aiParseEmailBtn").classList.toggle("loading", loading);
}

// 显示 AI 提示信息（type: null | "error" | "success"）
function showAIMessage(type, text) {
  const msgEl = document.getElementById("aiMessage");
  if (!type) {
    msgEl.hidden = true;
    msgEl.textContent = "";
    msgEl.className = "ai-message";
    return;
  }
  msgEl.hidden = false;
  msgEl.textContent = text;
  msgEl.className = `ai-message ${type}`;
}

// 调用 parse-screenshot 边缘函数
async function parseScreenshot() {
  if (!aiSelectedImage) return;
  await callAIFunction("parse-screenshot", {
    image: aiSelectedImage.base64,
    mime: aiSelectedImage.mime
  });
}

// 调用 parse-text 边缘函数
async function parseEmail() {
  const text = document.getElementById("aiEmailText").value.trim();
  if (!text) return;
  await callAIFunction("parse-text", { text });
}

// 通用调用：请求边缘函数并填充表单
async function callAIFunction(name, body) {
  setAILoading(true);
  showAIMessage(null);
  try {
    const res = await fetch(`${getFunctionsBase()}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Supabase 边缘函数需要 anon key 鉴权
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `请求失败（${res.status}）`);
    }
    applyAIResult(data);
    const filledCount = countFilledFields(data);
    showAIMessage("success", `已识别 ${filledCount} 个字段，请核对后保存。`);
  } catch (err) {
    showAIMessage("error", friendlyAIError(err));
  } finally {
    setAILoading(false);
  }
}

// 将 AI 返回的字段填充到表单
function applyAIResult(result) {
  const mapping = {
    company: "companyInput",
    role: "roleInput",
    location: "locationInput",
    source: "sourceInput",
    jobUrl: "jobUrlInput",
    notes: "notesInput",
    status: "statusInput"
  };
  Object.entries(mapping).forEach(([key, elId]) => {
    const value = result[key];
    if (value && typeof value === "string" && value.trim()) {
      const el = document.getElementById(elId);
      // 仅在字段为空时覆盖，避免覆盖用户已编辑的内容
      if (el && !el.value.trim()) {
        el.value = value.trim();
      } else if (el) {
        // 已有值时，对 notes 采用追加策略
        if (key === "notes" && el.value && !el.value.includes(value.trim())) {
          el.value = el.value + "\n" + value.trim();
        }
      }
    }
  });
  // 如果未设置申请日期，默认填今天
  const dateInput = document.getElementById("appliedDateInput");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

// 统计 AI 识别到多少个有效字段
function countFilledFields(result) {
  const keys = ["company", "role", "location", "source", "jobUrl", "notes", "status"];
  return keys.filter(k => result[k] && String(result[k]).trim()).length;
}

// 友好化 AI 错误提示
function friendlyAIError(err) {
  const msg = err.message || String(err);
  if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
    return "网络连接失败，请检查网络或稍后再试。";
  }
  if (/401|403|apikey|Unauthorized/i.test(msg)) {
    return "鉴权失败，请确认 Supabase 配置正确。";
  }
  if (/OPENAI_API_KEY/i.test(msg)) {
    return "服务端未配置 OpenAI API Key，请联系管理员或在 Supabase Secrets 中设置。";
  }
  return msg;
}

// 绑定 AI 面板的所有事件
function initAIPanel() {
  // 折叠头点击
  document.getElementById("aiPanelHead").addEventListener("click", toggleAIPanel);

  // Tab 切换
  document.querySelectorAll(".ai-tab").forEach(tab => {
    tab.addEventListener("click", () => switchAITab(tab.dataset.aiTab));
  });

  // 拖拽上传区
  const dropzone = document.getElementById("aiDropzone");
  const fileInput = document.getElementById("aiFileInput");

  // 点击/键盘触发文件选择
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) {
      handleAIFileSelect(e.target.files[0]);
    }
  });

  // 拖拽事件
  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", e => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleAIFileSelect(e.dataTransfer.files[0]);
    }
  });

  // 邮件文本框输入时启用/禁用按钮
  document.getElementById("aiEmailText").addEventListener("input", setAIParseBtnState);

  // 解析按钮
  document.getElementById("aiParseScreenshotBtn").addEventListener("click", parseScreenshot);
  document.getElementById("aiParseEmailBtn").addEventListener("click", parseEmail);
}

function resetApplicationForm() {
  document.getElementById("applicationForm").reset();
  document.getElementById("applicationId").value = "";
  document.getElementById("applicationModalTitle").textContent = "添加职位申请";
  document.getElementById("appliedDateInput").value = new Date().toISOString().slice(0, 10);
  document.getElementById("statusInput").value = "准备申请";
  resetAIPanel();
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
  resetAIPanel();
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
    app: "OfferFlow",
    version: 2,
    exportedAt: new Date().toISOString(),
    user: currentUser?.email || null,
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

  await dbClearApplications();
  await dbClearInterviews();
  await dbClearSettings();

  for (const item of payload.applications) {
    await dbUpsert(TABLE_APPLICATIONS, applicationToRow({
      id: item.id || crypto.randomUUID(),
      company: item.company,
      role: item.role,
      status: item.status,
      appliedDate: item.appliedDate,
      location: item.location,
      source: item.source,
      jobUrl: item.jobUrl,
      notes: item.notes,
      createdAt: item.createdAt || Date.now(),
      updatedAt: item.updatedAt || Date.now()
    }));
  }

  for (const item of payload.interviews) {
    await dbUpsert(TABLE_INTERVIEWS, interviewToRow({
      id: item.id || crypto.randomUUID(),
      applicationId: item.applicationId,
      date: item.date,
      time: item.time,
      type: item.type,
      format: item.format,
      link: item.link,
      notes: item.notes,
      createdAt: item.createdAt || Date.now(),
      updatedAt: item.updatedAt || Date.now()
    }));
  }

  const importedSettings = payload.settings || {};
  for (const [key, value] of Object.entries(importedSettings)) {
    await dbSaveSetting(key, value);
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

// 用一个标志位防止 bindEvents 重复绑定
let eventsBound = false;

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  // ---- AI 智能识别面板 ----
  initAIPanel();

  // ---- 认证相关 ----
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.authTab));
  });

  document.getElementById("authForm").addEventListener("submit", handleAuthSubmit);

  // 密码可见性切换
  document.getElementById("passwordToggleBtn").addEventListener("click", togglePasswordVisibility);

  // 密码强度实时更新
  document.getElementById("authPasswordInput").addEventListener("input", event => {
    updatePasswordStrength(event.target.value);
  });

  // OAuth 登录按钮
  document.getElementById("googleSignInBtn").addEventListener("click", () => handleOAuthSignIn("google"));
  document.getElementById("githubSignInBtn").addEventListener("click", () => handleOAuthSignIn("github"));

  // 忘记密码
  document.getElementById("forgotPasswordBtn").addEventListener("click", () => {
    document.getElementById("forgotSuccess").textContent = "";
    document.getElementById("forgotError").textContent = "";
    // 自动填充当前邮箱
    const currentEmail = document.getElementById("authEmailInput").value.trim();
    if (currentEmail) document.getElementById("forgotEmailInput").value = currentEmail;
    openModal("forgotPasswordModal");
  });
  document.getElementById("forgotPasswordForm").addEventListener("submit", handleForgotPassword);

  // ---- 用户卡 ----
  const userCardMenuBtn = document.getElementById("userCardMenuBtn");
  const userMenu = document.getElementById("userMenu");
  if (userCardMenuBtn) {
    userCardMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      userMenu.style.display = userMenu.style.display === "block" ? "none" : "block";
    });
  }
  document.addEventListener("click", (e) => {
    if (!userMenu.contains(e.target) && !e.target.closest("#userCardMenuBtn")) {
      userMenu.style.display = "none";
    }
  });
  document.getElementById("logoutMenuItem").addEventListener("click", () => {
    userMenu.style.display = "none";
    handleLogout();
  });
  document.getElementById("changePasswordBtn").addEventListener("click", () => {
    userMenu.style.display = "none";
    openModal("changePasswordModal");
  });
  document.getElementById("deleteAccountBtn").addEventListener("click", handleDeleteAccount);
  document.getElementById("exportDataMenuItem").addEventListener("click", () => {
    userMenu.style.display = "none";
    exportData();
  });
  document.getElementById("changePasswordForm").addEventListener("submit", handleChangePassword);

  // ---- 主应用导航 ----
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

    try {
      await dbUpsert(TABLE_APPLICATIONS, applicationToRow(record));
      await loadState();
      renderAll();
      closeModal("applicationModal");
      showToast(old ? "申请已更新" : "申请已添加");
    } catch (err) {
      showToast("保存失败：" + (err?.message || "未知错误"));
    }
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

    try {
      await dbUpsert(TABLE_INTERVIEWS, interviewToRow(record));
      await loadState();
      renderAll();
      closeModal("interviewModal");
      showToast(old ? "面试已更新" : "面试已添加");
    } catch (err) {
      showToast("保存失败：" + (err?.message || "未知错误"));
    }
  });

  document.getElementById("applicationList").addEventListener("change", async event => {
    const id = event.target.dataset.statusId;
    if (!id) return;
    const item = applications.find(app => app.id === id);
    if (!item) return;
    item.status = event.target.value;
    item.updatedAt = Date.now();
    try {
      await dbUpsert(TABLE_APPLICATIONS, applicationToRow(item));
      await loadState();
      renderAll();
      showToast("状态已更新");
    } catch (err) {
      showToast("更新失败：" + (err?.message || "未知错误"));
    }
  });

  document.getElementById("applicationList").addEventListener("click", async event => {
    const editId = event.target.dataset.editApp;
    const deleteId = event.target.dataset.deleteApp;
    const url = event.target.dataset.openUrl;

    if (url) window.open(url, "_blank", "noopener");
    if (editId) editApplication(editId);

    if (deleteId && confirm("确定删除这条申请记录吗？")) {
      try {
        await dbDeleteById(TABLE_APPLICATIONS, deleteId);
        // 关联面试由数据库外键 ON DELETE CASCADE 自动清理，但前端仍需重新加载
        await loadState();
        renderAll();
        showToast("申请已删除");
      } catch (err) {
        showToast("删除失败：" + (err?.message || "未知错误"));
      }
    }
  });

  document.getElementById("upcomingInterviews").addEventListener("click", async event => {
    const editId = event.target.dataset.editInterview;
    const deleteId = event.target.dataset.deleteInterview;
    if (editId) editInterview(editId);

    if (deleteId && confirm("确定删除这条面试记录吗？")) {
      try {
        await dbDeleteById(TABLE_INTERVIEWS, deleteId);
        await loadState();
        renderAll();
        showToast("面试已删除");
      } catch (err) {
        showToast("删除失败：" + (err?.message || "未知错误"));
      }
    }
  });

  // 搜索框（带防抖）
  let searchTimer = null;
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderApplications, 150);
  });
  document.getElementById("searchClearBtn").addEventListener("click", () => {
    searchInput.value = "";
    renderApplications();
    searchInput.focus();
  });
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
    try {
      await saveSetting("compactMode", event.target.checked);
    } catch (err) {
      showToast("设置保存失败");
    }
  });

  document.getElementById("defaultActiveToggle").addEventListener("change", async event => {
    try {
      await saveSetting("defaultActive", event.target.checked);
    } catch (err) {
      showToast("设置保存失败");
    }
  });

  document.getElementById("resetDataBtn").addEventListener("click", async () => {
    if (!confirm("确定清空当前账户下所有数据吗？此操作不可撤销。")) return;

    try {
      await dbClearApplications();
      await dbClearInterviews();
      await dbClearSettings();
      await seedIfNeeded();
      await loadState();
      renderAll();
      showToast("数据已重置");
    } catch (err) {
      showToast("重置失败：" + (err?.message || "未知错误"));
    }
  });

  // ---- 新用户引导 ----
  document.getElementById("onboardingNextBtn").addEventListener("click", nextOnboardingStep);
  document.getElementById("onboardingSkipBtn").addEventListener("click", dismissOnboarding);
}

// ============================================================
// 新用户引导 Onboarding
// ============================================================

function startOnboarding() {
  const overlay = document.getElementById("onboardingOverlay");
  overlay.style.display = "block";
  onboardingIndex = 0;
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboardingIndex];
  const total = ONBOARDING_STEPS.length;

  // 更新高亮区域
  const backdrop = document.querySelector(".onboarding-backdrop");
  backdrop.setAttribute("data-highlight", step.highlight);

  // 更新提示卡片
  const tip = document.getElementById("onboardingTip");
  tip.className = "onboarding-tip " + step.posClass;

  document.getElementById("onboardingBadge").textContent = `${onboardingIndex + 1} / ${total}`;
  document.getElementById("onboardingTitle").textContent = step.title;
  document.getElementById("onboardingText").textContent = step.text;

  // 更新箭头方向
  const arrow = document.getElementById("onboardingArrow");
  arrow.className = "tip-arrow " + step.arrowDir;

  // 更新按钮文案
  const nextBtn = document.getElementById("onboardingNextBtn");
  nextBtn.textContent = onboardingIndex === total - 1 ? "开始使用" : "下一步";
}

function nextOnboardingStep() {
  if (onboardingIndex < ONBOARDING_STEPS.length - 1) {
    onboardingIndex++;
    renderOnboardingStep();
  } else {
    dismissOnboarding();
  }
}

function dismissOnboarding() {
  document.getElementById("onboardingOverlay").style.display = "none";
  try {
    const seen = JSON.parse(localStorage.getItem(ONBOARDING_SEEN_KEY) || "{}");
    seen[currentUser?.id || "anonymous"] = true;
    localStorage.setItem(ONBOARDING_SEEN_KEY, JSON.stringify(seen));
  } catch (e) { /* ignore */ }
}

function isOnboardingSeen() {
  try {
    const seen = JSON.parse(localStorage.getItem(ONBOARDING_SEEN_KEY) || "{}");
    return !!seen[currentUser?.id || "anonymous"];
  } catch (e) { return false; }
}

// ============================================================
// 入口
// ============================================================

async function init() {
  // 1. 校验 Supabase 配置
  if (!SUPABASE_CONFIGURED || !supabase) {
    showConfigScreen();
    return;
  }

  // 2. 绑定所有事件（包括认证表单、主应用导航等，用 eventsBound 防止重复绑定）
  bindEvents();

  // 3. 订阅认证状态变化
  supabase.auth.onAuthStateChange((event, session) => {
    onAuthStateChanged(event, session);
  });

  // 4. 检查现有会话
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      // 已有会话，触发登录后的 UI 加载
      await onAuthStateChanged("INITIAL_SESSION", data.session);
    } else {
      showAuthScreen();
      // 恢复记住的邮箱
      loadRememberedEmail();
      // 初始化密码强度显示
      setAuthMode("login");
    }
  } catch (err) {
    console.error(err);
    showAuthScreen();
  }

  // 5. 注册 Service Worker（仅用于静态资源缓存）
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").then(reg => {
      // 检测到新版本时自动提示刷新
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            showToast("检测到新版本，刷新页面即可使用最新版本。");
          }
        });
      });
    }).catch(() => {});

    // 如果 SW 控制的页面被强制刷新，说明有新版本
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

init();
