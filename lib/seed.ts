/** 首次启动内置一个可立即执行的登录示例，验证调度器和 Playwright 全链路。 */

import { listTasks, saveTask } from "./store";
import { parseTaskDraft, taskFromDraft } from "./validation";

export async function ensureSeedTask(): Promise<void> {
  const tasks = await listTasks();
  if (tasks.length > 0) return;

  const draft = parseTaskDraft({
    name: "登录表单示例",
    target: "web",
    runner: "playwright",
    runtime: { browser: "chromium", retries: 0, trace: false },
    description: "使用平台内置演示页验证 Web 执行链路。",
    labels: ["示例", "Web"],
    headless: true,
    steps: [
      { action: "goto", value: "/demo/login.html" },
      { action: "fill", target: "input[name=email]", value: "demo@example.com" },
      { action: "fill", target: "input[name=password]", value: "demo-password" },
      { action: "click", target: "button[type=submit]" },
      { action: "expectText", target: "main", value: "登录成功" },
    ],
  });
  await saveTask(taskFromDraft(draft));
}
