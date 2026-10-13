/** 独立用例列表：只承担检索、运行和维护，创建与编辑跳转到各自页面。 */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AutomationTask, TaskExecution } from "@/lib/types";
import {
  canManuallyRetry,
  loadExecutions,
  loadTasks,
  removeTask,
  retryExecution,
  runTask,
} from "@/lib/client";
import { latestExecutionsByDefinition } from "@/lib/task-executions";
import { StatusBadge } from "@/components/StatusBadge";
import styles from "../tasks.module.css";

/** 列表与历史一起刷新，确保重试按钮对应当前最近一次异常结果。 */
export default function TaskListPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const refresh = useCallback(async () => {
    const [taskPayload, executionPayload] = await Promise.all([
      loadTasks(),
      loadExecutions(),
    ]);
    setTasks(taskPayload.tasks);
    setExecutions(executionPayload.executions);
  }, []);
  useEffect(() => {
    refresh()
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "加载失败"),
      )
      .finally(() => setLoading(false));
  }, [refresh]);
  const latest = useMemo(
    () => latestExecutionsByDefinition(executions, "task"),
    [executions],
  );
  const visible = tasks.filter((task) =>
    `${task.name} ${task.labels.join(" ")}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  /** 操作期间锁住列表写操作，防止重复入队或删除；导航到服务端返回的新执行。 */
  async function execute(task: AutomationTask, retry: boolean) {
    setBusyId(task.id);
    setError("");
    setMessage("");
    try {
      const payload =
        retry && latest[task.id]
          ? await retryExecution(latest[task.id].id)
          : await runTask(task.id);
      router.push(`/executions?focus=${payload.execution.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setBusyId("");
    }
  }
  /** 删除只移除定义，历史报告继续保留；刷新后明确反馈结果。 */
  async function handleDelete(task: AutomationTask) {
    if (!window.confirm(`删除用例「${task.name}」？历史执行报告会保留。`))
      return;
    setBusyId(task.id);
    setError("");
    setMessage("");
    try {
      await removeTask(task.id);
      await refresh();
      setMessage("用例已删除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setBusyId("");
    }
  }
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>用例列表</h1>
          <p>维护自动化用例，查看最近结果并发起执行。</p>
        </div>
        <Link href="/tasks/new" className="button primary">
          <Plus size={16} aria-hidden />
          新建用例
        </Link>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}
      <section className="panel" aria-label="用例列表">
        <div className={styles.filters}>
          <label>
            搜索用例
            <input
              type="search"
              placeholder="搜索名称或标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p>
            {loading
              ? "加载中…"
              : `共 ${tasks.length} 个用例 · 显示 ${visible.length} 个`}
          </p>
        </div>
        {loading ? (
          <div className="empty" role="status">
            正在加载用例…
          </div>
        ) : visible.length ? (
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label="用例表格，可横向滚动"
          >
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>执行引擎</th>
                  <th>步骤</th>
                  <th>标签</th>
                  <th>最近状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.name}</strong>
                      {task.description ? (
                        <p className={styles.description}>{task.description}</p>
                      ) : null}
                    </td>
                    <td>
                      {task.runner === "midscene" ? "Midscene" : "Playwright"}
                      <p className={styles.description}>
                        {task.runtime?.browser ?? "chromium"}
                      </p>
                    </td>
                    <td>{task.steps.length}</td>
                    <td>{task.labels.join("、") || "—"}</td>
                    <td>
                      {latest[task.id] ? (
                        <StatusBadge status={latest[task.id].status} />
                      ) : (
                        <span className="muted">未运行</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          className="button small primary"
                          disabled={Boolean(busyId)}
                          onClick={() => void execute(task, false)}
                        >
                          <Play size={14} aria-hidden />
                          {busyId === task.id ? "处理中" : "运行"}
                        </button>
                        {canManuallyRetry(latest[task.id]?.status) ? (
                          <button
                            className="button small"
                            disabled={Boolean(busyId)}
                            onClick={() => void execute(task, true)}
                          >
                            <RotateCcw size={14} aria-hidden />
                            重试
                          </button>
                        ) : null}
                        <Link
                          className="button small"
                          href={`/tasks/${task.id}/edit`}
                        >
                          <Pencil size={14} aria-hidden />
                          编辑
                        </Link>
                        <button
                          className="button small danger"
                          disabled={Boolean(busyId)}
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
          </div>
        ) : (
          <div className={styles.empty}>
            <p>
              {error
                ? "用例未能加载，请刷新重试。"
                : tasks.length
                  ? "没有匹配的用例，试试其他名称或标签。"
                  : "还没有用例，创建第一个自动化流程吧。"}
            </p>
            {!tasks.length && !error ? (
              <Link className="button" href="/tasks/new">
                新建用例
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}
