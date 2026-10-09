/**
 * 进程内任务调度器。
 * 单机部署时全局运行集合能精确限制并发；如果改为多进程，应替换为 BullMQ/Redis。
 */

import type { TaskExecution } from "./types";
import {
  getTask,
  listExecutions,
  saveExecution,
  updateExecution,
} from "./store";
import { executeWebTask, requestExecutionCancel } from "./executor";

interface QueueRuntime {
  running: Set<Promise<void>>;
  concurrency: number;
  draining: boolean;
}

/** Next 开发模式可能重载模块；挂在 globalThis 上避免重复启动调度器。 */
const globalQueue = globalThis as typeof globalThis & {
  __uiAutomationQueue?: QueueRuntime;
};

function runtime(): QueueRuntime {
  globalQueue.__uiAutomationQueue ??= {
    running: new Set<Promise<void>>(),
    concurrency: 5,
    draining: false,
  };
  return globalQueue.__uiAutomationQueue;
}

export function configureConcurrency(value: unknown): number {
  const parsed = Number(value);
  const queue = runtime();
  // 方案要求上限 10；默认 5 用于避免首次部署占满单机资源。
  queue.concurrency = Number.isFinite(parsed)
    ? Math.min(10, Math.max(1, Math.trunc(parsed)))
    : 5;
  return queue.concurrency;
}

export function concurrency(): number {
  return runtime().concurrency;
}

configureConcurrency(process.env.UI_PLATFORM_MAX_CONCURRENCY);

async function runOne(executionId: string): Promise<void> {
  // 领取动作必须是串行状态机的一部分；否则外层调度循环在落盘前重读，会重复执行同一任务。
  let claimed = false;
  const state = await updateExecution(executionId, (execution) => {
    if (execution.status !== "queued") return execution;
    claimed = true;
    return {
      ...execution,
      status: "running",
      startedAt: new Date().toISOString(),
    };
  });
  // 后进入的重复 runOne 读到的也是 running，因此必须用本次闭包是否真正领取来裁决。
  if (!claimed || !state) return;
  const taskId = state?.taskId;
  const task = taskId ? await getTask(taskId) : undefined;

  if (!state || !task) {
    await updateExecution(executionId, (execution) => ({
      ...execution,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "关联任务不存在或已被删除",
    }));
    return;
  }

  try {
    const logs = await executeWebTask(task, executionId, async (log) => {
      // 增量写入让 UI 轮询到每步结果；失败时后续更新只补最终状态，不覆盖这些日志。
      await updateExecution(executionId, (execution) => ({
        ...execution,
        logs: [...execution.logs, log],
        currentStep: log.index,
      }));
    });
    // 成功落盘前再查一次任务；覆盖“浏览器流程刚好在最后一个步骤后任务被删除”的竞态。
    const currentTask = await getTask(taskId);
    if (!currentTask) {
      throw new Error("关联任务已被删除");
    }
    const finishedAt = new Date().toISOString();
    await updateExecution(executionId, (execution) => ({
      ...execution,
      status: "succeeded",
      finishedAt,
      durationMs:
        execution.startedAt
          ? Date.now() - new Date(execution.startedAt).getTime()
          : undefined,
      currentStep: task.steps.length,
      logs,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateExecution(executionId, (execution) => ({
      ...execution,
      status: "failed",
      finishedAt: new Date().toISOString(),
      durationMs:
        execution.startedAt
          ? Date.now() - new Date(execution.startedAt).getTime()
          : undefined,
      error: message,
    }));
  }
}

async function drainQueue(): Promise<void> {
  const queue = runtime();
  if (queue.draining) return;
  queue.draining = true;

  try {
    for (;;) {
      const pending = (await listExecutions())
        .filter((execution) => execution.status === "queued")
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
      const available = queue.concurrency - queue.running.size;
      if (!pending.length || available <= 0) return;

      const batch = pending.slice(0, available);
      for (const execution of batch) {
        const promise = runOne(execution.id)
          .catch(() => undefined)
          .finally(() => {
            queue.running.delete(promise);
            // 每个任务完成后立刻补位，保持吞吐稳定。
            void drainQueue();
          });
        queue.running.add(promise);
      }
    }
  } finally {
    queue.draining = false;
  }
}

export async function enqueueExecution(
  taskId: string,
): Promise<TaskExecution> {
  const task = await getTask(taskId);
  if (!task) throw new Error("任务不存在");

  const execution: TaskExecution = {
    id: crypto.randomUUID(),
    taskId,
    status: "queued",
    queuedAt: new Date().toISOString(),
    totalSteps: task.steps.length,
    logs: [],
  };
  await saveExecution(execution);
  void drainQueue();
  return execution;
}

/**
 * 任务删除前先请求取消当前任务的所有活动执行。
 * 运行中执行会在步骤边界失败；排队执行由 runOne 发现任务缺失后标记失败。
 */
export async function cancelTaskExecutions(taskId: string): Promise<void> {
  const executions = await listExecutions();
  executions
    .filter(
      (execution) =>
        execution.taskId === taskId &&
        (execution.status === "queued" || execution.status === "running"),
    )
    .forEach((execution) => requestExecutionCancel(execution.id));
}

export async function queueSnapshot() {
  const executions = await listExecutions();
  const queue = runtime();
  return {
    concurrency: queue.concurrency,
    running: queue.running.size || executions.filter((item) => item.status === "running").length,
    queued: executions.filter((item) => item.status === "queued").length,
    limits: { min: 1, max: 10 } as const,
  };
}
