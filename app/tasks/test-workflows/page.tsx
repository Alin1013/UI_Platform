/** 测试工作流管理页：列表、最近执行与手动重试入口各自独立于画布编辑。 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import { loadExecutions, loadTasks, loadWorkflows, retryExecution } from "@/lib/client";
import { latestExecutionsByDefinition } from "@/lib/task-executions";
import { TestWorkflowManager } from "@/components/TestWorkflowManager";
import styles from "../tasks.module.css";

/** 只把测试工作流定义送入管理器，组合列表保留在另一个页面。 */
export default function TestWorkflowsPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [workflows, setWorkflows] = useState<TestWorkflow[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [taskPayload, workflowPayload, executionPayload] = await Promise.all([loadTasks(), loadWorkflows(), loadExecutions()]);
    setTasks(taskPayload.tasks);
    setWorkflows(workflowPayload.workflows);
    setExecutions(executionPayload.executions);
  }, []);

  useEffect(() => {
    refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "加载测试工作流失败"))
      .finally(() => setLoading(false));
  }, [refresh]);

  const testWorkflows = workflows.filter((workflow) => workflow.kind === "test-workflow");
  const compositions = workflows.filter((workflow) => workflow.kind !== "test-workflow");
  const latest = useMemo(() => latestExecutionsByDefinition(executions, "workflow"), [executions]);

  async function retry(workflow: TestWorkflow) {
    const execution = latest[workflow.id];
    if (!execution) throw new Error("测试工作流还没有可重试的执行");
    const payload = await retryExecution(execution.id);
    router.push(`/executions?focus=${payload.execution.id}`);
  }

  return <>
    <div className={styles.heading}>
      <div><h1>测试工作流</h1><p>把多个用例或组合测试流串成一条有序的回归执行链。</p></div>
      <Link className="button" href="/tasks/workflows">组合管理</Link>
    </div>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {loading ? <div className="empty" role="status">正在加载测试工作流…</div> : !error ? <TestWorkflowManager
      tasks={tasks}
      compositions={compositions}
      workflows={testWorkflows}
      latestExecutions={latest}
      onRetryWorkflow={retry}
      onSaved={refresh}
    /> : null}
  </>;
}
