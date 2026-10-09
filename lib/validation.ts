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
    if (step.target != null) normalized.target = String(step.target);
    if (step.value != null) normalized.value = String(step.value);
    if (step.timeout != null) {
      normalized.timeout = Number(step.timeout);
      if (!Number.isFinite(normalized.timeout) || normalized.timeout <= 0) {
        throw new Error(`第 ${index + 1} 个步骤的 timeout 必须大于 0`);
      }
    }
    return normalized;
  });

  return {
    name,
    target: "web",
    description: raw.description == null ? undefined : String(raw.description),
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    headless: raw.headless == null ? true : Boolean(raw.headless),
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
