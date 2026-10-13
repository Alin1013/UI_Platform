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
import styles from "./AiTaskForm.module.css";

/** 将生成入口、草稿预览和确认操作按流程排列；onSaved 在保存成功后刷新用例列表。 */
export function AiTaskForm({ onSaved }: { onSaved: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [requirement, setRequirement] = useState("");
  // 示例地址仅作占位提示，实际 URL 由用户输入，避免默认提交演示页。
  const [targetUrl, setTargetUrl] = useState("");
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
              placeholder="/demo/login.html"
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

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        {/* 生成入口紧跟输入区，草稿的确认按钮只放在预览底部，避免两组主操作混在一起。 */}
        <div className={styles.generateActions}>
          <button className="button primary" disabled={busy}>
            <Sparkles size={16} aria-hidden />
            {busy ? "生成中" : "生成预览"}
          </button>
        </div>

        {draft ? (
          <div className={`panel ${styles.draft}`}>
            <div className={`panel-header ${styles.draftHeader}`}>
              <h3 className={`panel-title ${styles.draftTitle}`}>{draft.name}</h3>
              <span className={`muted ${styles.stepCount}`}>{draft.steps.length} 个步骤</span>
            </div>
            <div className="panel-body">
              {/* 草稿没有日志状态和时长列，使用独立三列布局给长目标保留换行空间。 */}
              <ol className={styles.steps} aria-label="草稿步骤">
                {draft.steps.map((step, index) => (
                  <li className={styles.step} key={`${step.action}-${index}`}>
                    <strong>{index + 1}</strong>
                    <span className={styles.stepAction}>{step.action}</span>
                    <span className={`muted ${styles.stepDetail}`}>
                      {[step.target, step.value].filter(Boolean).join(" · ") || "-"}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className={styles.draftActions}>
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
        ) : null}
      </div>
    </form>
  );
}
