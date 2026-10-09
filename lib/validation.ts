/** 任务定义校验：把不可信的 API 输入收敛为稳定的执行模型。 */

import type {
  AutomationRuntime,
  AutomationStep,
  AutomationTask,
  MidsceneAiContexts,
  MidsceneCacheStrategy,
  MidsceneScrollDirection,
  RunnerId,
} from "./types";

const actions = new Set([
  "goto",
  "click",
  "fill",
  "press",
  "wait",
  "expectText",
  "aiAct",
  "aiAssert",
  "aiQuery",
  "aiWaitFor",
  "hover",
  "scroll",
  "doubleClick",
  "rightClick",
  "clearInput",
  "aiBoolean",
  "aiNumber",
  "aiString",
]);

const midsceneOnlyActions = new Set([
  "aiAct",
  "aiAssert",
  "aiQuery",
  "aiWaitFor",
  "hover",
  "scroll",
  "doubleClick",
  "rightClick",
  "clearInput",
  "aiBoolean",
  "aiNumber",
  "aiString",
]);

const midsceneContextKeys = new Set(["default", "aiAct", "aiQuery"]);
const cacheStrategies = new Set(["read-only", "read-write", "write-only"]);
const scrollDirections = new Set([
  "up",
  "down",
  "left",
  "right",
  "toTop",
  "toBottom",
  "toLeft",
  "toRight",
]);

const browsers = new Set(["chromium", "firefox", "webkit"]);

/** Runner 是执行语义的分叉点；旧请求不传时继续使用 Playwright，保持 v0.1 兼容。 */
function parseRunner(value: unknown): RunnerId {
  if (value == null) return "playwright";
  const runner = String(value);
  if (runner !== "playwright" && runner !== "midscene") {
    throw new Error("runner 只支持 playwright 或 midscene");
  }
  return runner;
}

/** runtime 只开放少量单机可控行为，避免把 Playwright 全部能力直接暴露给不可信 API。 */
function parseRuntime(value: unknown): AutomationRuntime | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("runtime 必须是对象");
  }
  const raw = value as Record<string, unknown>;
  const runtime: AutomationRuntime = {};

  if (raw.browser != null) {
    const browser = String(raw.browser);
    if (!browsers.has(browser)) {
      throw new Error("runtime.browser 只支持 chromium、firefox 或 webkit");
    }
    runtime.browser = browser as AutomationRuntime["browser"];
  }

  if (raw.retries != null) {
    const retries = Number(raw.retries);
    if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
      throw new Error("runtime.retries 必须是 0 到 3 的整数");
    }
    runtime.retries = retries;
  }

  if (raw.trace != null) {
    if (typeof raw.trace !== "boolean" && raw.trace !== "true" && raw.trace !== "false") {
      throw new Error("runtime.trace 必须是布尔值");
    }
    runtime.trace = raw.trace === true || raw.trace === "true";
  }

  if (raw.cache != null) {
    if (typeof raw.cache !== "object" || Array.isArray(raw.cache)) {
      throw new Error("runtime.cache 必须是对象");
    }
    const cacheRaw = raw.cache as Record<string, unknown>;
    const cache: AutomationRuntime["cache"] = {};
    if (cacheRaw.enabled != null) {
      if (
        typeof cacheRaw.enabled !== "boolean" &&
        cacheRaw.enabled !== "true" &&
        cacheRaw.enabled !== "false"
      ) {
        throw new Error("runtime.cache.enabled 必须是布尔值");
      }
      cache.enabled = cacheRaw.enabled === true || cacheRaw.enabled === "true";
    }
    if (cacheRaw.strategy != null) {
      const strategy = String(cacheRaw.strategy);
      if (!cacheStrategies.has(strategy)) {
        throw new Error("runtime.cache.strategy 只支持 read-only、read-write 或 write-only");
      }
      cache.strategy = strategy as MidsceneCacheStrategy;
    }
    if (cacheRaw.id != null) {
      const id = String(cacheRaw.id).trim();
      if (!id) throw new Error("runtime.cache.id 不能为空");
      cache.id = id;
    }
    runtime.cache = cache;
  }

  return Object.keys(runtime).length ? runtime : undefined;
}

/** 可选文本字段保留原文；只有确实传入 null/undefined 时才视为缺省。 */
function optionalText(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

/** 布尔配置必须显式；字符串仅兼容 JSON 文本里常见的 true/false，避免 false 被 Boolean() 误转成 true。 */
function parseHeadless(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("headless 必须是布尔值");
}

/** 标签是展示和后续分组用的字符串集合；这里拒绝静默把 null 变成 "null"。 */
function parseLabels(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("labels 必须是字符串数组");
  }
  return value.map((label) => (label as string).trim()).filter(Boolean);
}

/** 业务上下文会直接进入模型提示，剔除空白可避免生成无意义 token。 */
function parseMidsceneAiContexts(value: unknown): MidsceneAiContexts | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("aiContexts 必须是对象");
  }
  const raw = value as Record<string, unknown>;
  const contexts: MidsceneAiContexts = {};
  for (const [key, item] of Object.entries(raw)) {
    if (item == null) continue;
    if (!midsceneContextKeys.has(key)) {
      throw new Error(`aiContexts.${key} 不是受支持的上下文键`);
    }
    const text = String(item).trim();
    if (text) contexts[key as keyof MidsceneAiContexts] = text;
  }
  return Object.keys(contexts).length ? contexts : undefined;
}

export interface TaskDraft {
  name: string;
  target: "web";
  runner: RunnerId;
  runtime?: AutomationRuntime;
  description?: string;
  labels: string[];
  environmentId?: string;
  aiContexts?: MidsceneAiContexts;
  headless: boolean;
  steps: AutomationStep[];
}

export function parseTaskDraft(input: unknown): TaskDraft {
  if (!input || typeof input !== "object") {
    throw new Error("任务请求体必须是 JSON 对象");
  }
  const raw = input as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  if (!name) throw new Error("任务名称不能为空");

  const target = String(raw.target ?? "web");
  if (target !== "web") {
    throw new Error("当前 MVP 只支持 web；desktop 需要接入桌面执行器");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("任务至少需要一个步骤");
  }
  const runner = parseRunner(raw.runner);
  const runtime = parseRuntime(raw.runtime);

  const steps = raw.steps.map((item, index): AutomationStep => {
    if (!item || typeof item !== "object") {
      throw new Error(`第 ${index + 1} 个步骤必须是对象`);
    }
    const step = item as Record<string, unknown>;
    const action = String(step.action ?? "");
    if (!actions.has(action)) {
      throw new Error(`第 ${index + 1} 个步骤使用了不支持的 action: ${action}`);
    }
    const normalized: AutomationStep = { action: action as AutomationStep["action"] };
    if (step.target != null) normalized.target = optionalText(step.target);
    if (step.value != null) normalized.value = optionalText(step.value);
    if (step.schema != null) {
      if (typeof step.schema !== "object" || Array.isArray(step.schema)) {
        throw new Error(`第 ${index + 1} 个步骤的 schema 必须是对象`);
      }
      normalized.schema = step.schema as Record<string, unknown>;
    }
    if (step.timeout != null) {
      normalized.timeout = Number(step.timeout);
      if (!Number.isFinite(normalized.timeout) || normalized.timeout <= 0) {
        throw new Error(`第 ${index + 1} 个步骤的 timeout 必须大于 0`);
      }
    }
    if (step.direction != null) {
      const direction = String(step.direction);
      if (!scrollDirections.has(direction)) {
        throw new Error(
          `第 ${index + 1} 个步骤的 direction 只支持 ${[...scrollDirections].join("、")}`,
        );
      }
      normalized.direction = direction as MidsceneScrollDirection;
    }
    if (step.context != null) {
      const context = String(step.context).trim();
      if (context) normalized.context = context;
    }

    // 必填字段在入库前拦截，避免任务保存成功却在执行期才暴露定位器或值缺失。
    switch (normalized.action) {
      case "click":
      case "fill":
        if (!normalized.target) {
          throw new Error(`第 ${index + 1} 个步骤的 action=${normalized.action} 必须提供 target`);
        }
        break;
      case "goto":
        if (!normalized.target && !normalized.value) {
          throw new Error(`第 ${index + 1} 个步骤的 action=goto 必须提供 value 或 target`);
        }
        break;
      case "press":
        if (!normalized.value) {
          throw new Error(`第 ${index + 1} 个步骤的 action=press 必须提供 value`);
        }
        break;
      case "wait":
        if (normalized.timeout == null && !normalized.value) {
          throw new Error(`第 ${index + 1} 个步骤的 action=wait 必须提供 timeout 或 value`);
        }
        break;
      case "expectText":
        if (!normalized.value) {
          throw new Error(`第 ${index + 1} 个步骤的 action=expectText 必须提供 value`);
        }
        break;
      case "aiAct":
      case "aiAssert":
      case "aiWaitFor":
        if (!normalized.value) {
          throw new Error(`第 ${index + 1} 个步骤的 action=${normalized.action} 必须提供 value`);
        }
        break;
      case "aiQuery":
        if (!normalized.schema) {
          throw new Error(`第 ${index + 1} 个步骤的 action=aiQuery 必须提供 schema`);
        }
        break;
      case "hover":
      case "doubleClick":
      case "rightClick":
      case "clearInput":
        if (!normalized.target) {
          throw new Error(`第 ${index + 1} 个步骤的 action=${normalized.action} 必须提供 target`);
        }
        break;
      case "scroll":
        if (!normalized.target && !normalized.direction) {
          throw new Error(`第 ${index + 1} 个步骤的 action=scroll 必须提供 target 或 direction`);
        }
        break;
      case "aiBoolean":
      case "aiNumber":
      case "aiString":
        if (!normalized.value) {
          throw new Error(`第 ${index + 1} 个步骤的 action=${normalized.action} 必须提供 value`);
        }
        break;
    }

    // AI 动作依赖模型语义定位；约束在 Midscene Runner，避免 Playwright 适配器出现隐式分叉。
    if (runner !== "midscene" && midsceneOnlyActions.has(normalized.action)) {
      throw new Error(`runner=playwright 不支持 AI 动作 ${normalized.action}`);
    }

    return normalized;
  });

  return {
    name,
    target: "web",
    runner,
    runtime,
    description: optionalText(raw.description),
    labels: parseLabels(raw.labels),
    environmentId: optionalText(raw.environmentId),
    aiContexts: parseMidsceneAiContexts(raw.aiContexts),
    headless: parseHeadless(raw.headless),
    steps,
  };
}

/** 环境草稿白名单校验；name 唯一约束由数据库 UNIQUE 索引兜底。 */
export function parseEnvironmentDraft(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("环境请求体必须是 JSON 对象");
  }
  const raw = input as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  if (!name) throw new Error("环境名称不能为空");
  const baseUrl = String(raw.baseUrl ?? "").trim();
  if (!baseUrl) throw new Error("基础 URL 不能为空");
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error("只支持 http 或 https");
    }
  } catch {
    throw new Error("基础 URL 格式无效");
  }
  return {
    name,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    username: optionalText(raw.username),
    password: optionalText(raw.password),
  };
}

export function taskFromDraft(
  draft: TaskDraft,
  existing?: AutomationTask,
): AutomationTask {
  const now = new Date().toISOString();
  return {
    ...draft,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
