/** 仪表盘：直接在服务端读取状态，首屏无需额外接口拼接。 */

import Link from "next/link";
import { Activity } from "lucide-react";
import { ensureSeedTask } from "@/lib/seed";
import { queueSnapshot } from "@/lib/queue";
import { listExecutions, listTasks, summarize } from "@/lib/store";
import { formatDuration, formatTime } from "@/lib/client";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await ensureSeedTask();
  const [summary, queue, executions, tasks] = await Promise.all([
    summarize(),
    queueSnapshot(),
    listExecutions(),
    listTasks(),
  ]);
  const decided = summary.succeeded + summary.failed;
  const passRate = decided ? Math.round((summary.succeeded / decided) * 1000) / 10 : 0;
  const recent = executions.slice(0, 12);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>仪表盘</h1>
          <p>单机运行，当前并发上限 {queue.limits.max}。</p>
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
          <strong className="metric-value">{passRate}%</strong>
        </article>
        <article className="metric">
          <span className="metric-label">失败 / 已中断</span>
          <strong className="metric-value">
            {summary.failed} /{" "}
            {executions.filter((execution) => execution.status === "interrupted").length}
          </strong>
        </article>
        <article className="metric">
          <span className="metric-label">平均耗时</span>
          <strong className="metric-value">{formatDuration(summary.averageDurationMs)}</strong>
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
              style={{ width: `${Math.min(100, (queue.running / queue.concurrency) * 100)}%` }}
            />
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <h2 className="panel-title">最近执行</h2>
          <Link className="button" href="/executions">
            查看全部
          </Link>
        </div>
        {recent.length ? (
          <div className="table-wrap">
            <table className="table">
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
                    <td>{tasks.find((task) => task.id === execution.taskId)?.name ?? "未知任务"}</td>
                    <td>
                      <StatusBadge status={execution.status} />
                    </td>
                    <td>
                      {execution.logs.length}/{execution.totalSteps}
                    </td>
                    <td>{formatDuration(execution.durationMs)}</td>
                    <td>{formatTime(execution.startedAt)}</td>
                    <td>
                      <Link className="button small" href={`/executions?focus=${execution.id}`}>
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
    </>
  );
}
