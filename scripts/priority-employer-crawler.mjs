import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const artifactDir = process.env.ARTIFACT_DIR || "artifacts/priority-employers";
const batchSize = Math.min(Math.max(Number(process.env.BATCH_SIZE) || 10, 1), 20);
const employerIds = (process.env.EMPLOYER_IDS || "").split(",").map(v => v.trim()).filter(Boolean);
const employerNames = (process.env.EMPLOYER_NAMES || "").split(",").map(v => v.trim()).filter(Boolean);
const dryRun = /^(1|true)$/i.test(process.env.DRY_RUN || "false");
const maxJobCards = Math.min(Math.max(Number(process.env.MAX_JOB_CARDS) || 5, 1), 10);
const blockedHosts = /(^|\.)(linkedin\.com|indeed\.com)$/i;

if (!base || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const apiHeaders = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};

async function api(relative, options = {}) {
  const response = await fetch(`${base}/rest/v1/${relative}`, {
    ...options,
    headers: { ...apiHeaders, ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !blockedHosts.test(url.hostname) && !/(login|sign-?in)/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function robotsAllowed(value) {
  const url = new URL(value);
  try {
    const response = await fetch(`${url.origin}/robots.txt`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return true;
    const lines = (await response.text()).split(/\r?\n/);
    let applies = false;
    const disallowed = [];
    for (const raw of lines) {
      const line = raw.replace(/#.*/, "").trim();
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) applies = value === "*";
      if (applies && /^disallow$/i.test(key) && value) disallowed.push(value);
    }
    return !disallowed.some(rule => rule === "/" || url.pathname.startsWith(rule.replace(/\*.*$/, "")));
  } catch {
    return true;
  }
}

function detectAts(urls) {
  for (const raw of urls) {
    let url;
    try { url = new URL(raw); } catch { continue; }
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (/greenhouse\.io$/.test(host)) {
      const ignored = new Set(["embed", "jobs", "job", "departments"]);
      const token = parts.find(p => !ignored.has(p.toLowerCase()));
      if (token) return { ats_type: "greenhouse", token };
    }
    if (host === "jobs.lever.co" && parts[0]) return { ats_type: "lever", token: parts[0] };
    if (host === "jobs.ashbyhq.com" && parts[0]) return { ats_type: "ashby", token: parts[0] };
    if (/\.myworkdayjobs\.com$/.test(host)) return { ats_type: "workday", token: null };
  }
  return null;
}

async function probePublicAts(ats) {
  if (!ats?.token || ats.ats_type === "workday") return null;
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ats.token)}/jobs`,
    lever: `https://api.lever.co/v0/postings/${encodeURIComponent(ats.token)}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ats.token)}`,
  };
  const boardUrl = urls[ats.ats_type];
  if (!boardUrl) return null;
  try {
    const response = await fetch(boardUrl, { headers: { accept: "application/json", "user-agent": "OfferFlow/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.jobs || [];
    return rows.length ? { ...ats, boardUrl, jobs: rows.length } : null;
  } catch {
    return null;
  }
}

async function promoteFastPath(employer, ats) {
  if (!ats) return;
  if (!dryRun) {
    await api(`priority_employers?id=eq.${employer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ats_type: ats.ats_type, crawl_strategy: ats.token ? "ats_api" : "playwright_click" }),
    });
  }
  if (!ats.token || dryRun) return;
  await api("job_sources?on_conflict=ats_type,board_token", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      ats_type: ats.ats_type,
      company_name: employer.company_name,
      company_legal_name: employer.company_name,
      board_token: ats.token,
      board_url: ats.boardUrl,
      company_url: employer.career_url,
      enabled: true,
    }),
  });
}

async function markExistingJobs(employer) {
  const query = new URLSearchParams({ select: "id", company_legal_name: `ilike.*${employer.company_name}*`, limit: "1000" });
  const rows = await api(`jobs?${query}`);
  if (!dryRun && rows.length) {
    const ids = rows.map(row => row.id).join(",");
    await api(`jobs?id=in.(${ids})`, { method: "PATCH", body: JSON.stringify({ is_priority_employer: true }) });
  }
  return rows.length;
}

async function links(page) {
  return page.locator("a[href]").evaluateAll(nodes => nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      index,
      href: node.href,
      text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
    };
  }).filter(node => node.visible));
}

function rankJobLink(link) {
  if (!publicUrl(link.href)) return -100;
  let score = 0;
  if (/\b(view job|job details?|opportunity)\b/i.test(link.text)) score += 5;
  if (/\b(job|career|position|posting|requisition)s?\b/i.test(link.href)) score += 3;
  if (/\d{3,}/.test(link.href)) score += 2;
  if (/\b(search|all jobs|view jobs)\b/i.test(link.text)) score -= 2;
  if (/\b(login|sign in|talent community)\b/i.test(`${link.text} ${link.href}`)) return -100;
  return score;
}

function rankApplyLink(link) {
  if (!publicUrl(link.href)) return -100;
  if (/\b(apply now|apply for|apply)\b/i.test(link.text)) return 10;
  if (/\bapply\b/i.test(link.href)) return 6;
  return -100;
}

async function bestLink(page, ranker) {
  const candidates = (await links(page)).map(link => ({ ...link, score: ranker(link) })).filter(link => link.score > 0);
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxJobCards)[0] || null;
}

async function clickAnchor(page, candidate) {
  const anchors = page.locator("a[href]");
  const locator = anchors.nth(candidate.index);
  const popupPromise = page.context().waitForEvent("page", { timeout: 8_000 }).catch(() => null);
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 10_000 });
  const popup = await popupPromise;
  const target = popup || page;
  await target.waitForLoadState("domcontentloaded", { timeout: 25_000 }).catch(() => {});
  return target;
}

async function inspectEmployer(browser, employer) {
  const slug = safeName(employer.company_name);
  const evidenceDir = path.join(artifactDir, "evidence", slug);
  await mkdir(evidenceDir, { recursive: true });
  const context = await browser.newContext({
    userAgent: "OfferFlow-Public-Career-Verifier/1.0 (+https://github.com/PCY-AUV110/JobTracking)",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const chain = [];
  page.on("response", response => {
    if (response.request().resourceType() === "document") chain.push({ url: response.url(), status: response.status() });
  });
  const result = {
    employer_id: employer.id,
    company_name: employer.company_name,
    career_url: employer.career_url,
    listing_url: null,
    final_apply_url: null,
    redirect_chain: chain,
    page_title: null,
    http_status: null,
    screenshot_artifacts: [],
    captured_at: new Date().toISOString(),
    stopped_reason: "navigation_failed",
    ats: null,
    priority_jobs_marked: 0,
  };
  try {
    if (!publicUrl(employer.career_url)) throw new Error("non_public_or_blocked_career_url");
    if (!(await robotsAllowed(employer.career_url))) {
      result.stopped_reason = "robots_disallow";
      return result;
    }
    const response = await page.goto(employer.career_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    result.http_status = response?.status() || null;
    result.page_title = await page.title();
    if ([401, 403, 429].includes(result.http_status)) {
      result.stopped_reason = result.http_status === 429 ? "rate_limited" : "access_denied";
      return result;
    }
    if (await page.getByText(/captcha|verify you are human|access denied/i).first().isVisible().catch(() => false)) {
      result.stopped_reason = "captcha_stop";
      return result;
    }
    let jobLink = await bestLink(page, rankJobLink);
    if (!jobLink) {
      const searchLink = (await links(page)).find(link => publicUrl(link.href) && /\b(search|view|find|explore)\s+(all\s+)?jobs\b/i.test(link.text));
      if (searchLink) {
        await page.goto(searchLink.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        jobLink = await bestLink(page, rankJobLink);
      }
    }
    if (!jobLink) {
      result.stopped_reason = "no_public_listings";
      return result;
    }
    await page.goto(jobLink.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    result.listing_url = page.url();
    result.page_title = await page.title();
    const before = path.join(evidenceDir, "listing-before-apply.png");
    await page.screenshot({ path: before, fullPage: true });
    result.screenshot_artifacts.push(before);
    const applyLink = await bestLink(page, rankApplyLink);
    if (!applyLink) {
      result.stopped_reason = "no_public_apply_link";
      return result;
    }
    const target = await clickAnchor(page, applyLink);
    result.final_apply_url = target.url();
    result.page_title = await target.title();
    const lastResponse = [...chain].reverse().find(item => item.url === target.url());
    result.http_status = lastResponse?.status || result.http_status;
    const after = path.join(evidenceDir, "apply-destination.png");
    await target.screenshot({ path: after, fullPage: true });
    result.screenshot_artifacts.push(after);
    const terminalText = `${result.final_apply_url} ${result.page_title}`;
    result.stopped_reason = /captcha|verify.*human/i.test(terminalText) ? "captcha_stop"
      : /login|sign-?in/i.test(terminalText) ? "login_required_stop"
      : "apply_destination_confirmed";
    const ats = await probePublicAts(detectAts([employer.career_url, result.listing_url, result.final_apply_url, ...chain.map(item => item.url)]));
    result.ats = ats || detectAts([result.final_apply_url, result.listing_url]);
    await promoteFastPath(employer, ats || result.ats);
    result.priority_jobs_marked = await markExistingJobs(employer);
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    await context.close();
  }
}

async function persistResult(employer, result) {
  const blocked = ["access_denied", "captcha_stop", "robots_disallow", "rate_limited"].includes(result.stopped_reason);
  const verified = result.stopped_reason === "apply_destination_confirmed" || result.stopped_reason === "login_required_stop";
  const patch = {
    verify_status: verified ? "verified" : blocked ? "failed" : "pending",
    last_apply_url: result.final_apply_url,
    ...(verified ? { last_success_at: new Date().toISOString() } : {}),
  };
  if (!dryRun) await api(`priority_employers?id=eq.${employer.id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

async function loadEmployers() {
  const params = new URLSearchParams({ select: "*", order: "priority_tier.asc,last_success_at.asc.nullsfirst", limit: String(batchSize) });
  if (employerIds.length) params.set("id", `in.(${employerIds.join(",")})`);
  if (employerNames.length) params.set("company_name", `in.(${employerNames.map(v => `\"${v.replaceAll('"', '')}\"`).join(",")})`);
  return api(`priority_employers?${params}`);
}

await mkdir(artifactDir, { recursive: true });
const employers = await loadEmployers();
if (!employers.length) throw new Error("No priority employers selected");
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const employer of employers) {
    const result = await inspectEmployer(browser, employer);
    await persistResult(employer, result);
    results.push(result);
    await writeFile(path.join(artifactDir, `${safeName(employer.company_name)}.json`), JSON.stringify(result, null, 2));
    await new Promise(resolve => setTimeout(resolve, 1_500 + Math.floor(Math.random() * 1_500)));
  }
} finally {
  await browser.close();
}

const success = results.filter(result => ["apply_destination_confirmed", "login_required_stop"].includes(result.stopped_reason)).length;
const failed = results.filter(result => ["access_denied", "captcha_stop", "robots_disallow", "rate_limited", "navigation_failed"].includes(result.stopped_reason)).length;
const summary = [
  "## Priority employer discovery",
  "",
  `- Selected: **${results.length}**`,
  `- Apply destinations confirmed: **${success}**`,
  `- Failed/blocked: **${failed}**`,
  `- Dry run: **${dryRun}**`,
  "",
  "| Employer | Result | HTTP | Apply URL | ATS | Existing jobs marked |",
  "|---|---|---:|---|---|---:|",
  ...results.map(result => `| ${result.company_name} | ${result.stopped_reason} | ${result.http_status ?? ""} | ${result.final_apply_url ?? ""} | ${result.ats?.ats_type ?? ""} | ${result.priority_jobs_marked} |`),
  "",
].join("\n");
await writeFile(path.join(artifactDir, "summary.md"), summary);
await writeFile(path.join(artifactDir, "results.json"), JSON.stringify(results, null, 2));
console.log(summary);
if (success === 0 && failed === results.length) process.exitCode = 1;
