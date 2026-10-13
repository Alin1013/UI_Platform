/**
 * 执行详情。
 * 组件对进行中的执行自动轮询，完成后停止定时器并展示最终报告。
 */

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import type {
  AutomationTask,
  HealingStatus,
  StepLog,
  TaskExecution,
} from "@/lib/types";
import {
  applyHealing,
  canManuallyRetry,
  formatDuration,
  formatTime,
  generateHealing,
  loadExecution,
  retryExecution,
} from "@/lib/client";
import { StatusBadge } from "./StatusBadge";
import styles from "./ExecutionDetails.module.css";

/** 修复状态只展示用户可理解的中文；rejected 当前作为数据预留。 */
function healingStatusLabel(status: HealingStatus) {
  return status === "proposed" ? "待确认" : status === "applied" ? "已应用" : "已忽略";
}

type ExecutionDetailsProps = {
  executionId: string;
  tasks: AutomationTask[];
  /** 任务定义被修复写回后通知父页面，避免任务名和后续编辑使用旧数据。 */
  onTaskUpdated?: (task: AutomationTask) => void;
  /** 流程报告允许点击子用例跳到其步骤详情，避免用户手动在左侧列表查找。 */
  onSelectExecution?: (executionId: string) => void;
};

/** 切换执行时重建详情状态，旧记录的异步生成结果不能覆盖新记录或留下“生成中”。 */
export function ExecutionDetails(props: ExecutionDetailsProps) {
  return <ExecutionDetailsView key={props.executionId} {...props} />;
}

/** 用容器宽度适配日志和截图，兼容监控侧栏与报告页两种详情宽度。 */
function ExecutionDetailsView({
  executionId,
  tasks,
  onTaskUpdated,
  onSelectExecution,
}: ExecutionDetailsProps) {
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [workflowChildren, setWorkflowChildren] = useState<TaskExecution[]>([]);
  const [error, setError] = useState("");
  const [healingError, setHealingError] = useState("");
  const [healingBusy, setHealingBusy] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [retryError, setRetryError] = useState("");

  const refreshExecution = useCallback(async () => {
    const payload = await loadExecution(executionId);
    setExecution(payload.execution);
    setWorkflowChildren(payload.children ?? []);
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
        setWorkflowChildren(payload.children ?? []);
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

  /** 生成中、请求失败和已有候选分别展示，避免把等待或失败误报成尚未生成。 */
  async function handleGenerateHealing() {
    if (!execution || !healableFailure || healingBusy || !task) return;
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

  /** 人工重试父流程或任意子用例；成功后立即切换到新执行继续轮询。 */
  async function handleRetry(sourceExecutionId: string) {
    setRetryingId(sourceExecutionId);
    setRetryError("");
    try {
      const payload = await retryExecution(sourceExecutionId);
      onSelectExecution?.(payload.execution.id);
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : "执行重试失败");
    } finally {
      setRetryingId("");
    }
  }

  // 流程父执行没有浏览器步骤日志；这里用子执行结果渲染组合视角，单用例继续走原详情。
  if (execution.kind === "workflow") {
    const children = [...workflowChildren].sort(
      (left, right) => (left.workflowOrder ?? 0) - (right.workflowOrder ?? 0),
    );
    const progress = execution.status === "succeeded"
      ? 100
      : execution.totalSteps
        ? Math.round(((execution.currentStep ?? 0) / execution.totalSteps) * 100)
        : 0;

    return (
      <div className={`panel ${styles.details}`}>
        <div className="panel-header">
          <div>
            <div className="panel-title">{execution.workflowName ?? "流程组合"}</div>
            <span className="muted">组合流程 · {execution.totalSteps} 个用例</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canManuallyRetry(execution.status) ? (
              <button
                className="button small primary"
                disabled={retryingId === execution.id}
                onClick={() => void handleRetry(execution.id)}
              >
                <RotateCcw size={14} aria-hidden />
                {retryingId === execution.id ? "重试中" : "重试流程"}
              </button>
            ) : null}
            <StatusBadge status={execution.status} />
          </div>
        </div>
        <div className="panel-body">
          <div className={`metric-grid ${styles.metrics}`}>
            <div className="metric">
              <span className="metric-label">流程进度</span>
              <div className="metric-value">
                {execution.currentStep ?? 0}/{execution.totalSteps}
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
          {retryError ? <p className="error-text">{retryError}</p> : null}

          <h3 style={{ marginBottom: 8 }}>用例结果</h3>
          {children.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>顺序</th>
                  <th>用例</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {children.map((child) => {
                  const task = tasks.find((item) => item.id === child.taskId);
                  return (
                    <tr key={child.id}>
                      <td>{(child.workflowOrder ?? 0) + 1}</td>
                      <td>{task?.name ?? child.workflowName ?? "未知用例"}</td>
                      <td><StatusBadge status={child.status} /></td>
                      <td>{formatDuration(child.durationMs)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="button small"
                            onClick={() => onSelectExecution?.(child.id)}
                          >
                            步骤详情
                          </button>
                          {/* 父流程收口后才允许子用例旁路重试，避免和编排器派发同一用例冲突。 */}
                          {canManuallyRetry(child.status) && canManuallyRetry(execution.status) ? (
                            <button
                              className="button small primary"
                              disabled={
                                !tasks.some((item) => item.id === child.taskId) ||
                                retryingId === child.id
                              }
                              onClick={() => void handleRetry(child.id)}
                            >
                              <RotateCcw size={14} aria-hidden />
                              {retryingId === child.id ? "重试中" : "重试用例"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty">等待第一个用例派发</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.details}>
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">{task?.name ?? "未知任务"}</div>
            <span className="muted">
              {runnerLabel} · {execution.browser ?? "chromium"} · 尝试 {execution.attempts ?? 1} 次
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canManuallyRetry(execution.status) ? (
              <button
                className="button small primary"
                // 已删除任务的报告仍可查看，但无法安全重建浏览器执行上下文。
                disabled={!task || retryingId === execution.id}
                onClick={() => void handleRetry(execution.id)}
              >
                <RotateCcw size={14} aria-hidden />
                {retryingId === execution.id ? "重试中" : "重试用例"}
              </button>
            ) : null}
            <StatusBadge status={execution.status} />
          </div>
        </div>
        <div className="panel-body">
          <div className={`metric-grid ${styles.metrics}`}>
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
          {retryError ? <p className="error-text">{retryError}</p> : null}
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

      <div className={styles.evidence}>
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
                  <li key={log.index} className={`log-item ${log.status} ${styles.logItem}`}>
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
                    <span className={styles.duration}>{formatDuration(log.durationMs)}</span>
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
                  {/* 面板内保留完整比例；需要检查细节时可直接打开原始截图。 */}
                  <a
                    href={`/api/executions/${execution.id}/artifacts/${log.screenshot}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`查看步骤 ${log.index} 截图原图`}
                  >
                    <img
                      className={`screenshot ${styles.screenshot}`}
                      src={`/api/executions/${execution.id}/artifacts/${log.screenshot}`}
                      alt={`步骤 ${log.index} ${log.status === "failed" ? "失败现场" : "页面"}截图`}
                      loading="lazy"
                    />
                  </a>
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
        <section className="panel" style={{ marginTop: 16 }} aria-busy={healingBusy}>
          <div className="panel-header">
            <h2 className="panel-title">失败修复建议</h2>
            {healableFailure ? (
              <button
                className="button small primary"
                disabled={healingBusy || !task}
                onClick={() => void handleGenerateHealing()}
              >
                <Wrench size={14} aria-hidden />
                {healingBusy ? "生成中" : "生成修复建议"}
              </button>
            ) : null}
          </div>
          <div className="panel-body">
            <p className="muted" style={{ marginTop: 0 }}>
              根据失败截图分析定位器，并回到页面验证。建议生成后，确认应用才会更新用例。
            </p>
            {/* 等待和错误优先于空状态；已有建议仍可查看，便于比较再次生成的结果。 */}
            {healingBusy ? (
              <div className={styles.healingFeedback} role="status" aria-live="polite">
                <RefreshCw size={18} className={styles.spinner} aria-hidden />
                <div>
                  <strong>正在生成修复建议</strong>
                  <p className="muted">正在分析失败截图并验证候选定位器，请稍候。</p>
                </div>
              </div>
            ) : null}
            {healingError ? (
              <div className={`${styles.healingFeedback} error-text`} role="alert">
                {healingError}
              </div>
            ) : null}
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
            ) : healingBusy || healingError ? null : !task ? (
              <div className={styles.healingFeedback}>关联用例已删除，无法生成修复建议。</div>
            ) : healableFailure ? (
              <div className={styles.healingFeedback}>尚未生成修复建议</div>
            ) : (
              <div className={styles.healingFeedback}>当前失败没有可修复的 click / fill 定位器</div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
