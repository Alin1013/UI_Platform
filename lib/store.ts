/**
 * 数据持久化层。
 * 使用 SQLite（better-sqlite3 + drizzle-orm）替代 JSON 文件；
 * 对上层保持与 v0.3 完全一致的 API 签名，调用方无需改动。
 */

import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  environments as environmentsTable,
  executions as executionsTable,
  tasks as tasksTable,
  workflows as workflowsTable,
} from "./db/schema";
import type {
  AutomationTask,
  TaskExecution,
  TestEnvironment,
  TestWorkflow,
} from "./types";

/**
 * 服务重启后恢复异常停机状态。
 * queued/running 无法跨进程继续，统一标记为 interrupted。
 * Next 开发模式可能为不同路由生成多个 store 模块实例；恢复判定必须挂在
 * globalThis 上，否则某个路由的首次加载会把另一个路由正在执行的浏览器流程误杀。
 */
async function recoverInterruptedExecutions(): Promise<void> {
  const active = await db
    .select({ id: executionsTable.id })
    .from(executionsTable)
    .where(eq(executionsTable.status, "queued"));
  const running = await db
    .select({ id: executionsTable.id })
    .from(executionsTable)
    .where(eq(executionsTable.status, "running"));
  for (const row of [...active, ...running]) {
    await db
      .update(executionsTable)
      .set({ status: "interrupted", error: "服务重启导致执行中断" })
      .where(eq(executionsTable.id, row.id));
  }
}

const globalStore = globalThis as typeof globalThis & {
  __uiAutomationRecovery?: Promise<void>;
};

// 同一进程只允许一次停机恢复；不同模块实例复用同一个 Promise 等待恢复完成。
globalStore.__uiAutomationRecovery ??= recoverInterruptedExecutions();
const recoveryPromise = globalStore.__uiAutomationRecovery;
export function newId(): string {
  return randomUUID();
}

export async function listEnvironments(): Promise<TestEnvironment[]> {
  const rows = await db.select().from(environmentsTable);
  return rows as TestEnvironment[];
}

export async function getEnvironment(
  id: string,
): Promise<TestEnvironment | undefined> {
  const rows = await db
    .select()
    .from(environmentsTable)
    .where(eq(environmentsTable.id, id))
    .limit(1);
  return (rows[0] as TestEnvironment) ?? undefined;
}

export async function saveEnvironment(
  environment: TestEnvironment,
): Promise<TestEnvironment> {
  await db
    .insert(environmentsTable)
    .values(environment)
    .onConflictDoUpdate({
      target: environmentsTable.id,
      set: {
        name: environment.name,
        baseUrl: environment.baseUrl,
        username: environment.username,
        password: environment.password,
        updatedAt: environment.updatedAt,
      },
    });
  return environment;
}

export async function deleteEnvironment(id: string): Promise<boolean> {
  const result = await db
    .delete(environmentsTable)
    .where(eq(environmentsTable.id, id))
    .returning({ id: environmentsTable.id });
  return result.length > 0;
}

/** drizzle 返回的行结构与领域模型字段名一致，直接断言即可；不需要额外映射层。 */
export async function listTasks(): Promise<AutomationTask[]> {
  await recoveryPromise;
  const rows = await db.select().from(tasksTable);
  return rows as AutomationTask[];
}

export async function getTask(id: string): Promise<AutomationTask | undefined> {
  await recoveryPromise;
  const rows = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, id))
    .limit(1);
  return (rows[0] as AutomationTask) ?? undefined;
}

export async function saveTask(task: AutomationTask): Promise<AutomationTask> {
  await recoveryPromise;
  // insert ... onConflictDoUpdate 实现 upsert，不区分创建和更新两个调用路径。
  await db
    .insert(tasksTable)
    .values(task)
    .onConflictDoUpdate({
      target: tasksTable.id,
      set: {
        name: task.name,
        target: task.target,
        runner: task.runner,
        runtime: task.runtime,
        description: task.description,
        labels: task.labels,
        headless: task.headless,
        steps: task.steps,
        updatedAt: task.updatedAt,
        aiContexts: task.aiContexts,
      },
    });
  return task;
}

export async function deleteTask(id: string): Promise<boolean> {
  await recoveryPromise;
  const result = await db
    .delete(tasksTable)
    .where(eq(tasksTable.id, id))
    .returning({ id: tasksTable.id });
  return result.length > 0;
}

/** 列出全部组合；数量属于管理界面规模，无需分页抽象。 */
export async function listWorkflows(): Promise<TestWorkflow[]> {
  await recoveryPromise;
  const rows = await db.select().from(workflowsTable);
  return rows as TestWorkflow[];
}

/** 按 ID 读取组合；运行前会继续校验引用的单用例。 */
export async function getWorkflow(
  id: string,
): Promise<TestWorkflow | undefined> {
  await recoveryPromise;
  const rows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, id))
    .limit(1);
  return (rows[0] as TestWorkflow) ?? undefined;
}

/** 组合 upsert；版本字段由调用方写入，避免这里混入业务时间语义。 */
export async function saveWorkflow(
  workflow: TestWorkflow,
): Promise<TestWorkflow> {
  await recoveryPromise;
  await db
    .insert(workflowsTable)
    .values(workflow)
    .onConflictDoUpdate({
      target: workflowsTable.id,
      set: {
        name: workflow.name,
        description: workflow.description,
        kind: workflow.kind ?? "composition",
        taskIds: workflow.taskIds,
        nodes: workflow.nodes,
        updatedAt: workflow.updatedAt,
      },
    });
  return workflow;
}

/** 删除组合定义；执行记录保持历史不可变。 */
export async function deleteWorkflow(id: string): Promise<boolean> {
  await recoveryPromise;
  const result = await db
    .delete(workflowsTable)
    .where(eq(workflowsTable.id, id))
    .returning({ id: workflowsTable.id });
  return result.length > 0;
}

export async function listExecutions(): Promise<TaskExecution[]> {
  await recoveryPromise;
  // 按入队时间倒序，与 JSON 版本的排序语义一致。
  const rows = await db
    .select()
    .from(executionsTable)
    .orderBy(desc(executionsTable.queuedAt));
  return rows as TaskExecution[];
}

export async function getExecution(
  id: string,
): Promise<TaskExecution | undefined> {
  await recoveryPromise;
  const rows = await db
    .select()
    .from(executionsTable)
    .where(eq(executionsTable.id, id))
    .limit(1);
  return (rows[0] as TaskExecution) ?? undefined;
}

/** 删除校验失败保留 HTTP 语义，单条和批量接口共享相同的边界。 */
export class ExecutionDeletionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** 原子删除已结束执行；组合父记录级联子记录，活动组合的任一成员都受到保护。 */
export async function deleteExecutions(ids: string[]): Promise<string[]> {
  await recoveryPromise;
  return db.transaction((transaction) => {
    // 同步事务内完成查找、校验和删除，避免批量失败时已经删掉部分记录。
    const all = transaction.select().from(executionsTable).all() as TaskExecution[];
    const requestedIds = new Set(ids);
    if (!requestedIds.size) {
      throw new ExecutionDeletionError("请选择要删除的执行记录", 400);
    }
    if ([...requestedIds].some((id) => !all.some((item) => item.id === id))) {
      throw new ExecutionDeletionError("执行记录不存在，请刷新后重试", 404);
    }
    const workflowIds = new Set(
      all.filter((item) => requestedIds.has(item.id) && item.kind === "workflow")
        .map((item) => item.id),
    );
    const targets = all.filter((item) => requestedIds.has(item.id) ||
      Boolean(item.workflowExecutionId && workflowIds.has(item.workflowExecutionId)));
    const affectedWorkflowIds = new Set(targets.map((item) => item.workflowExecutionId ?? item.id));
    const hasActiveExecution = all.some((item) =>
      (item.status === "queued" || item.status === "running") &&
      (affectedWorkflowIds.has(item.id) ||
        Boolean(item.workflowExecutionId && affectedWorkflowIds.has(item.workflowExecutionId))));
    if (hasActiveExecution) {
      throw new ExecutionDeletionError("排队中或执行中的记录及其流程记录不能删除，请等待执行结束", 409);
    }
    const deleted = transaction.delete(executionsTable)
      .where(inArray(executionsTable.id, targets.map((item) => item.id)))
      .returning({ id: executionsTable.id }).all();
    return deleted.map((item) => item.id);
  });
}

export async function saveExecution(
  execution: TaskExecution,
): Promise<TaskExecution> {
  await recoveryPromise;
  await db.insert(executionsTable).values(execution).onConflictDoUpdate({
    target: executionsTable.id,
    set: {
      kind: execution.kind,
      workflowId: execution.workflowId,
      workflowName: execution.workflowName,
      workflowKind: execution.workflowKind,
      workflowTaskIds: execution.workflowTaskIds,
      workflowExecutionId: execution.workflowExecutionId,
      workflowOrder: execution.workflowOrder,
      runner: execution.runner,
      browser: execution.browser,
      status: execution.status,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      durationMs: execution.durationMs,
      attempts: execution.attempts,
      currentStep: execution.currentStep,
      logs: execution.logs,
      reportUrl: execution.reportUrl,
      tracePath: execution.tracePath,
      healing: execution.healing,
      error: execution.error,
    },
  });
  return execution;
}

export async function updateExecution(
  id: string,
  updater: (execution: TaskExecution) => TaskExecution,
): Promise<TaskExecution | undefined> {
  await recoveryPromise;
  const current = await getExecution(id);
  if (!current) return undefined;
  const next = updater(current);
  // 读取后记录可能被删除；更新只能命中现有行，不能通过 upsert 复活旧日志或修复请求。
  const rows = await db.update(executionsTable).set(next)
    .where(eq(executionsTable.id, id)).returning();
  return (rows[0] as TaskExecution) ?? undefined;
}

/** 仪表盘统计；用 SQL 聚合替代 JSON 版本的全量读取。 */
export async function summarize(): Promise<{
  taskCount: number;
  executionCount: number;
  succeeded: number;
  failed: number;
  queued: number;
  running: number;
  averageDurationMs: number;
}> {
  await recoveryPromise;

  const allTasks = await db.select({ id: tasksTable.id }).from(tasksTable);
  const allExecutions = await db
    .select({ status: executionsTable.status, durationMs: executionsTable.durationMs })
    .from(executionsTable);

  const completed = allExecutions.filter(
    (e) => e.status === "succeeded" || e.status === "failed",
  );
  const durations = completed
    .map((e) => e.durationMs ?? 0)
    .filter((d) => d > 0);

  return {
    taskCount: allTasks.length,
    executionCount: allExecutions.length,
    succeeded: allExecutions.filter((e) => e.status === "succeeded").length,
    failed: allExecutions.filter((e) => e.status === "failed").length,
    queued: allExecutions.filter((e) => e.status === "queued").length,
    running: allExecutions.filter((e) => e.status === "running").length,
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : 0,
  };
}
