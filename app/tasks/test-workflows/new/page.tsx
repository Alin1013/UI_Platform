/** 新建测试工作流：加载用例和普通组合作为可选算子，保存后返回工作流列表。 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TestWorkflowBuilder } from "@/components/TestWorkflowBuilder";
import { loadTasks, loadWorkflows } from "@/lib/client";
import type { AutomationTask, TestWorkflow } from "@/lib/types";
import styles from "../../tasks.module.css";

/** 节点来源同时请求，避免画布先显示不完整的可选节点集合。 */
export default function NewTestWorkflowPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [compositions, setCompositions] = useState<TestWorkflow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([loadTasks(), loadWorkflows()]).then(([taskPayload, workflowPayload]) => {
      if (!active) return;
      setTasks(taskPayload.tasks);
      setCompositions(workflowPayload.workflows.filter((workflow) => workflow.kind !== "test-workflow"));
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "加载工作流节点失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <>
    <div className={styles.heading}><div><h1>新建测试工作流</h1><p>按顺序添加单测试用例和组合测试流，节点失败后停止后续执行。</p></div><Link className="button" href="/tasks/test-workflows">返回工作流列表</Link></div>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {loading ? <div className="empty" role="status">正在加载可用节点…</div> : !error ? <TestWorkflowBuilder tasks={tasks} compositions={compositions} onSaved={() => router.push("/tasks/test-workflows")} onCancel={() => router.push("/tasks/test-workflows")} /> : null}
  </>;
}
