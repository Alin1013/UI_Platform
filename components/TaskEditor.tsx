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
  /** aiQuery 用 JSON 编辑；提交时统一解析成 schema 对象。 */
  schemaText?: string;
}

const actionOptions: Array<{ value: AutomationAction; label: string }> = [
  { value: "goto", label: "打开页面" },
  { value: "click", label: "点击" },
  { value: "fill", label: "输入" },
  { value: "press", label: "按键" },
  { value: "wait", label: "等待" },
  { value: "expectText", label: "断言文本" },
  { value: "aiAct", label: "AI 操作" },
  { value: "aiAssert", label: "AI 断言" },
  { value: "aiQuery", label: "AI 提取" },
  { value: "aiWaitFor", label: "AI 等待" },
];

const runnerOptions = [
  { value: "playwright", label: "Playwright（确定性）" },
  { value: "midscene", label: "Midscene（AI）" },
] as const;

const browserOptions = [
  { value: "chromium", label: "Chromium" },
  { value: "firefox", label: "Firefox" },
  { value: "webkit", label: "WebKit" },
] as const;

function stepKey(): string {
  return `${Date.now()}-${Math.random()}`;
}

function draftFromTask(task?: AutomationTask | null) {
  return {
    name: task?.name ?? "",
    description: task?.description ?? "",
    labels: task?.labels.join(", ") ?? "",
    headless: task?.headless ?? true,
    runner: task?.runner ?? "playwright",
    runtime: task?.runtime ?? {},
    steps: (task?.steps ?? [
      { action: "goto" as AutomationAction, value: "/demo/login.html" },
    ]).map((step) => ({
      ...step,
      key: stepKey(),
      schemaText: step.schema ? JSON.stringify(step.schema, null, 2) : undefined,
    })),
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

  function updateStep(index: number, key: "target" | "value", value: string) {
    setDraft((current) => {
      const steps = [...current.steps];
      steps[index] = { ...steps[index], [key]: value };
      return { ...current, steps };
    });
  }

  function updateTimeout(index: number, value: string) {
    setDraft((current) => {
      const steps = [...current.steps];
      const timeout = value === "" ? undefined : Number(value);
      steps[index] = {
        ...steps[index],
        timeout: timeout && Number.isFinite(timeout) ? timeout : undefined,
      };
      return { ...current, steps };
    });
  }

  function updateSchema(index: number, value: string) {
    setDraft((current) => {
      const steps = [...current.steps];
      steps[index] = { ...steps[index], schemaText: value };
      return { ...current, steps };
    });
  }

  /** 切换动作时清理不相关字段，避免保存出 target/value/schema 互相矛盾的历史数据。 */
  function changeAction(index: number, action: AutomationAction) {
    setDraft((current) => {
      const steps = [...current.steps];
      steps[index] = {
        ...steps[index],
        action,
        schema: action === "aiQuery" ? steps[index].schema : undefined,
        schemaText: action === "aiQuery" ? steps[index].schemaText : undefined,
      };
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
        runner: draft.runner,
        runtime: {
          ...draft.runtime,
          retries: draft.runtime.retries == null ? undefined : Number(draft.runtime.retries),
        },
        description: draft.description || undefined,
        labels: draft.labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        headless: draft.headless,
        // 表单里的空值统一剔除，避免把 "undefined" 字符串传给 Playwright。
        steps: draft.steps.map(({ key: _key, schemaText, ...step }) => {
          if (step.action !== "aiQuery") return step;
          return { ...step, schema: JSON.parse(schemaText || "{}") };
        }),
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
            无头模式运行
          </label>
        </div>
        <div className="field">
          <label htmlFor="task-runner">执行引擎</label>
          <select
            id="task-runner"
            value={draft.runner}
            onChange={(event) =>
              setDraft({ ...draft, runner: event.target.value as typeof draft.runner })
            }
          >
            {runnerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-browser">浏览器</label>
          <select
            id="task-browser"
            value={draft.runtime.browser ?? "chromium"}
            onChange={(event) =>
              setDraft({
                ...draft,
                runtime: {
                  ...draft.runtime,
                  browser: event.target.value as typeof draft.runtime.browser,
                },
              })
            }
          >
            {browserOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-retries">失败重试次数</label>
          <input
            id="task-retries"
            type="number"
            min={0}
            max={3}
            value={draft.runtime.retries ?? 0}
            onChange={(event) =>
              setDraft({
                ...draft,
                runtime: { ...draft.runtime, retries: Number(event.target.value) },
              })
            }
          />
        </div>
        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.runtime.trace ?? false}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  runtime: { ...draft.runtime, trace: event.target.checked },
                })
              }
            />
            保存 Playwright trace
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
                onChange={(event) =>
                  changeAction(index, event.target.value as AutomationAction)
                }
                aria-label={`步骤 ${index + 1} 动作`}
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {step.action === "aiQuery" ? (
                <textarea
                  className="step-action-value script-textarea"
                  rows={3}
                  value={step.schemaText ?? ""}
                  placeholder='{"title": "页面标题"}'
                  onChange={(event) => updateSchema(index, event.target.value)}
                  aria-label={`步骤 ${index + 1} 提取 Schema`}
                />
              ) : (
                <>
                  <input
                    className="step-action-value"
                    value={step.target ?? ""}
                    placeholder={
                      draft.runner === "midscene"
                        ? step.action === "goto" || step.action === "wait"
                          ? "可不填"
                          : "语义目标，如 登录按钮"
                        : step.action === "goto"
                          ? "可不填"
                          : "Playwright 定位器"
                    }
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
                          : step.action.startsWith("ai")
                            ? "自然语言指令或断言"
                            : "输入值或期望文本"
                    }
                    onChange={(event) => updateStep(index, "value", event.target.value)}
                    aria-label={`步骤 ${index + 1} 值`}
                  />
                </>
              )}
              <input
                type="number"
                min={100}
                step={100}
                value={step.timeout ?? ""}
                placeholder="超时"
                onChange={(event) => updateTimeout(index, event.target.value)}
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
                steps: [
                  ...current.steps,
                  { action: "click", key: stepKey(), schemaText: undefined },
                ],
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
