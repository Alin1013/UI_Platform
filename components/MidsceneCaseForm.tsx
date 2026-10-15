/**
 * Midscene 智能用例表单：从已有测试用例读取步骤，生成可审阅的语义操作和业务断言。
 * 预览阶段不写数据库；只有用户确认后才创建新用例并进入现有执行队列。
 */

"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, Play } from "lucide-react";
import type { AutomationTask } from "@/lib/types";
import type { TaskDraft } from "@/lib/validation";
import { generateMidsceneFromCase, loadTasks, saveMidsceneCase } from "@/lib/client";
import { useRouter } from "next/navigation";

export function MidsceneCaseForm() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // 表单打开时读取最新任务列表，避免用户在另一个入口新建用例后仍使用旧快照。
    loadTasks()
      .then(({ tasks: loaded }) => {
        setTasks(loaded);
        setTaskId((current) => current || loaded[0]?.id || "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "加载测试用例失败"));
  }, []);

  async function generate() {
    if (!taskId) return;
    setBusy(true);
    setError("");
    try {
      const result = await generateMidsceneFromCase({ taskId });
      setDraft(result.draft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Midscene 生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveAndRun() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveMidsceneCase({ taskId, draft });
      router.push(`/executions?focus=${result.execution.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存并执行失败");
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Midscene 智能编排</h2>
        <span className="muted">读取已有用例 · 自动补断言</span>
      </div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="field wide">
            <label htmlFor="midscene-source-case">选择已有测试用例</label>
            <select
              id="midscene-source-case"
              value={taskId}
              onChange={(event) => {
                setTaskId(event.target.value);
                setDraft(null);
              }}
              disabled={!tasks.length || busy || saving}
            >
              {!tasks.length ? <option value="">暂无已保存用例</option> : null}
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name} · {task.steps.length} 步 · {task.runner === "midscene" ? "Midscene" : "Playwright"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted" style={{ margin: "10px 0" }}>
          Midscene 会读取这条用例的目标、步骤和断言意图，生成语义执行步骤；结果会先展示，确认后才运行。
        </p>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <div className="toolbar" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="button primary" onClick={() => void generate()} disabled={!taskId || busy || saving}>
            <BrainCircuit size={16} aria-hidden />
            {busy ? "读取并生成中" : "读取用例并生成"}
          </button>
        </div>
        {draft ? (
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <h3 className="panel-title">{draft.name}</h3>
              <span className="muted">{draft.steps.length} 个步骤</span>
            </div>
            <div className="panel-body">
              <ol className="steps-editor" aria-label="Midscene 生成步骤预览">
                {draft.steps.map((step, index) => (
                  <li key={`${step.action}-${index}`} className="step-row">
                    <span className="step-index">{index + 1}</span>
                    <strong>{step.action}</strong>
                    <span className="muted">
                      {[step.target, step.value, step.schema ? JSON.stringify(step.schema) : ""].filter(Boolean).join(" · ") || "-"}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="button primary" onClick={() => void saveAndRun()} disabled={saving}>
                <Play size={16} aria-hidden />
                {saving ? "保存并执行中" : "确认保存并执行"}
              </button>
              <button type="button" className="button" onClick={() => setDraft(null)} disabled={saving}>
                放弃预览
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
