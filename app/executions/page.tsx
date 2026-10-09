/** 执行监控页：查看排队、运行中和历史执行。 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AutomationTask, TaskExecution } from "@/lib/types";
import { loadExecutions, loadTasks } from "@/lib/client";
import { StatusBadge } from "@/components/StatusBadge";
import { ExecutionDetails } from "@/components/ExecutionDetails";

function ExecutionsView() {
  const searchParams = useSearchParams();
  const initialFocus = searchParams.get("focus");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [selectedId, setSelectedId] = useState(initialFocus);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [taskPayload, executionPayload] = await Promise.all([
        loadTasks(),
        loadExecutions(),
      ]);
      if (!alive) return;
      setTasks(taskPayload.tasks);
      setExecutions(executionPayload.executions);
      // 没有显式 focus 时自动选中最新执行，方便从任务页运行后查看结果。
      setSelectedId((current) => current ?? executionPayload.executions[0]?.id ?? null);
      const active = executionPayload.executions.some(
        (execution) => execution.status === "queued" || execution.status === "running",
      );
      if (active) setTimeout(load, 1500);
    }
    load().catch(() => undefined);
    return () => {
      alive = false;
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

      <div className="split">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">执行记录</h2>
            <span className="muted">{executions.length} 条</span>
          </div>
          {executions.length ? (
            <div className="panel-body" style={{ display: "grid", gap: 8 }}>
              {executions.map((execution) => (
                <button
                  key={execution.id}
                  className="button"
                  style={{
                    justifyContent: "space-between",
                    background: execution.id === selectedId ? "var(--surface-muted)" : "white",
                  }}
                  onClick={() => setSelectedId(execution.id)}
                >
                  <span>{tasks.find((task) => task.id === execution.taskId)?.name ?? "未知任务"}</span>
                  <StatusBadge status={execution.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">还没有执行；先到任务管理运行一个流程。</div>
          )}
        </section>

        <div>
          {selectedId ? (
            <ExecutionDetails executionId={selectedId} tasks={tasks} />
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
