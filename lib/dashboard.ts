/** 仪表盘口径：当前用例按最新调度记录去重，图表、指标和列表共用同一份快照。 */
import { latestExecutionsByDefinition } from "./task-executions";
import type { ExecutionStatus, TaskExecution, AutomationTask } from "./types";

/** 组合父执行和已删除用例的历史不计入当前用例统计；组合子执行仍代表实际用例结果。 */
export function summarizeLatestTasks(
  tasks: AutomationTask[],
  executions: TaskExecution[],
) {
  const latestByTask = latestExecutionsByDefinition(executions, "task");
  const latest = tasks
    .flatMap((task) => (latestByTask[task.id] ? [latestByTask[task.id]] : []))
    .sort((first, second) => second.queuedAt.localeCompare(first.queuedAt));
  const counts: Record<ExecutionStatus | "notRun", number> = {
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    queued: 0,
    notRun: tasks.length - latest.length,
  };
  for (const execution of latest) counts[execution.status] += 1;
  // 已中断属于结束但未通过；排队、执行中和未执行尚无结果，不作为通过率分母。
  const completed = latest.filter((execution) =>
    ["succeeded", "failed", "interrupted"].includes(execution.status),
  );
  const durations = completed.flatMap((execution) =>
    execution.durationMs == null ? [] : [execution.durationMs],
  );
  return {
    taskCount: tasks.length,
    counts,
    latest,
    passRate: completed.length
      ? Math.round((counts.succeeded / completed.length) * 1000) / 10
      : 0,
    averageDurationMs: durations.length
      ? Math.round(
          durations.reduce((sum, duration) => sum + duration, 0) /
            durations.length,
        )
      : undefined,
  };
}
