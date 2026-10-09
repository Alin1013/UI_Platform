/**
 * 任务编辑器。
 * 自然语言生成的步骤先落到这里，供人工校对后再保存和执行。
 */

import { useEffect, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import type { AutomationAction, AutomationStep, AutomationTask } from "@/lib/types";
import { createTask, updateTask } from "@/lib/client";

interface StepDraft extends AutomationStep {
  key: string;
}

const actionOptions: Array<{ value: AutomationAction; label: string }> = [
  { value: "goto", label: "打开页面" },
  { value: "click", label: "点击" },
  { value: "fill", label: "输入" },
  { value: "press", label: "按键" },
  { value: "wait", label: "等待" },
  { value: "expectText", label: "断言文本" },
];

function stepKey(): string {
  return `${Date.now()}-${Math.random()}`;
}

function draftFromTask(task?: AutomationTask | null) {
  return {
    name: task?.name ?? "",
    description: task?.description ?? "",
    labels: task?.labels.join(", ") ?? "",
    headless: task?.headless ?? true,
    steps: (task?.steps ?? [
      { action: "goto" as AutomationAction, value: "/demo/login.html" },
    ]).map((step) => ({ ...step, key: stepKey() })),
  };
}

export function TaskEditor({
  task,
  onSaved,
  onCancel,
}: {
  task?: AutomationTask | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFromTask(task));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // 编辑目标切换时重置表单，避免上一次编辑内容串到新任务。
  useEffect(() => {
    setDraft(draftFromTask(task));
    setError("");
  }, [task]);

  function updateStep(index: number, key: keyof AutomationStep, value: string) {
    setDraft((current) => {
      const steps = [...current.steps];
      steps[index] = { ...steps[index], [key]: value };
      return { ...current, steps };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: draft.name,
        target: "web",
        description: draft.description || undefined,
        labels: draft.labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        headless: draft.headless,
        // 表单里的空值统一剔除，避免把 "undefined" 字符串传给 Playwright。
        steps: draft.steps.map(({ key: _key, ...step }) =>
          Object.fromEntries(
            Object.entries(step).filter(([, value]) => value !== "" && value != null),
          ),
        ),
      };
      if (task) await updateTask(task.id, payload);
      else await createTask(payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel-body" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="task-name">任务名称</label>
          <input
            id="task-name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="task-labels">标签（逗号分隔）</label>
          <input
            id="task-labels"
            value={draft.labels}
            onChange={(event) => setDraft({ ...draft, labels: event.target.value })}
          />
        </div>
        <div className="field wide">
          <label htmlFor="task-description">描述</label>
          <textarea
            id="task-description"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </div>
        <div className="field full-width">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.headless}
              onChange={(event) => setDraft({ ...draft, headless: event.target.checked })}
            />
            无头模式运行 Chromium
          </label>
        </div>
      </div>

      <div className="field wide" style={{ marginTop: 18 }}>
        <label>执行步骤</label>
        <div className="steps-editor">
          {draft.steps.map((step, index) => (
            <div className="step-row" key={step.key}>
              <span className="step-index">{index + 1}</span>
              <select
                value={step.action}
                onChange={(event) => updateStep(index, "action", event.target.value)}
                aria-label={`步骤 ${index + 1} 动作`}
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="step-action-value"
                value={step.target ?? ""}
                placeholder={step.action === "goto" ? "可不填" : "Playwright 定位器"}
                onChange={(event) => updateStep(index, "target", event.target.value)}
                aria-label={`步骤 ${index + 1} 目标`}
              />
              <input
                className="step-action-value"
                value={step.value ?? ""}
                placeholder={
                  step.action === "goto"
                    ? "/demo/login.html 或完整 URL"
                    : step.action === "wait"
                      ? "毫秒"
                      : "输入值或期望文本"
                }
                onChange={(event) => updateStep(index, "value", event.target.value)}
                aria-label={`步骤 ${index + 1} 值`}
              />
              <input
                type="number"
                min={100}
                step={100}
                value={step.timeout ?? ""}
                placeholder="超时"
                onChange={(event) => updateStep(index, "timeout", event.target.value)}
                aria-label={`步骤 ${index + 1} 超时毫秒`}
              />
              <button
                type="button"
                className="button danger small"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    steps: current.steps.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
                aria-label={`删除步骤 ${index + 1}`}
              >
                <X size={15} aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                steps: [...current.steps, { action: "click", key: stepKey() }],
              }))
            }
          >
            <Plus size={16} aria-hidden />
            添加步骤
          </button>
        </div>
      </div>

      <p className="error-text">{error}</p>
      <div className="toolbar" style={{ justifyContent: "flex-start" }}>
        <button className="button primary" disabled={saving}>
          <Save size={16} aria-hidden />
          {saving ? "保存中" : "保存任务"}
        </button>
        {onCancel ? (
          <button type="button" className="button" onClick={onCancel}>
            <X size={16} aria-hidden />
            取消
          </button>
        ) : null}
      </div>
    </form>
  );
}
