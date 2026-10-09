/**
 * 文件持久化层。
 * MVP 使用 JSON 降低部署依赖；数据写入串行化，避免多个 API 请求互相覆盖。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AutomationTask,
  PlatformState,
  TaskExecution,
} from "./types";

const dataDir = path.join(process.cwd(), "data");
const stateFile = path.join(dataDir, "platform.json");

/** 所有读改写操作进入同一条 Promise 链，保证单进程内的顺序一致性。 */
let mutationChain: Promise<unknown> = Promise.resolve();
/** 只在进程首次读取时恢复异常停机状态；后续读取不能打断活动任务。 */
let recoveryDone = false;

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
}

function emptyState(): PlatformState {
  return { version: 1, tasks: [], executions: [] };
}

async function readState(): Promise<PlatformState> {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw) as PlatformState;
    if (!recoveryDone) {
      recoveryDone = true;
      // 兼容异常停机：queued/running 状态无法跨进程恢复，统一标记为 interrupted。
      parsed.executions = (parsed.executions ?? []).map((execution) =>
        execution.status === "running" || execution.status === "queued"
          ? { ...execution, status: "interrupted", error: "服务重启导致执行中断" }
          : execution,
      );
      if (parsed.executions.some((execution) => execution.status === "interrupted")) {
        await writeState(parsed);
      }
    }
    return parsed;
  } catch {
    recoveryDone = true;
    return emptyState();
  }
}

async function writeState(state: PlatformState): Promise<void> {
  await ensureDataDir();
  const tempFile = `${stateFile}.${randomUUID()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempFile, stateFile);
}

function mutate<T>(operation: (state: PlatformState) => Promise<T> | T) {
  const result = mutationChain.then(async () => {
    const state = await readState();
    const output = await operation(state);
    await writeState(state);
    return output;
  });
  // 失败不能污染后续请求，但调用方仍会拿到原始错误。
  mutationChain = result.catch(() => undefined);
  return result;
}

export function newId(): string {
  return randomUUID();
}

export function listTasks(): Promise<AutomationTask[]> {
  return readState().then((state) => state.tasks);
}

export function getTask(id: string): Promise<AutomationTask | undefined> {
  return readState().then((state) => state.tasks.find((task) => task.id === id));
}

export function saveTask(task: AutomationTask): Promise<AutomationTask> {
  return mutate((state) => {
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index === -1) state.tasks.push(task);
    else state.tasks[index] = task;
    return task;
  });
}

export function deleteTask(id: string): Promise<boolean> {
  return mutate((state) => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((task) => task.id !== id);
    return state.tasks.length !== before;
  });
}

export function listExecutions(): Promise<TaskExecution[]> {
  return readState().then((state) =>
    [...state.executions].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)),
  );
}

export function getExecution(
  id: string,
): Promise<TaskExecution | undefined> {
  return readState().then(
    (state) => state.executions.find((execution) => execution.id === id),
  );
}

export function saveExecution(execution: TaskExecution): Promise<TaskExecution> {
  return mutate((state) => {
    const index = state.executions.findIndex(
      (item) => item.id === execution.id,
    );
    if (index === -1) state.executions.push(execution);
    else state.executions[index] = execution;
    return execution;
  });
}

export function updateExecution(
  id: string,
  updater: (execution: TaskExecution) => TaskExecution,
): Promise<TaskExecution | undefined> {
  return mutate((state) => {
    const execution = state.executions.find((item) => item.id === id);
    if (!execution) return undefined;
    Object.assign(execution, updater(execution));
    return execution;
  });
}

export async function summarize(): Promise<{
  taskCount: number;
  executionCount: number;
  succeeded: number;
  failed: number;
  queued: number;
  running: number;
  averageDurationMs: number;
}> {
  const state = await readState();
  const completed = state.executions.filter(
    (execution) =>
      execution.status === "succeeded" || execution.status === "failed",
  );
  const durations = completed
    .map((execution) => execution.durationMs ?? 0)
    .filter((duration) => duration > 0);
  return {
    taskCount: state.tasks.length,
    executionCount: state.executions.length,
    succeeded: state.executions.filter((item) => item.status === "succeeded")
      .length,
    failed: state.executions.filter((item) => item.status === "failed").length,
    queued: state.executions.filter((item) => item.status === "queued").length,
    running: state.executions.filter((item) => item.status === "running")
      .length,
    averageDurationMs: durations.length
      ? Math.round(
          durations.reduce((total, duration) => total + duration, 0) /
            durations.length,
        )
      : 0,
  };
}
