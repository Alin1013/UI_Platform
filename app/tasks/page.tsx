/** 用例管理页：维护单用例列表、流程组合，并提供最近失败结果的手动重试入口。 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import {
  canManuallyRetry,
  loadExecutions,
  loadTasks,
  loadWorkflows,
  removeTask,
  retryExecution,
  runTask,
} from "@/lib/client";
import { TaskEditor } from "@/components/TaskEditor";
import { ScriptTaskForm } from "@/components/ScriptTaskForm";
import { AiTaskForm } from "@/components/AiTaskForm";
import { WorkflowManager } from "@/components/WorkflowManager";
import { StatusBadge } from "@/components/StatusBadge";

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [workflows, setWorkflows] = useState<TestWorkflow[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [editing, setEditing] = useState<AutomationTask | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => {
    // 单用例、组合和执行历史一起刷新；列表需要历史结果来决定重试入口。
    const [taskPayload, workflowPayload, executionPayload] = await Promise.all([
      loadTasks(),
      loadWorkflows(),
      loadExecutions(),
    ]);
    setTasks(taskPayload.tasks);
    setWorkflows(workflowPayload.workflows);
    setExecutions(executionPayload.executions);
  }, []);

  // 用例列表忽略 workflow 父记录；组合列表只看父记录，避免子用例结果污染流程状态。
  const latestTaskExecutions = useMemo(() => latestByTask(executions), [executions]);
  const latestWorkflowExecutions = useMemo(
    () => latestByWorkflow(executions),
    [executions],
  );

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

  /** 以该用例最近失败执行为基准重试；服务端返回新执行后跳转监控页。 */
  async function handleRetryTask(task: AutomationTask) {
    const latest = latestTaskExecutions[task.id];
    // 没有历史执行时按钮不会出现；这里再防御一次状态刷新间隙的点击。
    if (!latest) return;
    setBusyId(task.id);
    setMessage("");
    try {
      const payload = await retryExecution(latest.id);
      router.push(`/executions?focus=${payload.execution.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用例重试失败");
      setBusyId("");
    }
  }

  /** 组合重试始终重建父执行，历史父/子报告保持原样。 */
  async function handleRetryWorkflow(workflow: TestWorkflow) {
    const latest = latestWorkflowExecutions[workflow.id];
    if (!latest) throw new Error("流程组合还没有可重试的执行");
    const payload = await retryExecution(latest.id);
    router.push(`/executions?focus=${payload.execution.id}`);
  }

  async function handleDelete(task: AutomationTask) {
    if (!window.confirm(`删除用例「${task.name}」？历史执行报告会保留。`)) return;
    setBusyId(task.id);
    try {
      await removeTask(task.id);
      if (editing?.id === task.id) setEditing(undefined);
      await refresh();
      setMessage("用例已删除");
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
          <h1>用例管理</h1>
          <p>用结构化步骤定义 Web 自动化流程，保持执行可复现。</p>
          <p className="muted" style={{ margin: 0 }}>
            规则脚本可直接执行；AI 生成结果需预览确认后保存。
          </p>
        </div>
        <button className="button primary" onClick={() => setEditing(null)}>
          <Plus size={16} aria-hidden />
          新建用例
        </button>
      </div>

      {editing !== undefined ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2 className="panel-title">{editing ? "编辑用例" : "新建用例"}</h2>
          </div>
          <TaskEditor
            task={editing}
            onSaved={async () => {
              setEditing(undefined);
      setMessage("用例已保存");
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

      <WorkflowManager
        tasks={tasks}
        workflows={workflows}
        latestExecutions={latestWorkflowExecutions}
        onRetryWorkflow={handleRetryWorkflow}
        onSaved={refresh}
      />

      <p className="error-text">{message}</p>
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">用例列表</h2>
          <span className="muted">{tasks.length} 个用例</span>
        </div>
        {tasks.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>目标</th>
                <th>步骤</th>
                <th>标签</th>
                <th>最近状态</th>
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
                    {latestTaskExecutions[task.id] ? (
                      <StatusBadge status={latestTaskExecutions[task.id]!.status} />
                    ) : (
                      <span className="muted">未运行</span>
                    )}
                  </td>
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
                      {(() => {
                        const latest = latestTaskExecutions[task.id];
                        const retryable = canManuallyRetry(latest?.status);
                        // 列表只给异常结果提供重试；正常重跑仍使用“运行”按钮，语义更清晰。
                        if (!retryable) return null;
                        return (
                          <button
                            className="button small primary"
                            disabled={busyId === task.id}
                            onClick={() => void handleRetryTask(task)}
                          >
                            <RotateCcw size={14} aria-hidden />
                            重试
                          </button>
                        );
                      })()}
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
          <div className="empty">暂无用例；点击右上角新建一个 Web 流程。</div>
        )}
      </section>
    </>
  );
}

/** 计算每个单用例的最新执行；排除流程父记录，避免组合结果覆盖用例自身状态。 */
function latestByTask(executions: TaskExecution[]) {
  return latestExecutions(executions, (execution) =>
    execution.kind === "workflow" ? undefined : execution.taskId,
  );
}

/** 计算每个流程组合的最新父执行；只看父记录，防止已完成的子用例干扰列表状态。 */
function latestByWorkflow(executions: TaskExecution[]) {
  return latestExecutions(
    executions,
    (execution) =>
      execution.kind === "workflow" ? execution.workflowId ?? undefined : undefined,
  );
}

/** 执行历史按管理界面规模读取，一次遍历比多次数据库聚合查询更简单可靠。 */
function latestExecutions(
  executions: TaskExecution[],
  getGroupId: (execution: TaskExecution) => string | undefined,
) {
  return executions.reduce<Record<string, TaskExecution>>((groups, execution) => {
    const groupId = getGroupId(execution);
    if (!groupId) return groups;
    const current = groups[groupId];
    // queuedAt 是调度顺序的既有事实来源；ISO 字符串可直接比较。
    if (!current || execution.queuedAt > current.queuedAt) groups[groupId] = execution;
    return groups;
  }, {});
}
