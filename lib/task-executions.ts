/** 管理页按定义归组执行历史，避免组合父结果与单用例结果互相覆盖。 */
import type { TaskExecution } from "./types";

/** queuedAt 是调度顺序来源；ISO 时间字符串可直接比较，无需依赖接口排序。 */
export function latestExecutionsByDefinition(
  executions: TaskExecution[],
  kind: "task" | "workflow",
) {
  const latest: Record<string, TaskExecution> = {};
  for (const execution of executions) {
    const isWorkflow = execution.kind === "workflow";
    if (isWorkflow !== (kind === "workflow")) continue;
    const id = isWorkflow ? execution.workflowId : execution.taskId;
    if (id && (!latest[id] || execution.queuedAt > latest[id].queuedAt))
      latest[id] = execution;
  }
  return latest;
}
