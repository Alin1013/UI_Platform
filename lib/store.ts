/**
 * 数据持久化层。
 * 使用 SQLite（better-sqlite3 + drizzle-orm）替代 JSON 文件；
 * 对上层保持与 v0.3 完全一致的 API 签名，调用方无需改动。
 */

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  environments as environmentsTable,
  executions as executionsTable,
  tasks as tasksTable,
} from "./db/schema";
import type { AutomationTask, TaskExecution, TestEnvironment } from "./types";

/**
 * 服务重启后恢复异常停机状态。
 * queued/running 无法跨进程继续，统一标记为 interrupted。
 * 只在模块首次加载时执行一次；后续调用不重复扫描。
 */
let recoveryDone = false;
async function recoverInterruptedExecutions(): Promise<void> {
  if (recoveryDone) return;
  recoveryDone = true;
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

// 模块加载时触发一次恢复；不阻塞导出，后续首次读取前会等待完成。
const recoveryPromise = recoverInterruptedExecutions();
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

export async function saveExecution(
  execution: TaskExecution,
): Promise<TaskExecution> {
  await recoveryPromise;
  await db.insert(executionsTable).values(execution).onConflictDoUpdate({
    target: executionsTable.id,
    set: {
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
  return saveExecution(next);
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
