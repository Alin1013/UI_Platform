/**
 * 流程组合算子画布：左侧提供用例算子，中间呈现串行执行链，右侧保存组合元数据。
 * 点击添加与拖放添加同时保留，保证键盘、触屏和桌面拖拽都能完成编排。
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Save, Trash2, X } from "lucide-react";
import type { AutomationTask, TestWorkflow } from "@/lib/types";
import { createWorkflow, updateWorkflow } from "@/lib/client";
import styles from "./WorkflowBuilder.module.css";

type WorkflowDraft = {
  name: string;
  description: string;
  taskIds: string[];
};

type NodePosition = { x: number; y: number };
type NodePointerDrag = { taskId: string; offsetX: number; offsetY: number } | null;

/** 给新节点留出顺序清晰的默认位置；后续位置只保存在编辑草稿中。 */
function initialPosition(index: number): NodePosition {
  return { x: 28 + (index % 2) * 188, y: 96 + Math.floor(index / 2) * 126 };
}

/** 新建与编辑共用的画布表单；workflow 不存在时就是新建模式。 */
export function WorkflowBuilder({
  tasks,
  workflow,
  onSaved,
  onCancel,
}: {
  tasks: AutomationTask[];
  workflow?: TestWorkflow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<WorkflowDraft>({
    name: workflow?.name ?? "",
    description: workflow?.description ?? "",
    taskIds: workflow?.taskIds ?? [],
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [positions, setPositions] = useState<Record<string, NodePosition>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<NodePointerDrag>(null);

  // 编辑目标由路由异步加载；只在目标 ID 变化时重置画布，避免输入过程中被刷新覆盖。
  useEffect(() => {
    setDraft({
      name: workflow?.name ?? "",
      description: workflow?.description ?? "",
      taskIds: workflow?.taskIds ?? [],
    });
    setPositions(Object.fromEntries((workflow?.taskIds ?? []).map((taskId, index) => [taskId, initialPosition(index)])));
    setMessage("");
  }, [workflow?.id]);

  const selectedTasks = useMemo(
    () => draft.taskIds.map((id) => tasks.find((task) => task.id === id)),
    [draft.taskIds, tasks],
  );
  const canvasHeight = Math.max(516, ...Object.values(positions).map((position) => position.y + 150));

  /** 算子单次只能进入画布一次；坐标决定显示位置，纵向位置决定保存后的执行顺序。 */
  function addTask(taskId: string, position = initialPosition(draft.taskIds.length)) {
    if (draft.taskIds.includes(taskId)) return;
    setDraft((current) => ({ ...current, taskIds: [...current.taskIds, taskId] }));
    setPositions((current) => ({ ...current, [taskId]: position }));
    setMessage("");
  }

  function removeTask(taskId: string) {
    setDraft((current) => ({
      ...current,
      taskIds: current.taskIds.filter((id) => id !== taskId),
    }));
    setPositions((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  /** 相邻交换仍保留给键盘和精细调整；画布拖动则可在任意位置重排。 */
  function moveTask(index: number, offset: -1 | 1) {
    setDraft((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.taskIds.length) return current;
      const next = [...current.taskIds];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, taskIds: next };
    });
  }

  /** 将面板算子放到指针位置；边界节点不进入 taskIds，只作为流程视觉锚点。 */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;
    const canvas = canvasRef.current;
    if (taskId && canvas) {
      const bounds = canvas.getBoundingClientRect();
      addTask(taskId, {
        x: Math.max(16, Math.min(event.clientX - bounds.left - 110, bounds.width - 236)),
        y: Math.max(80, Math.min(event.clientY - bounds.top - 34, 620)),
      });
    }
    setDraggingTaskId("");
  }

  /** 指针拖动允许节点脱离默认竖向链自由摆放，但仍受画布边界约束。 */
  function startNodeDrag(event: React.PointerEvent<HTMLElement>, taskId: string) {
    if ((event.target as HTMLElement).closest("button")) return;
    const node = event.currentTarget.getBoundingClientRect();
    pointerDragRef.current = { taskId, offsetX: event.clientX - node.left, offsetY: event.clientY - node.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNode(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    setPositions((current) => ({
      ...current,
      [drag.taskId]: {
        x: Math.max(16, Math.min(event.clientX - bounds.left - drag.offsetX, bounds.width - 236)),
        y: Math.max(80, Math.min(event.clientY - bounds.top - drag.offsetY, 620)),
      },
    }));
  }

  /** 放开节点时按画布纵向坐标同步执行顺序，横向坐标作为同一行的稳定排序依据。 */
  function finishNodeDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const finalPosition = {
      x: Math.max(16, Math.min(event.clientX - bounds.left - drag.offsetX, bounds.width - 236)),
      y: Math.max(80, Math.min(event.clientY - bounds.top - drag.offsetY, 620)),
    };
    const nextPositions = { ...positions, [drag.taskId]: finalPosition };
    setPositions(nextPositions);
    setDraft((current) => ({
      ...current,
      taskIds: [...current.taskIds].sort((left, right) => {
        const a = nextPositions[left] ?? initialPosition(current.taskIds.indexOf(left));
        const b = nextPositions[right] ?? initialPosition(current.taskIds.indexOf(right));
        return a.y - b.y || a.x - b.x;
      }),
    }));
    pointerDragRef.current = null;
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      setMessage("请填写组合名称");
      return;
    }
    if (!draft.taskIds.length) {
      setMessage("请至少添加一个用例算子");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        name,
        description: draft.description.trim(),
        taskIds: draft.taskIds,
      };
      if (workflow) await updateWorkflow(workflow.id, payload);
      else await createWorkflow(payload);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存组合失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.workspace} aria-label="流程组合算子画布">
      <aside className={styles.operatorPanel} aria-label="算子面板">
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.eyebrow}>OPERATORS</span>
            <h2>算子面板</h2>
          </div>
          <span className="muted">{tasks.length} 个用例</span>
        </div>
        <p className={styles.panelHint}>点击或拖拽用例到画布，按加入顺序串行执行。</p>
        <div className={styles.operatorList}>
          {tasks.length ? (
            tasks.map((task) => {
              const added = draft.taskIds.includes(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`${styles.operator} ${added ? styles.operatorAdded : ""}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", task.id);
                    setDraggingTaskId(task.id);
                  }}
                  onDragEnd={() => setDraggingTaskId("")}
                  onClick={() => addTask(task.id)}
                  aria-label={`${added ? "已添加" : "添加"}用例 ${task.name}`}
                >
                  <GripVertical size={16} aria-hidden />
                  <span>
                    <strong>{task.name}</strong>
                    <small>{added ? "已在流程中" : "用例算子"}</small>
                  </span>
                  <span className={styles.operatorPlus}>{added ? "✓" : "+"}</span>
                </button>
              );
            })
          ) : (
            <p className="muted">暂无用例，请先创建用例。</p>
          )}
        </div>
      </aside>

      <div className={styles.canvasColumn}>
        <div className={styles.canvasToolbar}>
          <div>
            <span className={styles.eyebrow}>WORKFLOW CANVAS</span>
            <h2>串行执行链</h2>
          </div>
          <span className={styles.stepCount}>{draft.taskIds.length} 个步骤</span>
        </div>
        <div
          ref={canvasRef}
          className={`${styles.canvas} ${draft.taskIds.length ? styles.canvasFilled : ""}`}
          style={{ minHeight: canvasHeight }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onPointerMove={moveNode}
          onPointerUp={finishNodeDrag}
          onPointerCancel={() => { pointerDragRef.current = null; }}
        >
          <div
            className={styles.startNode}
            draggable
            role="button"
            tabIndex={0}
            aria-label="开始节点"
          >
            <span>开始</span>
          </div>
          {selectedTasks.map((task, index) => (
            <div
              className={styles.nodeGroup}
              key={draft.taskIds[index]}
              style={{ left: positions[draft.taskIds[index] ?? ""]?.x ?? initialPosition(index).x, top: positions[draft.taskIds[index] ?? ""]?.y ?? initialPosition(index).y }}
            >
              <article
                className={styles.node}
                onPointerDown={(event) => startNodeDrag(event, draft.taskIds[index]!)}
              >
                <div className={styles.nodeIndex}>{index + 1}</div>
                <div className={styles.nodeContent}>
                  <span className={styles.nodeType}>用例算子</span>
                  <strong>{task?.name ?? "未知用例"}</strong>
                </div>
                <div className={styles.nodeActions}>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => moveTask(index, -1)}
                    disabled={index === 0}
                    aria-label={`上移第 ${index + 1} 个用例`}
                  >
                    <ArrowUp size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => moveTask(index, 1)}
                    disabled={index === selectedTasks.length - 1}
                    aria-label={`下移第 ${index + 1} 个用例`}
                  >
                    <ArrowDown size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="button small danger"
                    onClick={() => removeTask(draft.taskIds[index]!)}
                    aria-label={`移除第 ${index + 1} 个用例`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </article>
            </div>
          ))}
          <div
            className={styles.endNode}
            draggable
            role="button"
            tabIndex={0}
            style={{ top: canvasHeight - 52 }}
            aria-label="结束节点"
          >
            <span>结束</span>
          </div>
          {!draft.taskIds.length ? <p className={styles.canvasEmpty}>从左侧添加第一个用例算子</p> : null}
        </div>
      </div>

      <aside className={styles.settingsPanel} aria-label="组合设置">
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.eyebrow}>WORKFLOW SETTINGS</span>
            <h2>{workflow ? "编辑组合" : "新建组合"}</h2>
          </div>
          <button className={styles.closeButton} type="button" onClick={onCancel} aria-label="取消并返回组合列表">
            <X size={17} aria-hidden />
          </button>
        </div>
        <div className={styles.fields}>
          <label className="field" htmlFor="workflow-name">
            <span>组合名称 <em className="requiredMark" aria-hidden="true">*</em></span>
            <input
              id="workflow-name"
              required
              aria-label="组合名称"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：登录后创建订单"
            />
          </label>
          <label className="field" htmlFor="workflow-description">
            <span>说明</span>
            <textarea
              id="workflow-description"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="描述这个组合验证的业务路径"
              rows={4}
            />
          </label>
        </div>
        <div className={styles.settingsSummary}>
          <span>执行策略</span>
          <strong>串行执行，失败即停止</strong>
        </div>
        {message ? <p className="error-text" role="alert">{message}</p> : null}
        <div className={styles.formActions}>
          <button className="button primary" type="button" disabled={saving} onClick={() => void save()}>
            <Save size={16} aria-hidden />
            {saving ? "保存中" : workflow ? "保存修改" : "保存组合"}
          </button>
          <button className="button" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </aside>
    </section>
  );
}
