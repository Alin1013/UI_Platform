/** 测试工作流画布：编排单用例和普通组合引用，不复制被引用定义的步骤。 */

"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Layers3, ListChecks, Save, Trash2 } from "lucide-react";
import type { AutomationTask, TestWorkflow, WorkflowNode } from "@/lib/types";
import { createWorkflow, updateWorkflow } from "@/lib/client";
import styles from "./TestWorkflowBuilder.module.css";

type Draft = { name: string; description: string; nodes: WorkflowNode[] };

/** 一条执行链可以交错引用单用例和组合；节点顺序就是最终执行顺序。 */
export function TestWorkflowBuilder({
  tasks,
  compositions,
  workflow,
  onSaved,
  onCancel,
}: {
  tasks: AutomationTask[];
  compositions: TestWorkflow[];
  workflow?: TestWorkflow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: workflow?.name ?? "",
    description: workflow?.description ?? "",
    nodes: workflow?.nodes ?? [],
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // 深链接异步载入编辑目标；仅目标 ID 变化时恢复草稿，保持用户的局部排序操作。
  useEffect(() => {
    setDraft({
      name: workflow?.name ?? "",
      description: workflow?.description ?? "",
      nodes: workflow?.nodes ?? [],
    });
    setError("");
  }, [workflow?.id]);

  function hasNode(node: WorkflowNode) {
    return draft.nodes.some((current) =>
      current.type === node.type &&
      (node.type === "task"
        ? current.type === "task" && current.taskId === node.taskId
        : current.type === "workflow" && current.workflowId === node.workflowId),
    );
  }

  function addNode(node: WorkflowNode) {
    if (hasNode(node)) return;
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
  }

  function moveNode(index: number, offset: -1 | 1) {
    setDraft((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.nodes.length) return current;
      const nodes = [...current.nodes];
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      return { ...current, nodes };
    });
  }

  function removeNode(index: number) {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((_, nodeIndex) => nodeIndex !== index),
    }));
  }

  function nodeName(node: WorkflowNode) {
    return node.type === "task"
      ? tasks.find((task) => task.id === node.taskId)?.name ?? "未知用例"
      : compositions.find((item) => item.id === node.workflowId)?.name ?? "未知组合";
  }

  async function save() {
    if (!draft.name.trim()) return setError("请填写测试工作流名称");
    if (!draft.nodes.length) return setError("请至少添加一个用例或组合");
    setSaving(true);
    setError("");
    try {
      const payload = {
        kind: "test-workflow" as const,
        name: draft.name.trim(),
        description: draft.description.trim(),
        taskIds: [],
        nodes: draft.nodes,
      };
      if (workflow) await updateWorkflow(workflow.id, payload);
      else await createWorkflow(payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存测试工作流失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.builder} aria-label="测试工作流画布">
      <aside className={styles.sources}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>SOURCES</span>
            <h2>可用节点</h2>
          </div>
          <span className="muted">{tasks.length + compositions.length}</span>
        </div>
        <section className={styles.sourceGroup} aria-label="单测试用例">
          <h3><ListChecks size={15} aria-hidden />单测试用例</h3>
          {tasks.map((task) => {
            const node: WorkflowNode = { type: "task", taskId: task.id };
            return (
              <button key={task.id} type="button" aria-label={`${hasNode(node) ? "已添加" : "添加单测试用例"} ${task.name}`} disabled={hasNode(node)} onClick={() => addNode(node)}>
                <span>{task.name}</span><strong>{hasNode(node) ? "已添加" : "+"}</strong>
              </button>
            );
          })}
          {!tasks.length ? <p className="muted">暂无单测试用例</p> : null}
        </section>
        <section className={styles.sourceGroup} aria-label="组合测试流">
          <h3><Layers3 size={15} aria-hidden />组合测试流</h3>
          {compositions.map((composition) => {
            const node: WorkflowNode = { type: "workflow", workflowId: composition.id };
            return (
              <button key={composition.id} type="button" aria-label={`${hasNode(node) ? "已添加" : "添加组合测试流"} ${composition.name}`} disabled={hasNode(node)} onClick={() => addNode(node)}>
                <span>{composition.name}</span><strong>{hasNode(node) ? "已添加" : "+"}</strong>
              </button>
            );
          })}
          {!compositions.length ? <p className="muted">暂无组合测试流</p> : null}
        </section>
      </aside>

      <div className={styles.flow}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>TEST WORKFLOW</span>
            <h2>测试工作流</h2>
          </div>
          <span className={styles.count}>{draft.nodes.length} 个节点</span>
        </div>
        <div className={styles.canvas}>
          <div className={styles.terminal}>开始</div>
          {draft.nodes.map((node, index) => (
            <div className={styles.nodeWrap} key={`${node.type}:${node.type === "task" ? node.taskId : node.workflowId}`}>
              <div className={styles.arrow} aria-hidden>↓</div>
              <article className={styles.node}>
                <span className={styles.nodeNumber}>{index + 1}</span>
                <div className={styles.nodeText}>
                  <small>{node.type === "task" ? "单测试用例" : "组合测试流"}</small>
                  <strong>{nodeName(node)}</strong>
                </div>
                <div className={styles.nodeActions}>
                  <button className="button small" type="button" disabled={index === 0} onClick={() => moveNode(index, -1)} aria-label={`上移第 ${index + 1} 个节点`}><ArrowUp size={14} aria-hidden /></button>
                  <button className="button small" type="button" disabled={index === draft.nodes.length - 1} onClick={() => moveNode(index, 1)} aria-label={`下移第 ${index + 1} 个节点`}><ArrowDown size={14} aria-hidden /></button>
                  <button className="button small danger" type="button" onClick={() => removeNode(index)} aria-label={`移除第 ${index + 1} 个节点`}><Trash2 size={14} aria-hidden /></button>
                </div>
              </article>
            </div>
          ))}
          <div className={styles.arrow} aria-hidden>↓</div>
          <div className={`${styles.terminal} ${styles.end}`}>结束</div>
          {!draft.nodes.length ? <p className={styles.emptyHint}>从左侧选择单测试用例或组合测试流</p> : null}
        </div>
      </div>

      <aside className={styles.settings}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>SETTINGS</span><h2>{workflow ? "编辑工作流" : "工作流信息"}</h2></div>
        </div>
        <label className="field" htmlFor="test-workflow-name">工作流名称 <em className="requiredMark" aria-hidden="true">*</em>
          <input id="test-workflow-name" required aria-label="工作流名称" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：核心登录回归" />
        </label>
        <label className="field" htmlFor="test-workflow-description">说明
          <textarea id="test-workflow-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={4} placeholder="可选" />
        </label>
        <p className={styles.policy}>工作流将按节点顺序串行执行；节点失败后停止后续执行。</p>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button className="button primary" type="button" disabled={saving} onClick={() => void save()}><Save size={15} aria-hidden />{saving ? "保存中" : workflow ? "保存修改" : "保存工作流"}</button>
          <button className="button" type="button" onClick={onCancel}>取消</button>
        </div>
      </aside>
    </section>
  );
}
