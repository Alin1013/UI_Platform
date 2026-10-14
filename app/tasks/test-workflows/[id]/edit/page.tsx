/** 编辑测试工作流：深链接直接恢复原节点顺序，不依赖先打开列表页。 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { TestWorkflowBuilder } from "@/components/TestWorkflowBuilder";
import { loadTasks, loadWorkflows } from "@/lib/client";
import type { AutomationTask, TestWorkflow } from "@/lib/types";
import styles from "../../../tasks.module.css";

/** 编辑页等候完整节点目录加载后再挂载画布，避免名称短暂显示为未知。 */
export default function EditTestWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [compositions, setCompositions] = useState<TestWorkflow[]>([]);
  const [workflow, setWorkflow] = useState<TestWorkflow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([loadTasks(), loadWorkflows()]).then(([taskPayload, workflowPayload]) => {
      if (!active) return;
      setTasks(taskPayload.tasks);
      setCompositions(workflowPayload.workflows.filter((item) => item.kind !== "test-workflow"));
      const current = workflowPayload.workflows.find((item) => item.id === id && item.kind === "test-workflow");
      if (!current) setError("测试工作流不存在或已被删除");
      else setWorkflow(current);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "加载测试工作流失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  return <>
    <div className={styles.heading}><div><h1>编辑测试工作流</h1><p>{workflow?.name ?? "调整工作流节点和执行顺序。"}</p></div><Link className="button" href="/tasks/test-workflows">返回工作流列表</Link></div>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {loading ? <div className="empty" role="status">正在加载测试工作流…</div> : workflow ? <TestWorkflowBuilder key={workflow.id} tasks={tasks} compositions={compositions} workflow={workflow} onSaved={() => router.push("/tasks/test-workflows")} onCancel={() => router.push("/tasks/test-workflows")} /> : null}
  </>;
}
