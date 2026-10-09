/** 任务定义校验：把不可信的 API 输入收敛为稳定的执行模型。 */

import type { AutomationStep, AutomationTask } from "./types";

const actions = new Set([
  "goto",
  "click",
  "fill",
  "press",
  "wait",
  "expectText",
]);

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

export interface TaskDraft {
  name: string;
  target: "web";
  description?: string;
  labels: string[];
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
    if (step.timeout != null) {
      normalized.timeout = Number(step.timeout);
      if (!Number.isFinite(normalized.timeout) || normalized.timeout <= 0) {
        throw new Error(`第 ${index + 1} 个步骤的 timeout 必须大于 0`);
      }
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
    }

    return normalized;
  });

  return {
    name,
    target: "web",
    description: optionalText(raw.description),
    labels: parseLabels(raw.labels),
    headless: parseHeadless(raw.headless),
    steps,
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
