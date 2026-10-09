/** 任务管理页：创建、编辑、运行和删除自动化任务。 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Plus, Trash2 } from "lucide-react";
import type { AutomationTask } from "@/lib/types";
import { loadTasks, removeTask, runTask } from "@/lib/client";
import { TaskEditor } from "@/components/TaskEditor";
import { ScriptTaskForm } from "@/components/ScriptTaskForm";
import { AiTaskForm } from "@/components/AiTaskForm";

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [editing, setEditing] = useState<AutomationTask | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => {
    const payload = await loadTasks();
    setTasks(payload.tasks);
  }, []);

  useEffect(() => {
    refresh().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "加载任务失败"),
    );
  }, [refresh]);

  async function handleRun(task: AutomationTask) {
    setBusyId(task.id);
    setMessage("");
    try {
      const payload = await runTask(task.id);
      router.push(`/executions?focus=${payload.execution.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务提交失败");
    } finally {
      setBusyId("");
    }
  }

  async function handleDelete(task: AutomationTask) {
    if (!window.confirm(`删除任务「${task.name}」？历史执行报告会保留。`)) return;
    setBusyId(task.id);
    try {
      await removeTask(task.id);
      if (editing?.id === task.id) setEditing(undefined);
      await refresh();
      setMessage("任务已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>任务管理</h1>
          <p>用结构化步骤定义 Web 自动化流程，保持执行可复现。</p>
          <p className="muted" style={{ margin: 0 }}>
            规则脚本可直接执行；AI 生成结果需预览确认后保存。
          </p>
        </div>
        <button className="button primary" onClick={() => setEditing(null)}>
          <Plus size={16} aria-hidden />
          新建任务
        </button>
      </div>

      {editing !== undefined ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2 className="panel-title">{editing ? "编辑任务" : "新建任务"}</h2>
          </div>
          <TaskEditor
            task={editing}
            onSaved={async () => {
              setEditing(undefined);
              setMessage("任务已保存");
              await refresh();
            }}
            onCancel={() => setEditing(undefined)}
          />
        </section>
      ) : null}

      {/* 两个创建入口并列展示：规则解析适合固定话术，AI 生成适合开放业务需求。 */}
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <ScriptTaskForm />
        <AiTaskForm onSaved={refresh} />
      </div>

      <p className="error-text">{message}</p>
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">任务列表</h2>
          <span className="muted">{tasks.length} 个任务</span>
        </div>
        {tasks.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>目标</th>
                <th>步骤</th>
                <th>标签</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <strong>{task.name}</strong>
                    {task.description ? <p className="muted" style={{ margin: "4px 0 0" }}>{task.description}</p> : null}
                  </td>
                  <td>
                    Web / {task.runner === "midscene" ? "Midscene" : "Playwright"}
                    <p className="muted" style={{ margin: "4px 0 0" }}>
                      {task.runtime?.browser ?? "chromium"}
                    </p>
                  </td>
                  <td>{task.steps.length}</td>
                  <td>{task.labels.join("、") || "-"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="button small primary"
                        disabled={busyId === task.id}
                        onClick={() => void handleRun(task)}
                      >
                        <Play size={14} aria-hidden />
                        运行
                      </button>
                      <button className="button small" onClick={() => setEditing(task)}>
                        <Pencil size={14} aria-hidden />
                        编辑
                      </button>
                      <button
                        className="button small danger"
                        disabled={busyId === task.id}
                        onClick={() => void handleDelete(task)}
                      >
                        <Trash2 size={14} aria-hidden />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">暂无任务；点击右上角新建一个 Web 流程。</div>
        )}
      </section>
    </>
  );
}
