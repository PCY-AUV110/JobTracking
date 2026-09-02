// ============================================================
// resumes.js — 简历中心模块（Day1-3）
// 职责：PDF 上传 → 客户端提取文本 → 结构化结果编辑 → 多简历版本管理
// 依赖：全局 escapeHtml、showToast、formatTimestamp（来自 app.js）
//
// ⚠️ Mock 说明：契约已在 docs/api-contracts-v1.md（Codex，2026-09-02 frozen）
// 定稿，但 resumes 表 migration 还没跑到生产库，所以字段形状已经对齐契约，
// 数据来源仍是 localStorage + 本地关键词启发式解析。RESUME_BACKEND_READY
// 打开后，callParseResumeBackend() 走 supabase.functions.invoke("parse-resume", ...)，
// 渲染/存储逻辑不需要改，因为 resumeDraft 的 education/experience 已经是
// 契约里的 {institution/credential/field/...} / {company/title/highlights/...}
// 结构化对象，不是简单字符串数组。
// ============================================================

const RESUME_BACKEND_READY = false; // TODO(Day2): Codex 的 resumes 表 + parse-resume 就绪后置为 true 并接入 dbGetAll/dbUpsert
const RESUME_MOCK_STORAGE_KEY = "offerflow_mock_resumes_v1";

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
function loadPdfJs() {
  if (!pdfjsModulePromise) {
    // Resolve from the current document URL so GitHub Pages' /JobTracking/
    // base path is preserved. A root-relative worker URL would 404 in production.
    const pdfModuleUrl = new URL("vendor/pdfjs/pdf.min.mjs", document.baseURI).href;
    const pdfWorkerUrl = new URL("vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
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

async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
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
  try {
    const text = await extractPdfText(file);
    if (!text) {
      showResumeMessage("error", "未能从该 PDF 中提取到文本，可能是扫描件图片版，暂不支持。");
      return;
    }
    document.getElementById("resumePreviewFilename").textContent = file.name;
    document.getElementById("resumePreviewText").value = text;
    document.getElementById("resumePreviewStep").hidden = false;
    document.getElementById("resumeResultStep").hidden = true;
  } catch (err) {
    showResumeMessage("error", "PDF 文本提取失败：" + (err.message || err));
  }
}

async function handleResumeParseClick() {
  const text = document.getElementById("resumePreviewText").value.trim();
  if (!text) {
    showResumeMessage("error", "提取文本为空，请检查文件内容。");
    return;
  }
  document.getElementById("resumeLoading").hidden = false;
  document.getElementById("resumeResultStep").hidden = true;
  showResumeMessage(null);
  try {
    // TODO(Day2): 替换为 await callAIFunction("parse-resume", { raw_text: text, filename })
    resumeDraft = RESUME_BACKEND_READY
      ? await callParseResumeBackend(text, resumeSelectedFile?.name || "resume.pdf")
      : mockParseResumeText(text);
    resumeDraft.rawText = text;
    resumeDraft.filename = resumeSelectedFile?.name || "resume.pdf";
    renderResumeDraft();
    document.getElementById("resumeResultStep").hidden = false;
  } catch (err) {
    showResumeMessage("error", "解析失败：" + (err.message || err));
  } finally {
    document.getElementById("resumeLoading").hidden = true;
  }
}

// docs/api-contracts-v1.md #1 parse-resume（此函数在 RESUME_BACKEND_READY=true 前不会被调用）
async function callParseResumeBackend(rawText, filename) {
  const { data, error } = await supabase.functions.invoke("parse-resume", {
    body: { filename, raw_text: rawText, locale: "en-CA" }
  });
  if (error) throw error;
  return data.resume.parsed;
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
      status: RESUME_BACKEND_READY ? "parsed" : "mock_parsed",
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
function renderResumeVersionList() {
  loadResumeVersions();
  const list = document.getElementById("resumeVersionList");
  if (!list) return;

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
        <button class="icon-btn" title="编辑" data-edit-resume="${resume.id}">✎</button>
        <button class="icon-btn" title="删除" data-delete-resume="${resume.id}">⌫</button>
      </div>
    </article>
  `).join("");
}

function editResumeVersion(id) {
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
  loadResumeVersions();
  resumeVersions = resumeVersions.map(r => ({ ...r, isDefault: r.id === id }));
  persistResumeVersions();
  renderResumeVersionList();
  showToast("已更新默认简历");
}

function deleteResumeVersion(id) {
  if (!confirm("确定删除这份简历版本吗？此操作不可撤销。")) return;
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
