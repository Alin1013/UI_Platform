/** 独立编辑页：从 URL 读取用例，刷新和深链接都能恢复同一个编辑目标。 */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { AutomationTask } from "@/lib/types";
import { loadTask } from "@/lib/client";
import { TaskEditor } from "@/components/TaskEditor";
import styles from "../../tasks.module.css";

/** 请求结果绑定当前 ID，忽略离页后的旧响应，防止显示错误任务的表单。 */
export default function EditTaskPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loaded, setLoaded] = useState<{
    id: string;
    task?: AutomationTask;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    loadTask(id)
      .then(({ task }) => {
        if (active) setLoaded({ id, task });
      })
      .catch((caught: unknown) => {
        if (active)
          setLoaded({
            id,
            error: caught instanceof Error ? caught.message : "加载用例失败",
          });
      });
    return () => {
      active = false;
    };
  }, [id]);
  const current = loaded?.id === id ? loaded : null;
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>编辑用例</h1>
          <p>{current?.task?.name ?? "修改用例定义和执行配置。"}</p>
        </div>
        <Link className="button" href="/tasks/list">
          返回列表
        </Link>
      </div>
      {current?.error ? (
        <p className="error-text" role="alert">
          {current.error}
        </p>
      ) : current?.task ? (
        <section className={`panel ${styles.editor}`}>
          <div className="panel-header">
            <h2 className="panel-title">用例定义</h2>
            <span className="muted">保存后返回列表</span>
          </div>
          <TaskEditor
            key={id}
            task={current.task}
            onSaved={() => router.push("/tasks/list")}
            onCancel={() => router.push("/tasks/list")}
          />
        </section>
      ) : (
        <div className="empty" role="status">
          正在加载用例…
        </div>
      )}
    </>
  );
}
