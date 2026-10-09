/** 报告页：按执行记录回看步骤、截图和最终结论。 */

"use client";

import { useEffect, useState } from "react";
import type { AutomationTask, TaskExecution } from "@/lib/types";
import { loadExecutions, loadTasks } from "@/lib/client";
import { ExecutionDetails } from "@/components/ExecutionDetails";
import { StatusBadge } from "@/components/StatusBadge";

type ReportStatusFilter = "all" | "succeeded" | "failed";

/** 只接受下拉框声明过的选项，避免后续状态扩展时把任意字符串灌进筛选状态。 */
function parseStatusFilter(value: string): ReportStatusFilter {
  return value === "succeeded" || value === "failed" ? value : "all";
}

export default function ReportsPage() {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("all");
  const [error, setError] = useState("");

  useEffect(() => {
    // 任务名和执行报告是同一视图的两个数据源，必须一起加载；失败要显式提示而不是误显示为空列表。
    async function load() {
      try {
        const [taskPayload, executionPayload] = await Promise.all([
          loadTasks(),
          loadExecutions(),
        ]);
        setTasks(taskPayload.tasks);
        setExecutions(executionPayload.executions);
        // 报告页默认展开最新一次运行，减少用户从任务页跳回后再找记录的成本。
        setSelectedId((current) => current || executionPayload.executions[0]?.id || "");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "加载执行报告失败");
      }
    }

    void load();
  }, []);

  const taskName = (taskId: string) =>
    tasks.find((task) => task.id === taskId)?.name ?? "未知任务";
  const completedSteps = (execution: TaskExecution) =>
    `${execution.logs.length}/${execution.totalSteps}`;

  const filtered = executions.filter(
    (execution) => statusFilter === "all" || execution.status === statusFilter,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>执行报告</h1>
          <p>每一次运行都会保留逐步日志和页面截图。</p>
        </div>
      </div>

      <div className="toolbar">
        <select
          className="button"
          value={statusFilter}
          onChange={(event) => setStatusFilter(parseStatusFilter(event.target.value))}
          aria-label="按状态筛选报告"
        >
          <option value="all">全部状态</option>
          <option value="succeeded">已通过</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <p className="error-text">{error}</p>

      <section className="panel" style={{ marginBottom: 16 }}>
        {filtered.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>引擎</th>
                <th>状态</th>
                <th>步骤</th>
                <th>开始时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((execution) => (
                <tr key={execution.id}>
                  <td>{taskName(execution.taskId)}</td>
                  <td>{execution.runner === "midscene" ? "Midscene" : "Playwright"}</td>
                  <td>
                    <StatusBadge status={execution.status} />
                  </td>
                  <td>{completedSteps(execution)}</td>
                  <td>
                    {execution.startedAt
                      ? new Date(execution.startedAt).toLocaleString("zh-CN")
                      : "-"}
                  </td>
                  <td>
                    <button
                      className="button small"
                      onClick={() => setSelectedId(execution.id)}
                      disabled={execution.id === selectedId}
                    >
                      查看报告
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{error || "当前筛选条件下没有报告"}</div>
        )}
      </section>

      {selectedId ? <ExecutionDetails executionId={selectedId} tasks={tasks} /> : null}
    </>
  );
}
