/** 独立新建组合页：用算子画布编排用例，保存后回到组合列表。 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WorkflowBuilder } from "@/components/WorkflowBuilder";
import { loadTasks } from "@/lib/client";
import type { AutomationTask } from "@/lib/types";
import styles from "../../tasks.module.css";
import { useRouter } from "next/navigation";

/** 新建页只读取用例算子，不请求组合列表，减少画布初始化时的无关数据。 */
export default function NewWorkflowPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadTasks()
      .then(({ tasks: loaded }) => setTasks(loaded))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "加载用例失败"),
      );
  }, []);

  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>新建组合</h1>
          <p>从算子面板添加用例，搭建一条可复现的串行执行链。</p>
        </div>
        <Link className="button" href="/tasks/workflows">返回组合列表</Link>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {error ? null : (
        <WorkflowBuilder
          tasks={tasks}
          onSaved={() => router.push("/tasks/workflows")}
          onCancel={() => router.push("/tasks/workflows")}
        />
      )}
    </>
  );
}
