/**
 * AI 用例生成表单。
 * 先展示模型草稿，用户点击保存后仍走统一任务校验，避免生成结果直接进入执行队列。
 */

"use client";

import { useState } from "react";
import { Save, Sparkles } from "lucide-react";
import type { AutomationTask } from "@/lib/types";
import type { TaskDraft } from "@/lib/validation";
import { createTask, generateTaskDraft } from "@/lib/client";

export function AiTaskForm({ onSaved }: { onSaved: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [targetUrl, setTargetUrl] = useState("/demo/login.html");
  const [runner, setRunner] = useState<AutomationTask["runner"]>("playwright");
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await generateTaskDraft({
        name: name || undefined,
        requirement,
        targetUrl,
        runner,
        save: false,
      });
      setDraft(payload.draft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await createTask(draft);
      setDraft(null);
      setRequirement("");
      setName("");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h2 className="panel-title">AI 用例生成</h2>
        <span className="muted">{runner === "midscene" ? "Midscene" : "Playwright"}</span>
      </div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ai-name">用例名称</label>
            <input
              id="ai-name"
              value={name}
              placeholder="可由模型生成"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ai-url">目标 URL</label>
            <input
              id="ai-url"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ai-runner">执行引擎</label>
            <select
              id="ai-runner"
              value={runner}
              onChange={(event) =>
                setRunner(event.target.value as AutomationTask["runner"])
              }
            >
              <option value="playwright">Playwright（确定性）</option>
              <option value="midscene">Midscene（AI）</option>
            </select>
          </div>
          <div className="field wide">
            <label htmlFor="ai-requirement">业务需求</label>
            <textarea
              id="ai-requirement"
              className="script-textarea"
              rows={5}
              value={requirement}
              placeholder="打开登录页，输入测试账号和密码，点击登录，断言进入工作台。"
              onChange={(event) => setRequirement(event.target.value)}
              required
            />
          </div>
        </div>

        <p className="error-text">{error}</p>

        {draft ? (
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header">
              <h3 className="panel-title">{draft.name}</h3>
              <span className="muted">{draft.steps.length} 个步骤</span>
            </div>
            <div className="panel-body">
              <ul className="log-list">
                {draft.steps.map((step, index) => (
                  <li className="log-item passed" key={`${step.action}-${index}`}>
                    <strong>{index + 1}</strong>
                    <span>{step.action}</span>
                    <span className="muted">
                      {[step.target, step.value].filter(Boolean).join(" · ") || "-"}
                    </span>
                    <span />
                  </li>
                ))}
              </ul>
              <div className="toolbar" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                >
                  <Save size={16} aria-hidden />
                  {saving ? "保存中" : "保存用例"}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => setDraft(null)}
                  disabled={saving}
                >
                  放弃草稿
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="toolbar" style={{ justifyContent: "flex-start" }}>
          <button className="button primary" disabled={busy}>
            <Sparkles size={16} aria-hidden />
            {busy ? "生成中" : "生成预览"}
          </button>
        </div>
      </div>
    </form>
  );
}
