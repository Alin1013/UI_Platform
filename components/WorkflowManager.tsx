/**
 * 流程组合列表：只负责展示已保存组合和触发运行类操作。
 * 新建、编辑都通过独立路由进入画布，避免列表页被长表单撑开。
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import { canManuallyRetry, removeWorkflow, runWorkflow } from "@/lib/client";
import { StatusBadge } from "./StatusBadge";
import styles from "./WorkflowManager.module.css";

/** 组合列表的运行与删除操作仍在此处集中处理；编辑按钮只导航到画布页。 */
export function WorkflowManager({
  tasks,
  workflows,
  latestExecutions,
  onRetryWorkflow,
  onSaved,
}: {
  tasks: AutomationTask[];
  workflows: TestWorkflow[];
  latestExecutions: Record<string, TaskExecution | undefined>;
  onRetryWorkflow: (workflow: TestWorkflow) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [retryingId, setRetryingId] = useState("");

  /** 列表显示顺序必须与运行时 taskIds 快照一致。 */
  function taskNames(workflow: TestWorkflow) {
    return workflow.taskIds
      .map(
        (taskId) => tasks.find((task) => task.id === taskId)?.name ?? "未知用例",
      )
      .join(" → ");
  }

  /** 运行后跳到父执行报告，组合子用例会在报告页继续展开。 */
  async function startWorkflow(workflow: TestWorkflow) {
    setBusyId(workflow.id);
    setMessage("");
    try {
      const payload = await runWorkflow(workflow.id);
      window.location.href = `/executions?focus=${payload.execution.id}`;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流程提交失败");
      setBusyId("");
    }
  }

  /** 只删除组合定义，历史执行报告继续保留。 */
  async function deleteWorkflow(workflow: TestWorkflow) {
    if (!window.confirm(`删除流程组合「${workflow.name}」？历史报告会保留。`)) return;
    setBusyId(workflow.id);
    setMessage("");
    try {
      await removeWorkflow(workflow.id);
      await onSaved();
      setMessage("流程组合已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除组合失败");
    } finally {
      setBusyId("");
    }
  }

  /** 重试只使用该组合最近一次父执行，避免误重试子用例。 */
  async function retryWorkflow(workflow: TestWorkflow) {
    setRetryingId(workflow.id);
    setMessage("");
    try {
      await onRetryWorkflow(workflow);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流程重试失败");
    } finally {
      setRetryingId("");
    }
  }

  return (
    <section className="panel" aria-label="流程组合列表">
      <div className={`panel-header ${styles.header}`}>
        <div>
          <h2 className={`panel-title ${styles.title}`}>组合列表</h2>
          <p className={styles.subtitle}>按业务顺序串联已有用例，失败后停止后续步骤。</p>
        </div>
        <div className={styles.headerActions}>
          <span className="muted">{workflows.length} 个组合</span>
          <Link className="button primary" href="/tasks/workflows/new">
            <Plus size={16} aria-hidden />
            新建组合
          </Link>
        </div>
      </div>

      {message ? (
        <p className={`error-text ${styles.message}`} role="status">
          {message}
        </p>
      ) : null}

      {workflows.length ? (
        <div className={styles.tableScroll}>
          <table className="table">
            <thead>
              <tr>
                <th>组合名称</th>
                <th>执行顺序</th>
                <th>最近状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => {
                const latest = latestExecutions[workflow.id];
                const retryable = canManuallyRetry(latest?.status);
                return (
                  <tr key={workflow.id}>
                    <td>
                      <strong>{workflow.name}</strong>
                      {workflow.description ? (
                        <p className="muted" style={{ margin: "4px 0 0" }}>
                          {workflow.description}
                        </p>
                      ) : null}
                    </td>
                    <td className={styles.orderCell}>{taskNames(workflow)}</td>
                    <td>
                      {latest ? <StatusBadge status={latest.status} /> : <span className="muted">未运行</span>}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          className="button small primary"
                          disabled={busyId === workflow.id}
                          onClick={() => void startWorkflow(workflow)}
                        >
                          <Play size={14} aria-hidden />
                          运行
                        </button>
                        {retryable ? (
                          <button
                            className="button small primary"
                            disabled={busyId === workflow.id || retryingId === workflow.id}
                            onClick={() => void retryWorkflow(workflow)}
                          >
                            <RotateCcw size={14} aria-hidden />
                            {retryingId === workflow.id ? "重试中" : "重试"}
                          </button>
                        ) : null}
                        <Link className="button small" href={`/tasks/workflows/${workflow.id}/edit`}>
                          <Pencil size={14} aria-hidden />
                          编辑
                        </Link>
                        <button
                          className="button small danger"
                          disabled={busyId === workflow.id}
                          onClick={() => void deleteWorkflow(workflow)}
                        >
                          <Trash2 size={14} aria-hidden />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>还没有流程组合</strong>
          <p>点击“新建组合”，在算子画布中安排用例执行顺序。</p>
          <Link className="button primary" href="/tasks/workflows/new">
            <Plus size={16} aria-hidden />
            新建组合
          </Link>
        </div>
      )}
    </section>
  );
}
