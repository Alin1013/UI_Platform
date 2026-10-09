/**
 * 自然语言测试用例表单。
 * 负责收集脚本并调用后端解析；解析结果保存为普通任务，方便执行后继续手工调整。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WandSparkles } from "lucide-react";
import { createTaskFromScript } from "@/lib/client";

const defaultScript = [
  "打开 /demo/login.html",
  "在 input[name=email] 输入 demo@example.com",
  "在 input[name=password] 输入 demo-password",
  "点击 button[type=submit]",
  "断言页面包含 “登录成功”",
].join("\n");

export function ScriptTaskForm() {
  const router = useRouter();
  const [name, setName] = useState("自然语言登录用例");
  const [script, setScript] = useState(defaultScript);
  const [headless, setHeadless] = useState(true);
  const [runner, setRunner] = useState<"playwright" | "midscene">("playwright");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await createTaskFromScript({
        name,
        script,
        headless,
        runner,
        runtime: { browser: "chromium", retries: 0, trace: false },
      });
      router.push(`/executions?focus=${result.execution.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成并执行失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h2 className="panel-title">自然语言测试用例</h2>
        <span className="muted">Web / Chromium</span>
      </div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="script-name">用例名称</label>
            <input
              id="script-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="field full-width">
            <label htmlFor="automation-script">自然语言步骤</label>
            <textarea
              id="automation-script"
              className="script-textarea"
              rows={7}
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder={"打开 /demo/login.html\n在 input[name=email] 输入 demo@example.com\n点击 button[type=submit]\n断言页面包含 “登录成功”"}
              required
            />
          </div>
          <div className="field full-width">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={headless}
                onChange={(event) => setHeadless(event.target.checked)}
              />
              无头模式执行
            </label>
          </div>
          <div className="field">
            <label htmlFor="script-runner">执行引擎</label>
            <select
              id="script-runner"
              value={runner}
              onChange={(event) =>
                setRunner(event.target.value as "playwright" | "midscene")
              }
            >
              <option value="playwright">Playwright（确定性）</option>
              <option value="midscene">Midscene（AI）</option>
            </select>
          </div>
        </div>
        <p className="error-text">{error}</p>
        <div className="toolbar" style={{ justifyContent: "flex-start" }}>
          <button className="button primary" disabled={busy}>
            <WandSparkles size={16} aria-hidden />
            {busy ? "生成并执行中" : "生成并执行"}
          </button>
        </div>
      </div>
    </form>
  );
}
