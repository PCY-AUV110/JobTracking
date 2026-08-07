// ============================================================
// Edge Function: parse-screenshot
// 功能：接收 base64 截图，调用 OpenAI Vision API 提取求职信息
// 部署后需设置 secret: OPENAI_API_KEY
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
    console.warn("[parse-screenshot] 记录 AI 用量失败:", e);
  }
}

// @ts-ignore - Deno.serve 在 Supabase Edge Functions 运行时可用
(Deno as any).serve(async (req: Request) => {
  // 处理 CORS 预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { image, mime } = await req.json();

    if (!image) {
      return new Response(
        JSON.stringify({ error: "缺少图片数据" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "服务端未配置 OPENAI_API_KEY，请在 Supabase Secrets 中设置。" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const model = "gpt-4o-mini";

    // 调用 OpenAI Vision API（gpt-4o-mini，便宜且足够）
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
              content: `你是一个求职信息提取助手。从用户提供的截图中提取求职相关信息。
返回严格的 JSON 对象，包含以下字段：
- company: 公司名称（必填）
- role: 职位名称（必填）
- location: 工作地点
- source: 申请渠道（如 LinkedIn、官网、Boss直聘等）
- jobUrl: 职位链接（如有）
- notes: 备注（薪资、特殊要求等关键信息）
- status: 建议的初始状态，从以下选一：准备申请、已申请、审核中、在线测评、准备面试、面试完成、收到Offer、已终止

如果某个字段无法从截图中确定，返回空字符串。
只返回 JSON 对象，不要任何其他文字或 markdown 标记。`,
            },
            {
              role: "user",
              content: [
                { type: "text", text: "请提取这张截图中的求职信息。" },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mime || "image/jpeg"};base64,${image}`,
                  },
                },
              ],
            },
          ],
          temperature: 0,
          max_tokens: 500,
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("OpenAI error:", errText);
      throw new Error(`OpenAI API 调用失败: ${openaiResponse.status}`);
    }

    const data = await openaiResponse.json();
    const content = data.choices[0].message.content.trim();

    // 异步记录 token 用量（不阻塞响应）
    const userId = getUserIdFromToken(req.headers.get("Authorization"));
    logAIUsage(userId, "parse-screenshot", model, data.usage);

    // 解析 JSON（兼容 AI 可能包裹 markdown 代码块的情况）
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

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "解析失败" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

export {};
