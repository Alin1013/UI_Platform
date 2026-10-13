/** 仪表盘：直接在服务端读取状态，首屏无需额外接口拼接。 */

import Link from "next/link";
import { Activity } from "lucide-react";
import { ensureSeedTask } from "@/lib/seed";
import { queueSnapshot } from "@/lib/queue";
import { listExecutions, listTasks } from "@/lib/store";
import { summarizeLatestTasks } from "@/lib/dashboard";
import { formatDuration, formatTime } from "@/lib/client";
import { StatusBadge } from "@/components/StatusBadge";
import { ExecutionPie } from "./ExecutionPie";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

/** 所有结果摘要先按用例去重，再截取最近列表；历史重试不会扩大失败数或挤占列表。 */
export default async function DashboardPage() {
  await ensureSeedTask();
  const [queue, executions, tasks] = await Promise.all([
    queueSnapshot(),
    listExecutions(),
    listTasks(),
  ]);
  const summary = summarizeLatestTasks(tasks, executions);
  const recent = summary.latest.slice(0, 12);
  const taskNames = new Map(tasks.map((task) => [task.id, task.name]));

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>仪表盘</h1>
          <p>
            单机运行，当前并发上限 {queue.limits.max}
            。统计按每个用例的最新一次执行计算。
          </p>
        </div>
        <Link className="button primary" href="/tasks">
          管理任务
        </Link>
      </div>

      <section className="metric-grid">
        <article className="metric">
          <span className="metric-label">任务总数</span>
          <strong className="metric-value">{summary.taskCount}</strong>
        </article>
        <article className="metric">
          <span className="metric-label">通过率</span>
          <strong className="metric-value">{summary.passRate}%</strong>
          <span className={styles.metricHint}>最新已结束用例中的通过比例</span>
        </article>
        <article className="metric">
          <span className="metric-label">失败 / 已中断</span>
          <strong className="metric-value">
            {summary.counts.failed} / {summary.counts.interrupted}
          </strong>
        </article>
        <article className="metric">
          <span className="metric-label">平均耗时</span>
          <strong className="metric-value">
            {formatDuration(summary.averageDurationMs)}
          </strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">队列状态</h2>
          <span className="muted">
            执行 {queue.running} / {queue.concurrency}，排队 {queue.queued}
          </span>
        </div>
        <div className="panel-body">
          <div className="progress">
            <div
              className="progress-bar"
              style={{
                width: `${Math.min(100, (queue.running / queue.concurrency) * 100)}%`,
              }}
            />
          </div>
        </div>
      </section>

      <div className={styles.results}>
        <section
          className="panel"
          aria-labelledby="execution-distribution-title"
        >
          <div className="panel-header">
            <div className={styles.panelHeading}>
              <h2 className="panel-title" id="execution-distribution-title">
                用例状态分布
              </h2>
              <p className={styles.hint}>每个用例仅计一次，含未执行用例</p>
            </div>
          </div>
          <ExecutionPie summary={summary} />
        </section>
        <section className="panel" aria-labelledby="recent-executions-title">
          <div className="panel-header">
            <div className={styles.panelHeading}>
              <h2 className="panel-title" id="recent-executions-title">
                最近执行
              </h2>
              <p className={styles.hint}>
                每个用例仅展示最新一次，最多 12 个用例
              </p>
            </div>
            <Link className="button" href="/executions">
              查看全部
            </Link>
          </div>
          {recent.length ? (
            <div className="table-wrap">
              <table className={`table ${styles.recentTable}`}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>进度</th>
                    <th>耗时</th>
                    <th>开始时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((execution) => (
                    <tr key={execution.id}>
                      <td>{taskNames.get(execution.taskId)}</td>
                      <td>
                        <StatusBadge status={execution.status} />
                      </td>
                      <td>
                        {execution.logs.length}/{execution.totalSteps}
                      </td>
                      <td>{formatDuration(execution.durationMs)}</td>
                      <td>{formatTime(execution.startedAt)}</td>
                      <td>
                        <Link
                          className="button small"
                          href={`/executions?focus=${execution.id}`}
                        >
                          详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <Activity size={22} aria-hidden />
              <p>还没有执行记录；进入任务管理运行内置示例。</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
