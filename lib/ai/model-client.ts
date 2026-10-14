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

/** 将模型网关错误转为可操作的提示；HTML、代理诊断页和非结构化正文不进入页面。 */
async function modelResponseError(response: Response): Promise<Error> {
  const prefix = `模型请求失败（HTTP ${response.status}）`;
  const messages: Record<number, string> = {
    408: "模型服务响应超时，请稍后重试。",
    504: "模型服务响应超时，请稍后重试。",
    429: "模型服务请求过于频繁或额度不足，请稍后重试或检查额度。",
    401: "模型服务认证失败或无访问权限，请检查 API Key 和模型权限。",
    403: "模型服务认证失败或无访问权限，请检查 API Key 和模型权限。",
    404: "未找到模型接口或模型，请检查模型服务地址和模型名称。",
  };
  const hint =
    messages[response.status] ??
    (response.status >= 500 ? "模型服务暂时不可用，请稍后重试。" : undefined);
  if (hint) {
    // 无需读取网关错误页时主动释放响应流，避免连续失败占用连接。
    await response.body?.cancel().catch(() => {});
    return new Error(`${prefix}：${hint}`);
  }

  // 参数错误只保留 JSON 中的简短消息；即使网关错误标注为 JSON，也不透传 HTML。
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const { error, message } = payload as {
      error?: unknown;
      message?: unknown;
    };
    const detail =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? error.message
          : message;
    if (typeof detail === "string" && !/[<>]/.test(detail)) {
      const summary = detail.replace(/\s+/g, " ").trim().slice(0, 200);
      if (summary) return new Error(`${prefix}：${summary}`);
    }
  }
  return new Error(`${prefix}：请检查模型配置和请求参数后重试。`);
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
  let response: Response;
  try {
    response = await fetch(endpoint, {
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
  } catch (error) {
    // 本地请求超时与网关 504 使用同样的操作提示，不暴露底层异常或自动重复付费请求。
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error("模型请求超时，请稍后重试。");
    }
    throw new Error("无法连接模型服务，请检查网络或模型服务地址后重试。");
  }

  if (!response.ok) {
    throw await modelResponseError(response);
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
