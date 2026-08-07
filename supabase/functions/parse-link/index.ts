// ============================================================
// parse-link: 抓取职位链接页面，用 AI 提取求职信息
// 用户在「添加申请」中粘贴招聘网页 URL，自动填充表单
// 类型：deno.json 已在项目根目录配置 Deno 类型
// ============================================================

// @ts-ignore - Supabase Edge Functions 使用 Deno 运行时，esm.sh 模块在 TS 中无法解析
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 从 JWT 中解析用户 ID
function getUserIdFromToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

// 记录 AI 用量到数据库
async function logAIUsage(userId: string | null, functionName: string, model: string, usage: any) {
  if (!userId || !SERVICE_ROLE_KEY) return;
  try {
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    await adminClient.from("ai_usage_logs").insert({
      user_id: userId,
      function_name: functionName,
      model,
      prompt_tokens: usage?.prompt_tokens || 0,
      completion_tokens: usage?.completion_tokens || 0,
      total_tokens: usage?.total_tokens || 0,
    });
  } catch (e) {
    console.warn("[parse-link] 记录 AI 用量失败:", e);
  }
}

// 从 HTML 中提取 meta 内容
function extractMeta(html: string, prop: string): string {
  // 匹配 <meta property="og:xxx" content="..."> 或 <meta name="xxx" content="...">
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${prop}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return "";
}

// 从 HTML 提取 title
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m && m[1] ? m[1].trim() : "";
}

// 从 HTML 提取主要文本内容（粗暴版：去掉 script/style 标签后去标签）
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

(Deno as any).serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string" || !/^https?:\/\//.test(url)) {
      return new Response(
        JSON.stringify({ error: "请提供有效的职位链接（以 http(s):// 开头）" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "服务端未配置 OPENAI_API_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. 抓取页面 HTML
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (!pageRes.ok) {
      return new Response(
        JSON.stringify({ error: `页面抓取失败（HTTP ${pageRes.status}）` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = await pageRes.text();
    if (!html || html.length === 0) {
      return new Response(
        JSON.stringify({ error: "页面内容为空" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. 提取关键信息
    const ogTitle = extractMeta(html, "og:title");
    const ogDescription = extractMeta(html, "og:description");
    const title = extractTitle(html);
    const text = extractText(html).slice(0, 4000); // 截断避免 token 过多

    const summary = [
      ogTitle ? `og:title: ${ogTitle}` : "",
      title ? `title: ${title}` : "",
      ogDescription ? `og:description: ${ogDescription}` : "",
      `正文摘要: ${text}`,
    ].filter(Boolean).join("\n");

    // 3. 调用 OpenAI 解析
    const model = "gpt-4o-mini";
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `你是一个求职信息提取助手。用户会提供一个招聘网页的链接和页面内容摘要。
请提取以下字段，返回严格的 JSON 对象：
- company: 公司名称（必填）
- role: 职位名称（必填）
- location: 工作地点
- source: 申请渠道（如 LinkedIn、官网、Boss 直聘等）
- jobUrl: 职位链接（如果摘要中有，否则用用户提供的 URL）
- notes: 备注（关键信息摘要，如薪资范围、岗位要求等）
- status: 建议状态（准备申请/已申请/审核中/在线测评/准备面试/面试完成/收到Offer/已终止）

如果某个字段无法确定，返回空字符串。
只返回 JSON 对象，不要任何其他文字或 markdown 标记。`,
          },
          {
            role: "user",
            content: `用户提供的链接: ${url}\n\n页面内容摘要:\n${summary}`,
          },
        ],
        temperature: 0,
        max_tokens: 600,
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API 调用失败: ${openaiResponse.status}`);
    }

    const data = await openaiResponse.json();
    const content = data.choices[0].message.content.trim();

    // 异步记录 token 用量（不阻塞响应）
    const userId = getUserIdFromToken(req.headers.get("Authorization"));
    logAIUsage(userId, "parse-link", model, data.usage);

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error("AI 返回内容无法解析为 JSON");
      }
    }

    // 如果 AI 没有返回 jobUrl，用用户输入的 URL
    if (!parsed.jobUrl) {
      parsed.jobUrl = url;
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg || "解析失败" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

export {};
