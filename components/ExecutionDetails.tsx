/**
 * 执行详情。
 * 组件对进行中的执行自动轮询，完成后停止定时器并展示最终报告。
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AutomationTask, StepLog, TaskExecution } from "@/lib/types";
import { formatDuration, formatTime, loadExecution } from "@/lib/client";
import { StatusBadge } from "./StatusBadge";

export function ExecutionDetails({
  executionId,
  tasks,
}: {
  executionId: string;
  tasks: AutomationTask[];
}) {
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setExecution(null);
    setError("");

    async function load() {
      try {
        const payload = await loadExecution(executionId);
        if (!alive) return;
        setExecution(payload.execution);
        // 只有活动状态才轮询，避免报告页产生无意义请求。
        if (payload.execution.status === "queued" || payload.execution.status === "running") {
          setTimeout(load, 1500);
        }
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : "加载失败");
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [executionId]);

  if (error) return <div className="empty">{error}</div>;
  if (!execution) return <div className="empty">正在加载执行详情</div>;

  const task = tasks.find((item) => item.id === execution.taskId);
  const completed = execution.logs.length;
  const screenshots = execution.logs.filter(
    (log): log is StepLog & { screenshot: string } => Boolean(log.screenshot),
  );
  const progress = execution.status === "succeeded"
    ? 100
    : execution.totalSteps
      ? Math.round((completed / execution.totalSteps) * 100)
      : 0;
  const runnerLabel = execution.runner === "midscene" ? "Midscene AI" : "Playwright";

  return (
    <>
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">{task?.name ?? "未知任务"}</div>
            <span className="muted">
              {runnerLabel} · {execution.browser ?? "chromium"} · 尝试 {execution.attempts ?? 1} 次
            </span>
          </div>
          <StatusBadge status={execution.status} />
        </div>
        <div className="panel-body">
          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="metric">
              <span className="metric-label">步骤进度</span>
              <div className="metric-value">
                {completed}/{execution.totalSteps}
              </div>
            </div>
            <div className="metric">
              <span className="metric-label">耗时</span>
              <div className="metric-value">{formatDuration(execution.durationMs)}</div>
            </div>
            <div className="metric">
              <span className="metric-label">开始时间</span>
              <div className="metric-value">{formatTime(execution.startedAt)}</div>
            </div>
            <div className="metric">
              <span className="metric-label">完成时间</span>
              <div className="metric-value">{formatTime(execution.finishedAt)}</div>
            </div>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          {execution.error ? <p className="error-text">{execution.error}</p> : null}
          {execution.reportUrl || execution.tracePath ? (
            <div className="toolbar" style={{ justifyContent: "flex-start", marginTop: 12 }}>
              {execution.reportUrl ? (
                <a
                  className="button small"
                  href={`/api/executions/${execution.id}/artifacts/${execution.reportUrl}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看 Midscene 报告
                </a>
              ) : null}
              {execution.tracePath ? (
                <a
                  className="button small"
                  href={`/api/executions/${execution.id}/artifacts/${execution.tracePath}`}
                >
                  下载 Trace
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">执行日志</h2>
            {execution.status === "running" ? (
              <RefreshCw className="muted" size={16} aria-hidden />
            ) : null}
          </div>
          <div className="panel-body">
            {execution.logs.length ? (
              <ul className="log-list">
                {execution.logs.map((log) => (
                  <li key={log.index} className={`log-item ${log.status}`}>
                    <strong>{log.index}</strong>
                    <span>
                      {log.action}
                      <small className="muted" style={{ display: "block" }}>
                        {log.runner === "midscene" ? "Midscene" : "Playwright"} ·{" "}
                        {log.kind ?? "deterministic"}
                        {log.selector ? ` · ${log.selector}` : ""}
                      </small>
                    </span>
                    <span className="muted log-status">
                      {log.message ?? (log.status === "passed" ? "通过" : "失败")}
                      {log.aiResult == null
                        ? ""
                        : ` · ${typeof log.aiResult === "string" ? log.aiResult : JSON.stringify(log.aiResult)}`}
                    </span>
                    <span>{formatDuration(log.durationMs)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">等待执行器写入日志</div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">步骤截图</h2>
            <span className="muted">1280 × 720 viewport</span>
          </div>
          {screenshots.length ? (
            <div className="panel-body screenshot-list">
              {screenshots.map((log) => (
                <figure className="screenshot-item" key={log.index}>
                  <img
                    className="screenshot"
                    src={`/api/executions/${execution.id}/artifacts/${log.screenshot}`}
                    alt={`步骤 ${log.index} ${log.status === "failed" ? "失败现场" : "页面"}截图`}
                    loading="lazy"
                  />
                  <figcaption className="muted screenshot-caption">
                    步骤 {log.index} · {log.action}
                    {log.status === "failed" ? " · 失败现场" : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="empty">暂无截图</div>
          )}
        </section>
      </div>
    </>
  );
}
