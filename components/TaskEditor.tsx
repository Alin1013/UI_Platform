/**
 * 任务编辑器。
 * 自然语言生成的步骤先落到这里，供人工校对后再保存和执行。
 */

import { useEffect, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import type {
  AutomationAction,
  AutomationStep,
  AutomationTask,
  MidsceneAiContexts,
  TestEnvironment,
} from "@/lib/types";
import { createTask, loadEnvironments, updateTask } from "@/lib/client";

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
  { value: "hover", label: "悬停（Midscene）" },
  { value: "scroll", label: "滚动（Midscene）" },
  { value: "doubleClick", label: "双击（Midscene）" },
  { value: "rightClick", label: "右键（Midscene）" },
  { value: "clearInput", label: "清空输入（Midscene）" },
  { value: "aiAct", label: "AI 操作" },
  { value: "aiAssert", label: "AI 断言" },
  { value: "aiQuery", label: "AI 提取" },
  { value: "aiWaitFor", label: "AI 等待" },
  { value: "aiBoolean", label: "AI 是否判断" },
  { value: "aiNumber", label: "AI 数值提取" },
  { value: "aiString", label: "AI 文本提取" },
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

const cacheOptions = [
  { value: "read-write", label: "读写缓存（推荐）" },
  { value: "read-only", label: "只读缓存" },
  { value: "write-only", label: "只写缓存" },
  { value: "off", label: "关闭缓存" },
] as const;

const scrollDirectionOptions = [
  { value: "down", label: "向下滚动" },
  { value: "up", label: "向上滚动" },
  { value: "left", label: "向左滚动" },
  { value: "right", label: "向右滚动" },
  { value: "toBottom", label: "滚动到底部" },
  { value: "toTop", label: "滚动到顶部" },
  { value: "toLeft", label: "滚动到左边界" },
  { value: "toRight", label: "滚动到右边界" },
] as const;

const midsceneOnlyActions = new Set([
  "aiAct",
  "aiAssert",
  "aiQuery",
  "aiWaitFor",
  "hover",
  "scroll",
  "doubleClick",
  "rightClick",
  "clearInput",
  "aiBoolean",
  "aiNumber",
  "aiString",
]);

/** 目标输入的语义按 Runner 变化；帮助文案放函数里，避免 JSX 三元表达式继续加深。 */
function targetPlaceholder(
  runner: AutomationTask["runner"],
  action: AutomationAction,
): string {
  if (runner !== "midscene") return action === "goto" ? "可不填" : "Playwright 定位器";
  if (action === "goto" || action === "wait") return "可不填";
  return action === "press" ? "可选语义目标" : "语义目标，如 登录按钮";
}

function stepKey(): string {
  return `${Date.now()}-${Math.random()}`;
}

function draftFromTask(task?: AutomationTask | null) {
  return {
    name: task?.name ?? "",
    description: task?.description ?? "",
    labels: task?.labels.join(", ") ?? "",
    environmentId: task?.environmentId ?? "",
    headless: task?.headless ?? true,
    runner: task?.runner ?? "playwright",
    runtime: {
      ...task?.runtime,
      // 老任务没有 cache 字段时在表单里显式呈现平台默认策略。
      cache: task?.runtime?.cache ?? { enabled: true, strategy: "read-write" },
    },
    aiContexts: task?.aiContexts ?? {},
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
  const [environments, setEnvironments] = useState<TestEnvironment[]>([]);

  // 环境列表只在编辑器打开时加载一次；环境管理页负责增删改。
  useEffect(() => {
    loadEnvironments()
      .then((payload) => setEnvironments(payload.environments))
      .catch(() => setEnvironments([]));
  }, []);

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

  function updateDirection(index: number, value: string) {
    setDraft((current) => {
      const steps = [...current.steps];
      steps[index] = {
        ...steps[index],
        direction: value as typeof steps[number]["direction"],
      };
      return { ...current, steps };
    });
  }

  function updateContext(index: number, value: string) {
    setDraft((current) => {
      const steps = [...current.steps];
      steps[index] = { ...steps[index], context: value };
      return { ...current, steps };
    });
  }

  /** 只提交非空上下文；空专用键继续由 aiContexts.default 或 Midscene 缺省兜底。 */
  function updateAiContext(key: keyof MidsceneAiContexts, value: string) {
    setDraft((current) => ({
      ...current,
      aiContexts: { ...current.aiContexts, [key]: value },
    }));
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
          cache: draft.runner === "midscene" ? draft.runtime.cache : undefined,
        },
        description: draft.description || undefined,
        labels: draft.labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        environmentId: draft.environmentId || undefined,
        aiContexts:
          draft.runner === "midscene"
            ? Object.fromEntries(
                Object.entries(draft.aiContexts ?? {}).filter(([, value]) =>
                  value?.trim(),
                ),
              )
            : undefined,
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
          <label htmlFor="task-environment">测试环境</label>
          <select
            id="task-environment"
            value={draft.environmentId}
            onChange={(event) =>
              setDraft({ ...draft, environmentId: event.target.value })
            }
          >
            <option value="">全局默认</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name} · {env.baseUrl}
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
        {draft.runner === "midscene" ? (
          <div className="field">
            <label htmlFor="task-cache">Midscene 缓存</label>
            <select
              id="task-cache"
              value={
                draft.runtime.cache?.enabled === false
                  ? "off"
                  : draft.runtime.cache?.strategy ?? "read-write"
              }
              onChange={(event) => {
                const value = event.target.value;
                setDraft({
                  ...draft,
                  runtime: {
                    ...draft.runtime,
                    cache: {
                      ...draft.runtime.cache,
                      enabled: value !== "off",
                      strategy:
                        value === "off"
                          ? draft.runtime.cache?.strategy
                          : (value as typeof draft.runtime.cache.strategy),
                    },
                  },
                });
              }}
            >
              {cacheOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
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

      {draft.runner === "midscene" ? (
        <>
          <div className="field full-width" style={{ marginTop: 18 }}>
            <label>Midscene 业务知识</label>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ai-context-default">通用上下文</label>
              <textarea
                id="ai-context-default"
                value={draft.aiContexts?.default ?? ""}
                placeholder="商品价格为美元；页面使用中文"
                onChange={(event) => updateAiContext("default", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ai-context-act">AI 操作上下文</label>
              <textarea
                id="ai-context-act"
                value={draft.aiContexts?.aiAct ?? ""}
                placeholder="如出现 Cookie 弹窗先点击同意"
                onChange={(event) => updateAiContext("aiAct", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ai-context-query">AI 提取上下文</label>
              <textarea
                id="ai-context-query"
                value={draft.aiContexts?.aiQuery ?? ""}
                placeholder="金额返回数字，不带货币符号"
                onChange={(event) => updateAiContext("aiQuery", event.target.value)}
              />
            </div>
          </div>
        </>
      ) : null}

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
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={
                      draft.runner === "playwright" && midsceneOnlyActions.has(option.value)
                    }
                  >
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
                      targetPlaceholder(draft.runner, step.action)
                    }
                    onChange={(event) => updateStep(index, "target", event.target.value)}
                    aria-label={`步骤 ${index + 1} 目标`}
                  />
                  {step.action === "scroll" ? (
                    <select
                      className="step-action-value"
                      value={step.direction ?? "down"}
                      onChange={(event) => updateDirection(index, event.target.value)}
                      aria-label={`步骤 ${index + 1} 滚动方向`}
                    >
                      {scrollDirectionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="step-action-value"
                      value={step.value ?? ""}
                      placeholder={
                        step.action === "goto"
                          ? "/demo/login.html 或完整 URL"
                          : step.action === "wait"
                            ? "毫秒"
                            : step.action.startsWith("ai")
                              ? "自然语言指令、断言或提取问题"
                              : "输入值或期望文本"
                      }
                      onChange={(event) => updateStep(index, "value", event.target.value)}
                      aria-label={`步骤 ${index + 1} 值`}
                    />
                  )}
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
              {draft.runner === "midscene" &&
              step.action !== "goto" &&
              step.action !== "wait" ? (
                <input
                  className="step-action-value"
                  style={{ gridColumn: "1 / -1" }}
                  value={step.context ?? ""}
                  placeholder="可选单步 AI 上下文，优先级高于任务级业务知识"
                  onChange={(event) => updateContext(index, event.target.value)}
                  aria-label={`步骤 ${index + 1} AI 上下文`}
                />
              ) : null}
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
