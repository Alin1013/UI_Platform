/**
 * 流程组合管理器。
 * 选中顺序就是运行顺序；组合只引用单用例，不复制步骤定义。
 */

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { AutomationTask, TaskExecution, TestWorkflow } from "@/lib/types";
import {
  canManuallyRetry,
  createWorkflow,
  removeWorkflow,
  runWorkflow,
  updateWorkflow,
} from "@/lib/client";
import { StatusBadge } from "./StatusBadge";

export function WorkflowManager({
  tasks,
  workflows,
  latestExecutions,
  onRetryWorkflow,
  onSaved,
}: {
  tasks: AutomationTask[];
  workflows: TestWorkflow[];
  /** 每个组合最近一次父执行；列表用它展示结果并判断是否可重试。 */
  latestExecutions: Record<string, TaskExecution | undefined>;
  /** 重试沿用原父执行上下文，由用例页统一跳转到新父执行。 */
  onRetryWorkflow: (workflow: TestWorkflow) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  // undefined 表示关闭编辑；null 表示新建；具体对象表示编辑已保存组合。
  const [editing, setEditing] = useState<TestWorkflow | null | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [retryingId, setRetryingId] = useState("");

  // 编辑目标切换时同步重建草稿，避免上一次组合的顺序残留到新建表单。
  useEffect(() => {
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setSelectedTaskIds(editing?.taskIds ?? []);
    setMessage("");
  }, [editing]);

  function toggleTask(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((item) => item !== taskId)
        : [...current, taskId],
    );
  }

  function moveTask(taskId: string, offset: -1 | 1) {
    setSelectedTaskIds((current) => {
      const index = current.indexOf(taskId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      // 相邻交换保证用户看到的上移/下移就是实际执行顺序变化。
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** 保存新建或已有组合；后端负责非空、去重和上限校验。 */
  async function saveWorkflow() {
    setBusyId("save");
    setMessage("");
    try {
      const payload = { name, description, taskIds: selectedTaskIds };
      if (editing) {
        await updateWorkflow(editing.id, payload);
      } else {
        await createWorkflow(payload);
      }
      setEditing(undefined);
      await onSaved();
      setMessage("流程组合已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存组合失败");
    } finally {
      setBusyId("");
    }
  }

  /** 运行后整页跳到父执行；父报告内可继续下钻到子用例步骤。 */
  async function startWorkflow(workflow: TestWorkflow) {
    setBusyId(workflow.id);
    setMessage("");
    try {
      const payload = await runWorkflow(workflow.id);
      window.location.href = `/executions?focus=${payload.execution.id}`;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流程提交失败");
      setBusyId("");
    }
  }

  /** 列表内的手动重试只处理已失败的最近父执行，避免绕过前端状态提示。 */
  async function retryWorkflow(workflow: TestWorkflow) {
    setRetryingId(workflow.id);
    setMessage("");
    try {
      await onRetryWorkflow(workflow);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流程重试失败");
    } finally {
      setRetryingId("");
    }
  }

  /** 只删除组合定义；单用例与历史父/子执行报告不受影响。 */
  async function deleteWorkflow(workflow: TestWorkflow) {
    if (!window.confirm(`删除流程组合「${workflow.name}」？历史报告会保留。`)) {
      return;
    }
    setBusyId(workflow.id);
    setMessage("");
    try {
      await removeWorkflow(workflow.id);
      if (editing?.id === workflow.id) setEditing(undefined);
      await onSaved();
      setMessage("流程组合已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除组合失败");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        <h2 className="panel-title">流程组合</h2>
        <span className="muted">{workflows.length} 个组合</span>
      </div>

      <div className="panel-body">
        <p className="muted" style={{ marginTop: 0 }}>
          选择多个用例后按显示顺序串行执行；任一用例失败即停止后续用例。
        </p>
        <p className="error-text">{message}</p>

        {selectedTaskIds.length || editing ? (
          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div className="form-grid">
              <label>
                <span>组合名称</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：登录后创建订单"
                />
              </label>
              <label>
                <span>说明</span>
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="可选"
                />
              </label>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <strong>执行顺序</strong>
              {selectedTaskIds.length ? (
                selectedTaskIds.map((taskId, index) => {
                  const task = tasks.find((item) => item.id === taskId);
                  return (
                    <div
                      key={taskId}
                      className="button"
                      style={{ justifyContent: "space-between", background: "white" }}
                    >
                      <span>{index + 1}. {task?.name ?? "未知用例"}</span>
                      <span style={{ display: "flex", gap: 4 }}>
                        <button
                          className="button small"
                          disabled={index === 0}
                          onClick={() => moveTask(taskId, -1)}
                          aria-label="上移用例"
                        >
                          <ArrowUp size={14} aria-hidden />
                        </button>
                        <button
                          className="button small"
                          disabled={index === selectedTaskIds.length - 1}
                          onClick={() => moveTask(taskId, 1)}
                          aria-label="下移用例"
                        >
                          <ArrowDown size={14} aria-hidden />
                        </button>
                        <button
                          className="button small danger"
                          onClick={() => toggleTask(taskId)}
                          aria-label="移除用例"
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="empty">尚未选择用例</div>
              )}
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-start" }}>
              <button
                className="button primary"
                disabled={!name.trim() || !selectedTaskIds.length || busyId === "save"}
                onClick={() => void saveWorkflow()}
              >
                <Save size={16} aria-hidden />
                {editing ? "更新组合" : "保存组合"}
              </button>
              <button className="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
            </div>
          </div>
        ) : null}

        {workflows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>用例顺序</th>
                <th>最近状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>
                    <strong>{workflow.name}</strong>
                    {workflow.description ? (
                      <p className="muted" style={{ margin: "4px 0 0" }}>
                        {workflow.description}
                      </p>
                    ) : null}
                  </td>
                  <td>
                    {workflow.taskIds
                      .map((taskId) => tasks.find((task) => task.id === taskId)?.name ?? "未知用例")
                      .join(" → ")}
                  </td>
                  <td>
                    {latestExecutions[workflow.id] ? (
                      <StatusBadge status={latestExecutions[workflow.id]!.status} />
                    ) : (
                      <span className="muted">未运行</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="button small primary"
                        disabled={busyId === workflow.id}
                        onClick={() => void startWorkflow(workflow)}
                      >
                        <Play size={14} aria-hidden />
                        运行
                      </button>
                      {(() => {
                        const latest = latestExecutions[workflow.id];
                        const retryable = canManuallyRetry(latest?.status);
                        if (!retryable) return null;
                        return (
                          <button
                            className="button small primary"
                            disabled={busyId === workflow.id || retryingId === workflow.id}
                            onClick={() => void retryWorkflow(workflow)}
                          >
                            <RotateCcw size={14} aria-hidden />
                            {retryingId === workflow.id ? "重试中" : "重试"}
                          </button>
                        );
                      })()}
                      <button
                        className="button small"
                        disabled={busyId === workflow.id}
                        onClick={() => setEditing(workflow)}
                      >
                        <Pencil size={14} aria-hidden />
                        编辑
                      </button>
                      <button
                        className="button small danger"
                        disabled={busyId === workflow.id}
                        onClick={() => void deleteWorkflow(workflow)}
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
        ) : (
          <div className="empty">暂无组合；先在下方勾选用例并保存。</div>
        )}

        <div style={{ marginTop: 16 }}>
          <strong>可选用例</strong>
          {tasks.length ? (
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {tasks.map((task) => (
                <label
                  key={task.id}
                  className="button"
                  style={{ justifyContent: "space-between", background: "white" }}
                >
                  <span>{task.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.includes(task.id)}
                    onChange={() => toggleTask(task.id)}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="empty" style={{ marginTop: 8 }}>
              暂无单用例；先创建用例再组合。
            </div>
          )}
        </div>

        {!editing && !selectedTaskIds.length ? (
          <div className="toolbar" style={{ justifyContent: "flex-start", marginTop: 12 }}>
            <button className="button primary" onClick={() => setEditing(null)}>
              <Plus size={16} aria-hidden />
              新建组合
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
