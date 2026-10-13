/** 执行监控页：查看排队、运行中和历史执行。 */

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { AutomationTask, TaskExecution } from "@/lib/types";
import { loadExecutions, loadTasks, removeExecutions } from "@/lib/client";
import { StatusBadge } from "@/components/StatusBadge";
import { ExecutionDetails } from "@/components/ExecutionDetails";
import styles from "./page.module.css";

/** 执行列表占较窄侧栏，给长日志和截图留出可收缩的详情空间。 */
function ExecutionsView() {
  const searchParams = useSearchParams();
  const initialFocus = searchParams.get("focus");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [selectedId, setSelectedId] = useState(initialFocus);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [detailsRevision, setDetailsRevision] = useState(0);
  // 删除前发出的轮询可能稍后返回旧列表；过滤已删除 ID，避免记录和详情重新出现。
  const deletedIds = useRef(new Set<string>());

  // 同一流程按父 ID 归组；任一父/子记录仍活动时保护整组，避免报告残缺或编排失效。
  const activeWorkflowIds = new Set(executions
    .filter((item) => item.status === "queued" || item.status === "running")
    .map((item) => item.workflowExecutionId ?? item.id));
  const deletableExecutions = executions.filter((item) =>
    !activeWorkflowIds.has(item.workflowExecutionId ?? item.id));
  const deletableIds = new Set(deletableExecutions.map((item) => item.id));
  const checkedDeletableIds = checkedIds.filter((id) => deletableIds.has(id));
  const allChecked = deletableExecutions.length > 0 &&
    checkedDeletableIds.length === deletableExecutions.length;

  /** 单条和批量共用确认/错误流程；以服务端返回的完整 ID 集合清理级联记录。 */
  async function handleDelete(ids: string[]) {
    if (!ids.length || deleting) return;
    const containsWorkflow = executions.some((item) => ids.includes(item.id) && item.kind === "workflow");
    const prompt = ids.length === 1 ? "确定删除这条执行记录？" : `确定删除选中的 ${ids.length} 条执行记录？`;
    if (!window.confirm(`${prompt}${containsWorkflow ? "流程组合的子执行记录也会一并删除。" : ""}删除后无法恢复。`)) return;
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      const payload = await removeExecutions(ids);
      payload.deletedIds.forEach((id) => deletedIds.current.add(id));
      const remaining = executions.filter((item) => !deletedIds.current.has(item.id));
      setExecutions((current) => current.filter((item) => !deletedIds.current.has(item.id)));
      setCheckedIds((current) => current.filter((id) => !deletedIds.current.has(id)));
      setSelectedId((current) => current && deletedIds.current.has(current) ? remaining[0]?.id ?? null : current);
      // 删除子执行也会改变父流程报告；重建详情，丢弃旧子列表以及未完成的详情轮询。
      setDetailsRevision((current) => current + 1);
      setMessage(`已删除 ${payload.deletedIds.length} 条执行记录`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除执行记录失败");
    } finally {
      setDeleting(false);
    }
  }

  /** 自愈写回任务后只替换对应任务，避免整页重新拉取打断活动执行轮询。 */
  function handleTaskUpdated(task: AutomationTask) {
    setTasks((current) =>
      current.map((item) => (item.id === task.id ? task : item)),
    );
  }

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const [taskPayload, executionPayload] = await Promise.all([
        loadTasks(),
        loadExecutions(),
      ]);
      if (!alive) return;
      const records = executionPayload.executions.filter((item) => !deletedIds.current.has(item.id));
      setTasks(taskPayload.tasks);
      setExecutions(records);
      // 已删除或失效的 focus 回退到首条记录，最后一条删除后显示空详情。
      setSelectedId((current) => records.some((item) => item.id === current) ? current : records[0]?.id ?? null);
      setCheckedIds((current) => current.filter((id) => records.some((item) => item.id === id)));
      const active = records.some(
        (execution) => execution.status === "queued" || execution.status === "running",
      );
      if (active) timer = setTimeout(() => void load().catch(handleLoadError), 1500);
    }
    /** 加载失败显式展示；卸载后丢弃结果和定时器，避免删除切换时污染状态。 */
    function handleLoadError(caught: unknown) {
      if (alive) setError(caught instanceof Error ? caught.message : "加载执行记录失败");
    }
    void load().catch(handleLoadError);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>执行监控</h1>
          <p>实时查看步骤进度、失败原因和页面截图。</p>
        </div>
      </div>

      {error ? <p role="alert" className="error-text">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}

      <div className={styles.layout}>
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">执行记录</h2>
            <span className="muted">{executions.length} 条</span>
          </div>
          {executions.length ? (
            <div className={styles.selectionBar}>
              <label className={styles.selectAll}>
                <input
                  type="checkbox"
                  aria-label="全选可删除的执行记录"
                  checked={allChecked}
                  ref={(input) => { if (input) input.indeterminate = checkedDeletableIds.length > 0 && !allChecked; }}
                  disabled={deleting || !deletableExecutions.length}
                  onChange={() => setCheckedIds(allChecked ? [] : deletableExecutions.map((item) => item.id))}
                />
                全选
              </label>
              <button className="button small danger" disabled={deleting || !checkedDeletableIds.length}
                onClick={() => void handleDelete(checkedDeletableIds)}>
                {deleting ? "删除中…" : `批量删除${checkedDeletableIds.length ? ` (${checkedDeletableIds.length})` : ""}`}
              </button>
              <span className={styles.selectionHint}>仅可删除已结束的执行记录</span>
            </div>
          ) : null}
          {executions.length ? (
            <div className="panel-body" style={{ display: "grid", gap: 8 }}>
              {executions.map((execution) => (
                <div key={execution.id} className={styles.recordRow} role="group" aria-label={`执行记录 ${execution.id}`}>
                  <input type="checkbox" aria-label={`选择执行记录 ${execution.id}`}
                    checked={checkedDeletableIds.includes(execution.id)}
                    disabled={deleting || !deletableIds.has(execution.id)}
                    onChange={(event) => setCheckedIds((current) => event.target.checked
                      ? [...current, execution.id] : current.filter((id) => id !== execution.id))}
                  />
                  <button
                    className={`button ${styles.record}`}
                    style={{
                      justifyContent: "space-between",
                      background: execution.id === selectedId ? "var(--surface-muted)" : "white",
                    }}
                    onClick={() => setSelectedId(execution.id)}
                  >
                    <span>
                      {execution.kind === "workflow"
                        ? execution.workflowName ?? "流程组合"
                        : tasks.find((task) => task.id === execution.taskId)?.name ?? "未知任务"}
                    </span>
                    <StatusBadge status={execution.status} />
                  </button>
                  <button className={`button small danger ${styles.deleteButton}`}
                    aria-label={`删除执行记录 ${execution.id}`}
                    title={deletableIds.has(execution.id) ? "删除执行记录" : "执行结束后可删除"}
                    disabled={deleting || !deletableIds.has(execution.id)}
                    onClick={() => void handleDelete([execution.id])}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">还没有执行；先到任务管理运行一个流程。</div>
          )}
        </section>

        <div className={styles.content}>
          {selectedId ? (
            <ExecutionDetails
              key={detailsRevision}
              executionId={selectedId}
              tasks={tasks}
              onTaskUpdated={handleTaskUpdated}
              onSelectExecution={setSelectedId}
            />
          ) : (
            <section className="panel">
              <div className="empty">选择左侧执行记录查看详情</div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default function ExecutionsPage() {
  return (
    <Suspense fallback={<div className="empty">正在加载执行监控</div>}>
      <ExecutionsView />
    </Suspense>
  );
}
