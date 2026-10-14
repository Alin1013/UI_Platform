/**
 * 进程内任务调度器。
 * 单机部署时全局运行集合能精确限制并发；如果改为多进程，应替换为 BullMQ/Redis。
 */

import type {
  ExecutionStatus,
  TaskExecution,
  TestEnvironment,
  WorkflowNode,
} from "./types";
import type { RunnerArtifacts } from "./executor";
import {
  getEnvironment,
  getExecution,
  getTask,
  getWorkflow,
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

  const runner = task.runner ?? "playwright";
  const browser = task.runtime?.browser ?? "chromium";
  const maxAttempts = Math.min(4, Math.max(1, (task.runtime?.retries ?? 0) + 1));
  let artifacts: RunnerArtifacts = {};

  // 执行前解析一次环境；环境被删除时回退到全局 UI_PLATFORM_BASE_URL。
  let environment: TestEnvironment | undefined;
  if (task.environmentId) {
    environment = (await getEnvironment(task.environmentId)) ?? undefined;
  }

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let logs: TaskExecution["logs"] = [];
      try {
        logs = await executeWebTask(task, executionId, {
          attempt,
          environment,
          onStepLog: async (log) => {
            // 增量写入让 UI 轮询到每步结果；失败时后续更新只补最终状态，不覆盖这些日志。
            await updateExecution(executionId, (execution) => ({
              ...execution,
              logs: [...execution.logs, log],
              currentStep: log.index,
            }));
          },
          onArtifacts: async (nextArtifacts) => {
            artifacts = nextArtifacts;
            await updateExecution(executionId, (execution) => ({
              ...execution,
              ...nextArtifacts,
            }));
          },
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
          runner,
          browser,
          attempts: attempt,
          durationMs:
            execution.startedAt
              ? Date.now() - new Date(execution.startedAt).getTime()
              : undefined,
          currentStep: task.steps.length,
          logs,
        }));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 任务取消不是瞬态失败，重试只会延长用户等待；其他失败按配置进行有限重试。
        const shouldRetry =
          attempt < maxAttempts && !message.includes("任务已删除，执行已取消");
        if (shouldRetry) {
          await updateExecution(executionId, (execution) => ({
            ...execution,
            attempts: attempt,
            // 旧尝试的截图文件会被下一次尝试复用；保留完整多 attempt 历史需要报告存储升级。
            logs: [],
            currentStep: 0,
            error: `第 ${attempt} 次尝试失败，准备重试：${message}`,
          }));
          continue;
        }

        const finishedAt = new Date().toISOString();
        await updateExecution(executionId, (execution) => ({
          ...execution,
          status: "failed",
          finishedAt,
          runner,
          browser,
          attempts: attempt,
          durationMs:
            execution.startedAt
              ? Date.now() - new Date(execution.startedAt).getTime()
              : undefined,
          error: message,
        }));
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateExecution(executionId, (execution) => ({
      ...execution,
      status: "failed",
      finishedAt: new Date().toISOString(),
      runner,
      browser,
      ...artifacts,
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
        // 流程父执行由专用编排器控制；普通调度器只领取真正的单用例子执行。
        .filter(
          (execution) =>
            execution.status === "queued" && execution.kind !== "workflow",
        )
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
  workflow?: Pick<
    TaskExecution,
    "workflowId" | "workflowName" | "workflowKind" | "workflowExecutionId" | "workflowOrder"
  >,
): Promise<TaskExecution> {
  const task = await getTask(taskId);
  if (!task) throw new Error("任务不存在");

  const execution: TaskExecution = {
    id: crypto.randomUUID(),
    taskId,
    kind: "task",
    runner: task.runner ?? "playwright",
    browser: task.runtime?.browser ?? "chromium",
    status: "queued",
    queuedAt: new Date().toISOString(),
    totalSteps: task.steps.length,
    logs: [],
    ...workflow,
  };
  await saveExecution(execution);
  void drainQueue();
  return execution;
}

/** 将任意层级的组合节点展开为单用例序列，同时阻止循环引用。 */
async function expandWorkflowTasks(workflowId: string, stack: string[] = []): Promise<string[]> {
  if (stack.includes(workflowId)) {
    throw new Error("工作流存在循环引用，请调整节点后重试");
  }
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error("引用的组合不存在，请编辑工作流");
  const nodes: WorkflowNode[] = workflow.nodes ?? workflow.taskIds.map((taskId) => ({ type: "task", taskId }));
  const tasks: string[] = [];
  for (const node of nodes) {
    if (node.type === "task") tasks.push(node.taskId);
    else tasks.push(...(await expandWorkflowTasks(node.workflowId, [...stack, workflowId])));
  }
  return tasks;
}

/** 组合父执行不进普通并发队列；这里的 Promise 就是该流程的串行编排器。 */
async function runWorkflow(parentExecutionId: string): Promise<void> {
  const started = await updateExecution(parentExecutionId, (execution) => {
    if (execution.status !== "queued") return execution;
    return {
      ...execution,
      status: "running",
      startedAt: new Date().toISOString(),
    };
  });
  if (!started || started.status !== "running") return;

  // 每个用例开始前都读取父执行，保证取消信号能在步骤间隙生效。
  for (const [order, taskId] of started.workflowTaskIds?.entries() ?? []) {
    const parent = await getExecution(parentExecutionId);
    if (!parent || parent.status !== "running") return;

    const task = await getTask(taskId);
    if (!task) {
      await finalizeWorkflow(
        parentExecutionId,
        "failed",
        `第 ${order + 1} 个用例不存在或已被删除`,
      );
      return;
    }

    const child = await enqueueExecution(task.id, {
      workflowId: parent.workflowId,
      workflowName: parent.workflowName,
      workflowKind: parent.workflowKind,
      workflowExecutionId: parent.id,
      workflowOrder: order,
    });
    await updateExecution(parentExecutionId, (execution) => ({
      ...execution,
      // 用例内部步骤由子执行展示；父进度表示已派发到第几个用例。
      currentStep: order + 1,
    }));
    const result = await waitForExecution(child.id);

    if (result.status === "succeeded") continue;
    await finalizeWorkflow(
      parentExecutionId,
      result.status === "interrupted" ? "interrupted" : "failed",
      result.error
        ? `第 ${order + 1} 个用例失败：${result.error}`
        : `第 ${order + 1} 个用例未通过`,
    );
    return;
  }

  await finalizeWorkflow(parentExecutionId, "succeeded");
}

/** 收口父执行；子用例保留自己的错误详情，父层只补充流程级失败原因。 */
async function finalizeWorkflow(
  executionId: string,
  status: Extract<ExecutionStatus, "succeeded" | "failed" | "interrupted">,
  error?: string,
): Promise<void> {
  await updateExecution(executionId, (execution) => ({
    ...execution,
    status,
    finishedAt: new Date().toISOString(),
    durationMs: execution.startedAt
      ? Date.now() - new Date(execution.startedAt).getTime()
      : undefined,
    error,
  }));
}

/**
 * 子执行由普通调度器接管后，编排器通过状态轮询等待完成。
 * 单机控制面的轮询频率与执行详情页一致，实现比回调注册表更抗模块热更新。
 */
async function waitForExecution(executionId: string): Promise<TaskExecution> {
  for (;;) {
    const execution = await getExecution(executionId);
    if (!execution) {
      return { ...placeholderExecution(executionId), status: "failed", error: "执行记录丢失" };
    }
    if (execution.status !== "queued" && execution.status !== "running") {
      return execution;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** 轮询期间执行记录意外丢失时，给流程编排器一个可处理的失败结果。 */
function placeholderExecution(executionId: string): TaskExecution {
  return {
    id: executionId,
    taskId: "",
    kind: "task",
    status: "failed",
    queuedAt: new Date().toISOString(),
    totalSteps: 0,
    logs: [],
  };
}

export async function enqueueWorkflowExecution(
  workflowId: string,
): Promise<TaskExecution> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error("流程组合不存在");

  const executions = await listExecutions();
  if (
    executions.some(
      (execution) =>
        execution.kind === "workflow" &&
        execution.workflowId === workflowId &&
        (execution.status === "queued" || execution.status === "running"),
    )
  ) {
    throw new Error("该流程组合正在执行中");
  }

  const taskIds = await expandWorkflowTasks(workflowId);
  // 逐个检查用例存在性；数量上限 20，不会形成有意义的调度开销。
  const taskPresence = await Promise.all(
    taskIds.map(async (taskId) => Boolean(await getTask(taskId))),
  );
  if (taskPresence.some((exists) => !exists)) {
    throw new Error("组合中存在已删除的用例，请编辑后重新运行");
  }

  const execution: TaskExecution = {
    id: crypto.randomUUID(),
    taskId: "",
    kind: "workflow",
    workflowId,
    workflowName: workflow.name,
    workflowKind: workflow.kind ?? "composition",
    workflowTaskIds: taskIds,
    status: "queued",
    queuedAt: new Date().toISOString(),
    totalSteps: taskIds.length,
    logs: [],
  };
  await saveExecution(execution);
  void runWorkflow(execution.id);
  return execution;
}

/** 测试工作流与普通组合共享报告和调度状态机，只在定义展开时增加组合引用。 */
export async function enqueueTestWorkflowExecution(
  workflowId: string,
): Promise<TaskExecution> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow || workflow.kind !== "test-workflow") {
    throw new Error("测试工作流不存在");
  }
  const executions = await listExecutions();
  if (executions.some((execution) =>
    execution.kind === "workflow" && execution.workflowId === workflowId &&
    (execution.status === "queued" || execution.status === "running"))) {
    throw new Error("该测试工作流正在执行中");
  }
  const taskIds = await expandWorkflowTasks(workflowId);
  if (!taskIds.length) throw new Error("测试工作流没有可执行用例");
  if (taskIds.length > 100) throw new Error("展开后的测试工作流最多执行 100 个用例");
  const taskPresence = await Promise.all(taskIds.map(async (taskId) => Boolean(await getTask(taskId))));
  if (taskPresence.some((exists) => !exists)) {
    throw new Error("工作流中存在已删除的用例，请编辑后重新运行");
  }
  const execution: TaskExecution = {
    id: crypto.randomUUID(),
    taskId: "",
    kind: "workflow",
    workflowId,
    workflowName: workflow.name,
    workflowKind: "test-workflow",
    workflowTaskIds: taskIds,
    status: "queued",
    queuedAt: new Date().toISOString(),
    totalSteps: taskIds.length,
    logs: [],
  };
  await saveExecution(execution);
  void runWorkflow(execution.id);
  return execution;
}

/** 取消父执行同时取消当前子执行；排队中的后续用例会在编排器检查后跳过。 */
export async function cancelWorkflowExecution(
  workflowExecutionId: string,
): Promise<void> {
  const executions = await listExecutions();
  const parent = executions.find(
    (execution) =>
      execution.id === workflowExecutionId &&
      execution.kind === "workflow" &&
      (execution.status === "queued" || execution.status === "running"),
  );
  if (!parent) return;

  executions
    .filter(
      (execution) =>
        execution.workflowExecutionId === workflowExecutionId &&
        (execution.status === "queued" || execution.status === "running"),
    )
    .forEach((execution) => requestExecutionCancel(execution.id));
  await finalizeWorkflow(workflowExecutionId, "interrupted", "流程已被取消");
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
