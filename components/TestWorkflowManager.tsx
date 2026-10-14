/** 测试工作流列表：展示可组合节点，并集中处理运行、重试、编辑和删除。 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { Layers3, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import { canManuallyRetry, removeWorkflow, runWorkflow } from "@/lib/client";
import { StatusBadge } from "./StatusBadge";
import styles from "./WorkflowManager.module.css";

/** 用例和普通组合共享一张节点表；测试工作流本身不会作为可引用节点传入。 */
export function TestWorkflowManager({
  tasks,
  compositions,
  workflows,
  latestExecutions,
  onRetryWorkflow,
  onSaved,
}: {
  tasks: AutomationTask[];
  compositions: TestWorkflow[];
  workflows: TestWorkflow[];
  latestExecutions: Record<string, TaskExecution | undefined>;
  onRetryWorkflow: (workflow: TestWorkflow) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [retryingId, setRetryingId] = useState("");

  function nodeNames(workflow: TestWorkflow) {
    return (workflow.nodes ?? []).map((node) => {
      if (node.type === "task") return tasks.find((task) => task.id === node.taskId)?.name ?? "未知用例";
      return compositions.find((item) => item.id === node.workflowId)?.name ?? "未知组合";
    }).join(" → ");
  }

  async function start(workflow: TestWorkflow) {
    setBusyId(workflow.id);
    setMessage("");
    try {
      const payload = await runWorkflow(workflow.id);
      window.location.href = `/executions?focus=${payload.execution.id}`;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "测试工作流提交失败");
      setBusyId("");
    }
  }

  async function remove(workflow: TestWorkflow) {
    if (!window.confirm(`删除测试工作流「${workflow.name}」？历史报告会保留。`)) return;
    setBusyId(workflow.id);
    setMessage("");
    try {
      await removeWorkflow(workflow.id);
      await onSaved();
      setMessage("测试工作流已删除");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "删除测试工作流失败");
    } finally {
      setBusyId("");
    }
  }

  async function retry(workflow: TestWorkflow) {
    setRetryingId(workflow.id);
    setMessage("");
    try { await onRetryWorkflow(workflow); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "测试工作流重试失败"); }
    finally { setRetryingId(""); }
  }

  return (
    <section className="panel" aria-label="测试工作流列表">
      <div className={`panel-header ${styles.header}`}>
        <div>
          <h2 className={`panel-title ${styles.title}`}>工作流列表</h2>
          <p className={styles.subtitle}>将单测试用例和组合测试流按业务顺序串联。</p>
        </div>
        <div className={styles.headerActions}>
          <span className="muted">{workflows.length} 个工作流</span>
          <Link className="button primary" href="/tasks/test-workflows/new"><Plus size={16} aria-hidden />新建工作流</Link>
        </div>
      </div>
      {message ? <p className={`error-text ${styles.message}`} role="status">{message}</p> : null}
      {workflows.length ? (
        <div className={styles.tableScroll}>
          <table className="table">
            <thead><tr><th>工作流名称</th><th>执行节点</th><th>最近状态</th><th>操作</th></tr></thead>
            <tbody>{workflows.map((workflow) => {
              const latest = latestExecutions[workflow.id];
              return <tr key={workflow.id}>
                <td><strong>{workflow.name}</strong>{workflow.description ? <p className="muted" style={{ margin: "4px 0 0" }}>{workflow.description}</p> : null}</td>
                <td className={styles.orderCell}><span className="muted"><Layers3 size={14} aria-hidden /></span> {nodeNames(workflow)}</td>
                <td>{latest ? <StatusBadge status={latest.status} /> : <span className="muted">未运行</span>}</td>
                <td><div className={styles.rowActions}>
                  <button className="button small primary" disabled={busyId === workflow.id} onClick={() => void start(workflow)}><Play size={14} aria-hidden />运行</button>
                  {canManuallyRetry(latest?.status) ? <button className="button small primary" disabled={busyId === workflow.id || retryingId === workflow.id} onClick={() => void retry(workflow)}><RotateCcw size={14} aria-hidden />{retryingId === workflow.id ? "重试中" : "重试"}</button> : null}
                  <Link className="button small" href={`/tasks/test-workflows/${workflow.id}/edit`}><Pencil size={14} aria-hidden />编辑</Link>
                  <button className="button small danger" disabled={busyId === workflow.id} onClick={() => void remove(workflow)}><Trash2 size={14} aria-hidden />删除</button>
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : <div className={styles.empty}><strong>还没有测试工作流</strong><p>选择多个单测试用例或组合测试流，创建一条更高层的执行链。</p><Link className="button primary" href="/tasks/test-workflows/new"><Plus size={16} aria-hidden />新建工作流</Link></div>}
    </section>
  );
}
