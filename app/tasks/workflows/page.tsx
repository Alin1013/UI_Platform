/** 独立组合页：保留用例选择、排序、执行与重试，避免干扰单用例创建和列表。 */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import {
  loadTasks,
  loadWorkflows,
  loadExecutions,
  retryExecution,
} from "@/lib/client";
import { latestExecutionsByDefinition } from "@/lib/task-executions";
import { WorkflowManager } from "@/components/WorkflowManager";
import styles from "../tasks.module.css";

/** 组合状态只采用父执行，子用例的独立结果不会污染组合重试入口。 */
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
  /** 重试重建组合父执行，保持原报告不可变。 */
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
          <p>将已有用例按业务顺序串联，任一失败即停止后续用例。</p>
        </div>
        <Link className="button" href="/tasks/list">
          查看用例列表
        </Link>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="empty" role="status">
          正在加载组合…
        </div>
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
