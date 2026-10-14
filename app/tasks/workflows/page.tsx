/** 组合管理一级页面只展示组合列表，编辑动作进入独立的算子画布路由。 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import { loadExecutions, loadTasks, loadWorkflows, retryExecution } from "@/lib/client";
import { latestExecutionsByDefinition } from "@/lib/task-executions";
import { WorkflowManager } from "@/components/WorkflowManager";
import styles from "../tasks.module.css";

/** 列表页的重试只使用组合父执行，子用例结果不会污染组合入口。 */
export default function WorkflowsPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [workflows, setWorkflows] = useState<TestWorkflow[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [taskPayload, workflowPayload, executionPayload] = await Promise.all([
      loadTasks(),
      loadWorkflows(),
      loadExecutions(),
    ]);
    setTasks(taskPayload.tasks);
    setWorkflows(workflowPayload.workflows);
    setExecutions(executionPayload.executions);
  }, []);

  useEffect(() => {
    refresh()
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "加载组合失败"),
      )
      .finally(() => setLoading(false));
  }, [refresh]);

  const latest = useMemo(
    () => latestExecutionsByDefinition(executions, "workflow"),
    [executions],
  );

  async function retry(workflow: TestWorkflow) {
    const execution = latest[workflow.id];
    if (!execution) throw new Error("流程组合还没有可重试的执行");
    const payload = await retryExecution(execution.id);
    router.push(`/executions?focus=${payload.execution.id}`);
  }

  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>组合管理</h1>
          <p>管理已保存的业务流程组合，运行顺序在算子画布中维护。</p>
        </div>
        <Link className="button" href="/tasks/list">
          查看用例列表
        </Link>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {loading ? (
        <div className="empty" role="status">正在加载组合…</div>
      ) : !error ? (
        <WorkflowManager
          tasks={tasks}
          workflows={workflows}
          latestExecutions={latest}
          onRetryWorkflow={retry}
          onSaved={refresh}
        />
      ) : null}
    </>
  );
}
