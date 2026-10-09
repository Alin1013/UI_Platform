/** 报告页：按执行记录回看步骤、截图和最终结论。 */

"use client";

import { useEffect, useState } from "react";
import type { AutomationTask, TaskExecution } from "@/lib/types";
import { loadExecutions, loadTasks } from "@/lib/client";
import { ExecutionDetails } from "@/components/ExecutionDetails";

export default function ReportsPage() {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "succeeded" | "failed">("all");

  useEffect(() => {
    Promise.all([loadTasks(), loadExecutions()])
      .then(([taskPayload, executionPayload]) => {
        setTasks(taskPayload.tasks);
        setExecutions(executionPayload.executions);
        // 报告页默认展开最新一次运行，减少用户从任务页跳回后再找记录的成本。
        setSelectedId((current) => current || executionPayload.executions[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

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
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          aria-label="按状态筛选报告"
        >
          <option value="all">全部状态</option>
          <option value="succeeded">已通过</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        {filtered.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>步骤</th>
                <th>开始时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((execution) => (
                <tr key={execution.id}>
                  <td>{tasks.find((task) => task.id === execution.taskId)?.name ?? "未知任务"}</td>
                  <td>{execution.status}</td>
                  <td>{execution.logs.length}/{execution.totalSteps}</td>
                  <td>{execution.startedAt ? new Date(execution.startedAt).toLocaleString("zh-CN") : "-"}</td>
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
          <div className="empty">当前筛选条件下没有报告</div>
        )}
      </section>

      {selectedId ? <ExecutionDetails executionId={selectedId} tasks={tasks} /> : null}
    </>
  );
}
