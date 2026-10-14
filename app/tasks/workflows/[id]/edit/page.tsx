/** 独立编辑组合页：从 URL 加载组合和用例，刷新或深链接都能恢复画布。 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { WorkflowBuilder } from "@/components/WorkflowBuilder";
import { loadTasks, loadWorkflows } from "@/lib/client";
import type { AutomationTask, TestWorkflow } from "@/lib/types";
import styles from "../../../tasks.module.css";

/** 两个请求完成前不渲染可编辑画布，避免用户看到不完整的执行链。 */
export default function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [workflow, setWorkflow] = useState<TestWorkflow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([loadTasks(), loadWorkflows()])
      .then(([taskPayload, workflowPayload]) => {
        if (!active) return;
        setTasks(taskPayload.tasks);
        const current = workflowPayload.workflows.find((item) => item.id === id);
        if (!current) setError("流程组合不存在或已被删除");
        else setWorkflow(current);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "加载组合失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>编辑组合</h1>
          <p>{workflow?.name ?? "调整算子顺序和组合说明。"}</p>
        </div>
        <Link className="button" href="/tasks/workflows">返回组合列表</Link>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {loading ? (
        <div className="empty" role="status">正在加载组合…</div>
      ) : workflow ? (
        <WorkflowBuilder
          key={workflow.id}
          tasks={tasks}
          workflow={workflow}
          onSaved={() => router.push("/tasks/workflows")}
          onCancel={() => router.push("/tasks/workflows")}
        />
      ) : null}
    </>
  );
}
