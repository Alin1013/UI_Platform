/**
 * 自然语言测试用例表单。
 * 负责收集脚本并调用后端解析；解析结果保存为普通任务，方便执行后继续手工调整。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WandSparkles } from "lucide-react";
import { createTaskFromScript } from "@/lib/client";
import type { BrowserId } from "@/lib/types";

// 示例步骤只作为引导展示；初始值保持为空，避免用户打开表单时误认为脚本已准备好执行。
const scriptPlaceholder = [
  "打开 /demo/login.html",
  "在 input[name=email] 输入 demo@example.com",
  "在 input[name=password] 输入 demo-password",
  "点击 button[type=submit]",
  "断言页面包含 “登录成功”",
].join("\n");

const browserOptions: Array<{ value: BrowserId; label: string }> = [
  { value: "chromium", label: "Chromium" },
  { value: "firefox", label: "Firefox" },
  { value: "webkit", label: "WebKit" },
];

export function ScriptTaskForm() {
  const router = useRouter();
  // 示例名称只用于引导填写；保持真实值为空，避免用户误提交预置用例名称。
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [headless, setHeadless] = useState(true);
  const [runner, setRunner] = useState<"playwright" | "midscene">("playwright");
  // Chromium 是跨平台默认内核；切换后随任务 runtime 保存并交给执行器启动对应浏览器。
  const [browser, setBrowser] = useState<BrowserId>("chromium");
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
        runtime: { browser, retries: 0, trace: false },
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
              placeholder="自然语言登录用例"
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
              placeholder={scriptPlaceholder}
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
          <div className="field">
            <label htmlFor="script-browser">浏览器引擎</label>
            <select
              id="script-browser"
              value={browser}
              onChange={(event) => setBrowser(event.target.value as BrowserId)}
            >
              {browserOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
