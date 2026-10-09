/**
 * 执行详情。
 * 组件对进行中的执行自动轮询，完成后停止定时器并展示最终报告。
 */

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Wrench } from "lucide-react";
import type {
  AutomationTask,
  HealingStatus,
  StepLog,
  TaskExecution,
} from "@/lib/types";
import {
  applyHealing,
  formatDuration,
  formatTime,
  generateHealing,
  loadExecution,
} from "@/lib/client";
import { StatusBadge } from "./StatusBadge";

/** 修复状态只展示用户可理解的中文；rejected 当前作为数据预留。 */
function healingStatusLabel(status: HealingStatus) {
  return status === "proposed" ? "待确认" : status === "applied" ? "已应用" : "已忽略";
}

export function ExecutionDetails({
  executionId,
  tasks,
  onTaskUpdated,
}: {
  executionId: string;
  tasks: AutomationTask[];
  /** 任务定义被修复写回后通知父页面，避免任务名和后续编辑使用旧数据。 */
  onTaskUpdated?: (task: AutomationTask) => void;
}) {
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [error, setError] = useState("");
  const [healingError, setHealingError] = useState("");
  const [healingBusy, setHealingBusy] = useState(false);
  const [applyingId, setApplyingId] = useState("");

  const refreshExecution = useCallback(async () => {
    const payload = await loadExecution(executionId);
    setExecution(payload.execution);
  }, [executionId]);

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
  // 只对最后失败的确定性 click/fill 提供入口；这里和后端 findHealableFailure 的边界保持一致。
  const healableFailure =
    execution.status === "failed"
      ? [...execution.logs]
          .reverse()
          .find(
            (log) =>
              log.status === "failed" &&
              (log.action === "click" || log.action === "fill") &&
              Boolean(log.selector),
          )
      : undefined;

  async function handleGenerateHealing() {
    if (!execution || !healableFailure) return;
    setHealingBusy(true);
    setHealingError("");
    try {
      await generateHealing(execution.id);
      // 生成过程会在服务端重放并验证候选，必须重新读取完整 execution 才能看到持久化结果。
      await refreshExecution();
    } catch (caught) {
      setHealingError(caught instanceof Error ? caught.message : "生成修复建议失败");
    } finally {
      setHealingBusy(false);
    }
  }

  async function handleApplyHealing(healingId: string) {
    if (!execution) return;
    const sourceTask = tasks.find((item) => item.id === execution.taskId);
    if (!sourceTask) {
      setHealingError("关联任务不存在，无法应用修复");
      return;
    }
    setApplyingId(healingId);
    setHealingError("");
    try {
      const payload = await applyHealing(sourceTask.id, {
        executionId: execution.id,
        healingId,
      });
      setExecution(payload.execution);
      onTaskUpdated?.(payload.task);
    } catch (caught) {
      setHealingError(caught instanceof Error ? caught.message : "应用修复失败");
    } finally {
      setApplyingId("");
    }
  }

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

      {execution.status === "failed" && execution.runner !== "midscene" ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <h2 className="panel-title">失败修复建议</h2>
            {healableFailure ? (
              <button
                className="button small primary"
                disabled={healingBusy}
                onClick={() => void handleGenerateHealing()}
              >
                <Wrench size={14} aria-hidden />
                {healingBusy ? "生成中" : "生成修复建议"}
              </button>
            ) : null}
          </div>
          <div className="panel-body">
            <p className="muted" style={{ marginTop: 0 }}>
              仅分析 Playwright click / fill 定位器失败；候选会在失败前步骤重放后验证可见性，确认应用前不会修改任务。
            </p>
            <p className="error-text">{healingError}</p>
            {execution.healing?.length ? (
              <ul className="healing-list">
                {execution.healing.map((healing) => (
                  <li className="healing-item" key={healing.id}>
                    <div className="healing-heading">
                      <strong>步骤 {healing.stepIndex} · {healing.action}</strong>
                      <span className="muted">
                        置信度 {(healing.confidence * 100).toFixed(0)}% ·{" "}
                        {healingStatusLabel(healing.status)}
                      </span>
                    </div>
                    <p className="healing-target" style={{ margin: "8px 0 0" }}>
                      {healing.originalTarget} → {healing.healedTarget}
                    </p>
                    <p className="muted" style={{ margin: "8px 0 12px" }}>{healing.reason}</p>
                    <div className="toolbar" style={{ justifyContent: "flex-start", marginBottom: 0 }}>
                      {healing.screenshot ? (
                        <a
                          className="button small"
                          href={`/api/executions/${execution.id}/artifacts/${healing.screenshot}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看失败截图
                        </a>
                      ) : null}
                      {healing.status === "proposed" ? (
                        <button
                          className="button small primary"
                          disabled={!task || applyingId === healing.id}
                          onClick={() => void handleApplyHealing(healing.id)}
                        >
                          <Check size={14} aria-hidden />
                          {applyingId === healing.id ? "应用中" : "应用修复"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : healableFailure ? (
              <div className="empty">尚未生成修复建议</div>
            ) : (
              <div className="empty">当前失败没有可修复的 click / fill 定位器</div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
