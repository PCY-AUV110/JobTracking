// ============================================================
// resumes.js — 简历中心模块
// 职责：PDF 上传 → 客户端提取文本 → 结构化结果编辑 → 多简历版本管理
// 依赖：全局 escapeHtml、showToast、formatTimestamp、currentUser、dbGetAll（来自 app.js）
//
// Day4：resumes 表 + parse-resume 已上线，RESUME_BACKEND_READY=true。
// ⚠️ 已知缺口（不在本次范围，先如实记录，不假装做了）：
// 1. resumes 表没有 is_default 列，"默认简历"目前只在本地 localStorage 记一个
//    id（RESUME_DEFAULT_ID_KEY），不是服务端字段，换设备/清缓存会丢默认标记。
// 2. 契约里没有"更新已解析简历结构化字段"的接口（parse-resume 只能整段重新解析），
//    所以后端就绪后编辑入口先隐藏，不假装保存能生效——真编辑要等 Codex 出接口。
// ============================================================

const RESUME_BACKEND_READY = true;
const RESUME_MOCK_STORAGE_KEY = "offerflow_mock_resumes_v1";
const RESUME_DEFAULT_ID_KEY = "offerflow_default_resume_id";

const RESUME_SECTION_KEYWORDS = {
  skills: ["技能", "专业技能", "技能特长", "skills", "technical skills"],
  education: ["教育背景", "教育经历", "education"],
  experience: ["工作经历", "项目经历", "实习经历", "工作经验", "experience", "work experience"]
};

// ---- 运行时状态 ----
let resumeVersions = [];
let resumeSelectedFile = null;
let resumeDraft = null; // 当前正在编辑/待保存的结构化结果草稿
let resumeEditingId = null; // 若为重新编辑已保存的简历，记录其 id
let pdfjsModulePromise = null;

// ============================================================
// pdf.js 动态加载（vendor/ 本地文件，不走 CDN）
// ============================================================
function loadPdfJs(forceReload = false) {
  if (forceReload) pdfjsModulePromise = null;
  if (!pdfjsModulePromise) {
    // Resolve from the current document URL so GitHub Pages' /JobTracking/
    // base path is preserved. A root-relative worker URL would 404 in production.
    // forceReload adds a cache-busting query param: if a stale service-worker
    // or browser cache served a broken/partial copy of these files (the class of
    // bug we can't repro locally but a live user hit), this guarantees a fresh fetch.
    const cacheBust = forceReload ? `?v=${Date.now()}` : "";
    const pdfModuleUrl = new URL(`vendor/pdfjs/pdf.min.mjs${cacheBust}`, document.baseURI).href;
    const pdfWorkerUrl = new URL(`vendor/pdfjs/pdf.worker.min.mjs${cacheBust}`, document.baseURI).href;
    pdfjsModulePromise = import(pdfModuleUrl).then(mod => {
      if (typeof mod.getDocument !== "function" || !mod.GlobalWorkerOptions) {
        throw new Error("PDF.js 模块加载不完整，请刷新页面后重试");
      }
      mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return mod;
    });
  }
  return pdfjsModulePromise;
}

async function extractPdfText(file, forceReload = false) {
  const pdfjsLib = await loadPdfJs(forceReload);
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    // pdf.js 不在 str 里包含换行符，要靠每个 text item 的 hasEOL 自己拼行，
    // 否则整页会被拼成一个几千字符的长行，后续按行做的段落标题识别会完全失效
    let pageText = "";
    content.items.forEach(item => {
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
    });
    pageTexts.push(pageText.trim());
  }
  return pageTexts.join("\n\n").trim();
}

// ============================================================
// 本地存储读写（Day2 后端就绪前的临时持久化）
// ============================================================
function loadResumeVersions() {
  try {
    const raw = localStorage.getItem(RESUME_MOCK_STORAGE_KEY);
    resumeVersions = raw ? JSON.parse(raw) : [];
  } catch {
    resumeVersions = [];
  }
  return resumeVersions;
}

function persistResumeVersions() {
  localStorage.setItem(RESUME_MOCK_STORAGE_KEY, JSON.stringify(resumeVersions));
}

// ============================================================
// 关键词启发式解析（mock parse-resume 的本地替代实现）
// ============================================================
function findSectionStart(lines, keywords) {
  return lines.findIndex(line => {
    // 段落标题一般较短（如 "CORE SKILLS 核心技能"），正文行通常更长，用长度过滤降低误判
    if (line.length > 40) return false;
    const norm = line.toLowerCase().replace(/[:：]/g, "").trim();
    return keywords.some(k => norm.includes(k.toLowerCase()));
  });
}

function extractSection(lines, sectionKey) {
  const startIdx = findSectionStart(lines, RESUME_SECTION_KEYWORDS[sectionKey]);
  if (startIdx === -1) return [];
  const otherEntries = Object.entries(RESUME_SECTION_KEYWORDS).filter(([key]) => key !== sectionKey);
  let endIdx = Math.min(lines.length, startIdx + 1 + 12);
  for (let i = startIdx + 1; i < endIdx; i++) {
    const hitsOtherHeader = otherEntries.some(([, kws]) => findSectionStart([lines[i]], kws) === 0);
    if (hitsOtherHeader) { endIdx = i; break; }
  }
  return lines.slice(startIdx + 1, endIdx).filter(Boolean);
}

function splitSkillTokens(sectionLines) {
  return sectionLines
    .join(" ")
    .split(/[,，、\/|·;；.。]+/)
    .map(s => s.trim())
    // 简历技能段落常混着完整句子（如 "Proficient in prompt engineering..."），
    // 粗暴按标点切完仍可能留下长句，这类不适合当技能 chip，直接丢弃，
    // 留给用户在下方手动输入补充——这是启发式 mock 的已知局限，非真实 AI 解析
    .filter(s => s && s.length <= 20)
    .slice(0, 24);
}

// 契约里 education/experience 是结构化对象数组，mock 阶段没法真的从纯文本
// 抠出 institution/credential/field 这些子字段，就把整行塞进主字段，
// 其余字段留空——形状对了，真实 parse-resume 上线后直接覆盖即可
function linesToEducation(lines) {
  return lines.map(line => ({ institution: line, credential: "", field: "", start_date: null, end_date: null }));
}

function linesToExperience(lines) {
  return lines.map(line => ({ company: line, title: "", start_date: null, end_date: null, highlights: [] }));
}

function educationToLines(education) {
  return (education || []).map(e => [e.institution, e.credential, e.field].filter(Boolean).join(" · "));
}

function experienceToLines(experience) {
  return (experience || []).map(e => [e.company, e.title, ...(e.highlights || [])].filter(Boolean).join(" · "));
}

// 本地关键词启发式解析，用于在真实 parse-resume 接入前跑通交互
function mockParseResumeText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[\s-]?)?\d{3}[\s-]?\d{3,4}[\s-]?\d{4}/);
  const skillLines = extractSection(lines, "skills");
  return {
    contact: {
      name: lines[0] ? lines[0].slice(0, 30) : "",
      email: emailMatch ? emailMatch[0] : "",
      phone: phoneMatch ? phoneMatch[0] : "",
      location: ""
    },
    summary: "",
    skills: splitSkillTokens(skillLines),
    education: linesToEducation(extractSection(lines, "education")),
    experience: linesToExperience(extractSection(lines, "experience")),
    certifications: [],
    languages: []
  };
}

// ============================================================
// UI：上传 → 预览 → 解析 → 编辑 → 保存
// ============================================================
function resetResumeUploadFlow() {
  resumeSelectedFile = null;
  resumeDraft = null;
  resumeEditingId = null;
  document.getElementById("resumeFileInput").value = "";
  document.getElementById("resumePreviewStep").hidden = true;
  document.getElementById("resumeResultStep").hidden = true;
  document.getElementById("resumeLoading").hidden = true;
  showResumeMessage(null);
}

function showResumeMessage(type, text) {
  const el = document.getElementById("resumeMessage");
  if (!type) {
    el.hidden = true;
    el.textContent = "";
    el.className = "resume-message";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `resume-message ${type}`;
}

async function handleResumeFileSelect(file) {
  if (!file) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    showResumeMessage("error", "请上传 PDF 格式的简历文件。");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showResumeMessage("error", "文件过大（超过 10MB），请压缩后重试。");
    return;
  }
  resumeSelectedFile = file;
  showResumeMessage(null);
  let text;
  try {
    text = await extractPdfText(file);
  } catch (firstErr) {
    // 大概率是 PDF.js 模块/worker 被旧缓存（浏览器或 service worker）挡住了，
    // 用带时间戳的 URL 强制重新拉取一次再试，避免用户手动强刷页面
    try {
      text = await extractPdfText(file, /* forceReload */ true);
    } catch (retryErr) {
      showResumeMessage(
        "error",
        "PDF 解析组件加载异常，已自动重试仍失败。请强制刷新页面（Mac: Cmd+Shift+R）后重试；若持续出现，请换 Chrome 浏览器测试并把完整报错发我们：" +
          (retryErr.message || retryErr)
      );
      return;
    }
  }
  if (!text) {
    showResumeMessage("error", "未能从该 PDF 中提取到文本，可能是扫描件图片版，暂不支持。");
    return;
  }
  document.getElementById("resumePreviewFilename").textContent = file.name;
  document.getElementById("resumePreviewText").value = text;
  document.getElementById("resumePreviewStep").hidden = false;
  document.getElementById("resumeResultStep").hidden = true;
}

async function handleResumeParseClick() {
  const text = document.getElementById("resumePreviewText").value.trim();
  if (!text) {
    showResumeMessage("error", "提取文本为空，请检查文件内容。");
    return;
  }
  if (RESUME_BACKEND_READY && !currentUser) {
    showResumeMessage("error", "请先登录后再上传简历解析——未登录状态下无法调用简历解析服务。");
    return;
  }
  document.getElementById("resumeLoading").hidden = false;
  document.getElementById("resumeResultStep").hidden = true;
  showResumeMessage(null);
  try {
    let parsedResumeId = null;
    if (RESUME_BACKEND_READY) {
      const resume = await callParseResumeBackend(text, resumeSelectedFile?.name || "resume.pdf");
      resumeDraft = resume.parsed;
      parsedResumeId = resume.id;
    } else {
      resumeDraft = mockParseResumeText(text);
    }
    resumeDraft.rawText = text;
    resumeDraft.filename = resumeSelectedFile?.name || "resume.pdf";
    resumeDraft.id = parsedResumeId; // 后端就绪时，parse-resume 已经把这条记录落库了，这里只是把真实 id 带回来
    renderResumeDraft();
    document.getElementById("resumeResultStep").hidden = false;
  } catch (err) {
    const msg = err?.message || String(err);
    showResumeMessage(
      "error",
      /unauthenticated|401/i.test(msg)
        ? "请先登录后再上传简历解析。"
        : "解析失败：" + msg
    );
  } finally {
    document.getElementById("resumeLoading").hidden = true;
  }
}

// docs/api-contracts-v1.md #1 parse-resume
async function callParseResumeBackend(rawText, filename) {
  const { data, error } = await supabase.functions.invoke("parse-resume", {
    body: { filename, raw_text: rawText, locale: "en-CA" }
  });
  if (error) throw error;
  return data.resume; // { id, filename, status, parsed, created_at }
}

function renderResumeDraft() {
  if (!resumeDraft) return;
  document.getElementById("resumeContactName").value = resumeDraft.contact?.name || "";
  document.getElementById("resumeContactEmail").value = resumeDraft.contact?.email || "";
  document.getElementById("resumeContactPhone").value = resumeDraft.contact?.phone || "";
  document.getElementById("resumeContactLocation").value = resumeDraft.contact?.location || "";
  document.getElementById("resumeEducationText").value = educationToLines(resumeDraft.education).join("\n");
  document.getElementById("resumeExperienceText").value = experienceToLines(resumeDraft.experience).join("\n");
  renderSkillChips();
}

function renderSkillChips() {
  const wrap = document.getElementById("resumeSkillsChips");
  const skills = resumeDraft?.skills || [];
  if (!skills.length) {
    wrap.innerHTML = `<span class="small-muted">暂未识别到技能，可在下方手动输入添加。</span>`;
    return;
  }
  wrap.innerHTML = skills.map((skill, idx) => `
    <span class="skill-chip">
      ${escapeHtml(skill)}
      <button type="button" class="skill-chip-remove" data-remove-skill="${idx}" aria-label="删除">×</button>
    </span>
  `).join("");
}

function addSkillFromInput() {
  const input = document.getElementById("resumeSkillInput");
  const value = input.value.trim();
  if (!value || !resumeDraft) return;
  resumeDraft.skills = resumeDraft.skills || [];
  if (!resumeDraft.skills.includes(value)) resumeDraft.skills.push(value);
  input.value = "";
  renderSkillChips();
}

function removeSkillAt(idx) {
  if (!resumeDraft?.skills) return;
  resumeDraft.skills.splice(idx, 1);
  renderSkillChips();
}

function collectDraftFromForm() {
  const eduLines = document.getElementById("resumeEducationText").value.split("\n").map(s => s.trim()).filter(Boolean);
  const expLines = document.getElementById("resumeExperienceText").value.split("\n").map(s => s.trim()).filter(Boolean);
  return {
    ...resumeDraft,
    contact: {
      name: document.getElementById("resumeContactName").value.trim(),
      email: document.getElementById("resumeContactEmail").value.trim(),
      phone: document.getElementById("resumeContactPhone").value.trim(),
      location: document.getElementById("resumeContactLocation").value.trim()
    },
    education: linesToEducation(eduLines),
    experience: linesToExperience(expLines)
  };
}

function handleResumeSaveClick() {
  if (!resumeDraft) return;

  if (RESUME_BACKEND_READY) {
    // parse-resume 已经把这条记录写进 resumes 表了，"保存"这一步不需要再插一条。
    // 表单里对技能/教育/经历的手动修改目前不会回传服务端——契约里没有"更新已解析
    // 字段"的接口，只有整段重新解析。如实告知用户，而不是假装保存生效。
    showToast("简历已保存到你的账户（手动修改的字段展示用，暂未同步到服务端，等接口就绪）");
    resetResumeUploadFlow();
    renderResumeVersionList();
    return;
  }

  const finalDraft = collectDraftFromForm();
  loadResumeVersions();

  if (resumeEditingId) {
    const idx = resumeVersions.findIndex(r => r.id === resumeEditingId);
    if (idx !== -1) {
      resumeVersions[idx] = { ...resumeVersions[idx], ...finalDraft, updatedAt: new Date().toISOString() };
    }
  } else {
    const isFirst = resumeVersions.length === 0;
    resumeVersions.push({
      id: crypto.randomUUID(),
      filename: finalDraft.filename,
      rawText: finalDraft.rawText,
      contact: finalDraft.contact,
      summary: finalDraft.summary || "",
      skills: finalDraft.skills || [],
      education: finalDraft.education || [],
      experience: finalDraft.experience || [],
      certifications: finalDraft.certifications || [],
      languages: finalDraft.languages || [],
      status: "mock_parsed",
      isDefault: isFirst,
      createdAt: new Date().toISOString()
    });
  }

  persistResumeVersions();
  showToast(resumeEditingId ? "简历版本已更新" : "简历版本已保存");
  resetResumeUploadFlow();
  renderResumeVersionList();
}

// ============================================================
// 简历版本列表
// ============================================================
function getDefaultResumeId() {
  return localStorage.getItem(RESUME_DEFAULT_ID_KEY);
}

function setDefaultResumeId(id) {
  localStorage.setItem(RESUME_DEFAULT_ID_KEY, id);
}

// resumes 表没有 is_default 列，用真实 id 在本地记一个"当前默认"（见文件头已知缺口 #1）
async function listResumesBackend() {
  return dbGetAll("resumes", row => ({
    id: row.id,
    filename: row.filename,
    rawText: row.raw_text,
    contact: row.parsed?.contact || {},
    summary: row.parsed?.summary || "",
    skills: row.parsed?.skills || [],
    education: row.parsed?.education || [],
    experience: row.parsed?.experience || [],
    certifications: row.parsed?.certifications || [],
    languages: row.parsed?.languages || [],
    status: row.status,
    createdAt: row.created_at
  }));
}

async function renderResumeVersionList() {
  const list = document.getElementById("resumeVersionList");
  if (!list) return;

  if (RESUME_BACKEND_READY) {
    if (!currentUser) {
      list.innerHTML = `<div class="empty-state">请先登录后查看你的简历版本。</div>`;
      return;
    }
    let resumes;
    try {
      resumes = await listResumesBackend();
    } catch (err) {
      list.innerHTML = `<div class="empty-state">简历列表加载失败：${escapeHtml(err?.message || String(err))}</div>`;
      return;
    }
    resumes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let defaultId = getDefaultResumeId();
    if (!defaultId && resumes.length) { defaultId = resumes[0].id; setDefaultResumeId(defaultId); }
    resumeVersions = resumes.map(r => ({ ...r, isDefault: r.id === defaultId }));
  } else {
    loadResumeVersions();
  }

  if (!resumeVersions.length) {
    list.innerHTML = `<div class="empty-state">还没有保存任何简历版本，上传一份 PDF 简历开始吧。</div>`;
    return;
  }

  list.innerHTML = resumeVersions.map(resume => `
    <article class="resume-card" data-resume-id="${resume.id}">
      <div class="resume-card-main">
        <div class="resume-card-title">
          ${escapeHtml(resume.filename)}
          ${resume.isDefault ? `<span class="resume-badge-default">默认简历</span>` : ""}
        </div>
        <div class="small-muted">
          ${escapeHtml(resume.contact?.name || "未识别姓名")} · 上传于 ${formatTimestamp(resume.createdAt)}
          · 技能 ${resume.skills?.length || 0} 项
        </div>
      </div>
      <div class="card-actions">
        ${!resume.isDefault ? `<button class="btn secondary" data-set-default="${resume.id}">设为默认</button>` : ""}
        ${RESUME_BACKEND_READY ? "" : `<button class="icon-btn" title="编辑" data-edit-resume="${resume.id}">✎</button>`}
        <button class="icon-btn" title="删除" data-delete-resume="${resume.id}">⌫</button>
      </div>
    </article>
  `).join("");
}

function editResumeVersion(id) {
  // 后端就绪时编辑入口本来就不渲染（见 renderResumeVersionList），这里只保留 mock 路径
  loadResumeVersions();
  const resume = resumeVersions.find(r => r.id === id);
  if (!resume) return;
  resumeEditingId = id;
  resumeSelectedFile = null;
  resumeDraft = {
    contact: resume.contact,
    skills: [...(resume.skills || [])],
    education: [...(resume.education || [])],
    experience: [...(resume.experience || [])],
    rawText: resume.rawText,
    filename: resume.filename
  };
  document.getElementById("resumePreviewStep").hidden = true;
  renderResumeDraft();
  document.getElementById("resumeResultStep").hidden = false;
  document.getElementById("resumeResultStep").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setDefaultResumeVersion(id) {
  if (RESUME_BACKEND_READY) {
    setDefaultResumeId(id);
    renderResumeVersionList();
    showToast("已更新默认简历");
    return;
  }
  loadResumeVersions();
  resumeVersions = resumeVersions.map(r => ({ ...r, isDefault: r.id === id }));
  persistResumeVersions();
  renderResumeVersionList();
  showToast("已更新默认简历");
}

async function deleteResumeVersion(id) {
  if (!confirm("确定删除这份简历版本吗？此操作不可撤销。")) return;

  if (RESUME_BACKEND_READY) {
    try {
      // ⚠️ .delete() 不带 .select() 时，Supabase 在零行匹配（RLS 拦掉、id 不对、
      // 已经被删过）时也会返回 error:null——之前的写法只看 error，等于永远不会
      // 发现"删除请求成功发出但其实什么都没删掉"这种情况。这正是 Steven 反馈的
      // "删除后刷新记录还在"：UI 显示删除成功，实际上服务端那一行根本没被删。
      // 加 .select("id") 拿到真实受影响的行，用行数判断删除是否真的发生。
      const { data, error } = await supabase.from("resumes").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("删除请求已发送，但没有记录被删除（可能是权限问题或记录已不存在），请刷新页面确认");
      }
      if (getDefaultResumeId() === id) localStorage.removeItem(RESUME_DEFAULT_ID_KEY);
      renderResumeVersionList();
      showToast("已删除该简历版本");
    } catch (err) {
      showToast("删除失败：" + (err?.message || "未知错误"));
    }
    return;
  }

  loadResumeVersions();
  const wasDefault = resumeVersions.find(r => r.id === id)?.isDefault;
  resumeVersions = resumeVersions.filter(r => r.id !== id);
  if (wasDefault && resumeVersions.length) resumeVersions[0].isDefault = true;
  persistResumeVersions();
  renderResumeVersionList();
  showToast("已删除该简历版本");
}

// ============================================================
// 事件绑定
// ============================================================
function initResumesModule() {
  const dropzone = document.getElementById("resumeDropzone");
  const fileInput = document.getElementById("resumeFileInput");
  if (!dropzone || !fileInput) return; // HTML 版本不匹配时跳过，不影响其他模块

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", e => {
    if (e.target.files?.[0]) handleResumeFileSelect(e.target.files[0]);
  });
  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("dragover"); });
  });
  dropzone.addEventListener("drop", e => {
    if (e.dataTransfer.files?.[0]) handleResumeFileSelect(e.dataTransfer.files[0]);
  });

  document.getElementById("resumeCancelBtn").addEventListener("click", resetResumeUploadFlow);
  document.getElementById("resumeParseBtn").addEventListener("click", handleResumeParseClick);
  document.getElementById("resumeDiscardBtn").addEventListener("click", resetResumeUploadFlow);
  document.getElementById("resumeSaveBtn").addEventListener("click", handleResumeSaveClick);

  document.getElementById("resumeSkillInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkillFromInput();
    }
  });
  document.getElementById("resumeSkillsChips").addEventListener("click", e => {
    const btn = e.target.closest("[data-remove-skill]");
    if (btn) removeSkillAt(Number(btn.dataset.removeSkill));
  });

  document.getElementById("resumeVersionList").addEventListener("click", e => {
    const setDefaultBtn = e.target.closest("[data-set-default]");
    const editBtn = e.target.closest("[data-edit-resume]");
    const deleteBtn = e.target.closest("[data-delete-resume]");
    if (setDefaultBtn) setDefaultResumeVersion(setDefaultBtn.dataset.setDefault);
    if (editBtn) editResumeVersion(editBtn.dataset.editResume);
    if (deleteBtn) deleteResumeVersion(deleteBtn.dataset.deleteResume);
  });
}

document.addEventListener("DOMContentLoaded", initResumesModule);

// 暴露给 app.js 的 switchView() 调用
window.renderResumeVersionList = renderResumeVersionList;
