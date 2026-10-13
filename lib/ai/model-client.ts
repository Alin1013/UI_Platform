/**
 * OpenAI-compatible 模型客户端。
 * 平台复用 Midscene 的服务端模型配置；API Key 只在 Node 侧使用，不进入浏览器。
 */

export interface ModelImage {
  mimeType: string;
  base64: string;
}

interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface ChatMessage {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

/** 统一读取模型配置，缺失时返回可操作的中文错误。 */
export function modelConfig(): ModelConfig {
  const baseUrl = process.env.MIDSCENE_MODEL_BASE_URL?.trim();
  const apiKey = process.env.MIDSCENE_MODEL_API_KEY?.trim();
  const modelName =
    process.env.UI_PLATFORM_GENERATOR_MODEL?.trim() ||
    process.env.MIDSCENE_MODEL_NAME?.trim();
  const missing = [
    baseUrl ? undefined : "MIDSCENE_MODEL_BASE_URL",
    apiKey ? undefined : "MIDSCENE_MODEL_API_KEY",
    modelName ? undefined : "MIDSCENE_MODEL_NAME",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`AI 模型未配置：缺少 ${missing.join(", ")}`);
  }
  return {
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    apiKey: apiKey!,
    modelName: modelName!,
  };
}

/** 提取模型输出中的 JSON；兼容少量 markdown 代码块，但 Prompt 仍要求纯 JSON。 */
function parseJsonResponse<T>(content: string): T {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("模型未返回 JSON");
  }
  try {
    return JSON.parse(content.slice(start, end + 1)) as T;
  } catch {
    throw new Error("模型返回的 JSON 无法解析");
  }
}

/**
 * 请求一次 JSON 结果。
 * 图片使用 data URL；由调用方控制大小，避免把无关文件发给模型。
 */
export async function requestModelJson<T>(
  system: string,
  prompt: string,
  images: ModelImage[] = [],
): Promise<T> {
  const config = modelConfig();
  const userContent: ChatMessage["content"] =
    images.length === 0
      ? prompt
      : [
          { type: "text", text: prompt },
          ...images.map((image) => ({
            type: "image_url" as const,
            image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
          })),
        ];

  const endpoint = resolveChatEndpoint(config.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelName,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(
      Number(process.env.UI_PLATFORM_AI_REQUEST_TIMEOUT ?? 120_000),
    ),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `模型请求失败：${response.status}${detail ? ` ${detail.slice(0, 500)}` : ""}`,
    );
  }

  const payload = (await response.json().catch(() => {
    throw new Error(
      "模型服务返回了非 JSON 响应；请检查 MIDSCENE_MODEL_BASE_URL 是否指向 OpenAI 兼容接口",
    );
  })) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const rawContent = payload.choices?.[0]?.message?.content;
  const text =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text?: unknown }).text ?? "")
                : "",
            )
            .join("")
        : "";
  if (!text.trim()) throw new Error("模型返回内容为空");
  return parseJsonResponse<T>(text);
}

/**
 * 把模型基础地址归一化为 chat/completions 端点。
 * 只配置域名时按 OpenAI 兼容约定补 /v1，避免根路径命中网站首页并返回 HTML。
 */
function resolveChatEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path || path === "/chat/completions") {
    return `${url.origin}${path || "/v1"}/chat/completions`;
  }

  return `${url.origin}${path}/chat/completions`;
}
