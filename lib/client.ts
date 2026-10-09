/** 浏览器端 API 客户端：统一错误读取和时间展示。 */

import type { AutomationTask, TaskExecution } from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : `请求失败：${response.status}`,
    );
  }
  return payload as T;
}

export function loadTasks() {
  return requestJson<{ tasks: AutomationTask[] }>("/api/tasks");
}

export function createTask(task: unknown) {
  return requestJson<{ task: AutomationTask }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

/** 从自然语言脚本创建并立即执行用例；调用方拿 execution id 后可跳转到监控页。 */
export function createTaskFromScript(input: {
  name: string;
  script: string;
  headless: boolean;
}) {
  return requestJson<{ task: AutomationTask; execution: TaskExecution }>(
    "/api/tasks/from-script",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateTask(id: string, task: unknown) {
  return requestJson<{ task: AutomationTask }>(`/api/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(task),
  });
}

export function removeTask(id: string) {
  return requestJson<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" });
}

export function runTask(id: string) {
  return requestJson<{ execution: TaskExecution }>(`/api/tasks/${id}/run`, {
    method: "POST",
  });
}

export function loadExecutions() {
  return requestJson<{
    executions: TaskExecution[];
    queue: { concurrency: number; running: number; queued: number };
  }>("/api/executions");
}

export function loadExecution(id: string) {
  return requestJson<{ execution: TaskExecution }>(`/api/executions/${id}`);
}

export function formatDuration(ms?: number): string {
  if (ms == null) return "-";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "-";
}

export function statusLabel(status: TaskExecution["status"]): string {
  const labels = {
    queued: "排队中",
    running: "执行中",
    succeeded: "已通过",
    failed: "失败",
    interrupted: "已中断",
  } as const;
  return labels[status];
}
