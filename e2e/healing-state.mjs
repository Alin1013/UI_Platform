/** 修复建议状态回归：拦截生成请求，验证等待、失败和成功反馈，不重放真实用例或修改任务。 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.argv[2] ?? "http://localhost:3000";
const execution = {
  id: "healing-state-fixture", taskId: "healing-task-fixture", kind: "task",
  runner: "playwright", browser: "chromium", status: "failed", totalSteps: 1,
  logs: [{ index: 1, action: "fill", status: "failed", selector: "label=用户名称", message: "定位器未找到" }],
  healing: [],
};
const candidate = {
  id: "healing-fixture", executionId: execution.id, taskId: execution.taskId,
  stepIndex: 1, action: "fill", originalTarget: "label=用户名称",
  healedTarget: "input[placeholder=请输入用户名]", reason: "根据用户名输入框修正定位器",
  confidence: 0.9, status: "proposed", createdAt: "2026-10-13T00:00:00.000Z",
};
const otherExecution = { ...execution, id: "healing-other-fixture", taskId: "healing-other-task" };
const browser = await chromium.launch();
let release;
try {
  const page = await browser.newPage({ viewport: { width: 1244, height: 801 } });
  let responseStatus = 400;
  let pending;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let payload;
    if (request.method() === "POST" && pathname.endsWith("/heal")) {
      await pending;
      if (responseStatus === 201) execution.healing = [candidate];
      await route.fulfill({ status: responseStatus, json: responseStatus === 201 ? { healing: candidate } : { error: "模型服务暂时不可用" } });
      return;
    }
    assert.equal(request.method(), "GET", "禁止向真实服务发送写入请求");
    if (pathname === "/api/tasks") payload = { tasks: [
      { id: execution.taskId, name: "修复状态测试", runner: "playwright" },
      { id: otherExecution.taskId, name: "其他执行", runner: "playwright" },
    ] };
    else if (pathname === "/api/executions") payload = { executions: [execution, otherExecution] };
    else payload = { execution: pathname.endsWith(otherExecution.id) ? otherExecution : execution };
    await route.fulfill({ json: payload });
  });
  await page.goto(`${origin}/executions?focus=${execution.id}`);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "失败修复建议", exact: true }) });
  await panel.getByText("尚未生成修复建议", { exact: true }).waitFor();
  pending = new Promise((resolve) => { release = resolve; });
  await panel.getByRole("button", { name: "生成修复建议", exact: true }).click();
  await panel.getByRole("button", { name: "生成中", exact: true }).waitFor();
  assert.equal(await panel.getByText("尚未生成修复建议", { exact: true }).count(), 0, "生成期间不应显示尚未生成的空状态");
  assert.ok(await panel.getByRole("status").count(), "生成期间应有明确的等待反馈");
  // 可选留存状态截图用于视觉复核，普通回归运行不产生额外文件。
  if (process.env.HEALING_SCREENSHOT_DIR) {
    await panel.screenshot({ path: `${process.env.HEALING_SCREENSHOT_DIR}/healing-pending.png` });
  }
  release();
  await panel.getByRole("alert").filter({ hasText: "模型服务暂时不可用" }).waitFor();
  assert.equal(await panel.getByText("尚未生成修复建议", { exact: true }).count(), 0, "请求失败应显示错误而非空状态");
  if (process.env.HEALING_SCREENSHOT_DIR) {
    await panel.screenshot({ path: `${process.env.HEALING_SCREENSHOT_DIR}/healing-error.png` });
  }
  responseStatus = 201;
  pending = new Promise((resolve) => { release = resolve; });
  await panel.getByRole("button", { name: "生成修复建议", exact: true }).click();
  release();
  await panel.getByText(candidate.reason, { exact: true }).waitFor();
  assert.equal(await panel.getByRole("status").count(), 0, "生成成功后应清除等待状态");
  assert.equal(await panel.getByRole("alert").count(), 0, "重新生成成功后应清除上次错误");
  await panel.getByRole("button", { name: "应用修复", exact: true }).waitFor();
  if (process.env.HEALING_SCREENSHOT_DIR) {
    await panel.screenshot({ path: `${process.env.HEALING_SCREENSHOT_DIR}/healing-success.png` });
  }
  // 旧请求稍后返回错误时，新执行不能继承旧执行的忙碌状态或错误提示。
  responseStatus = 400;
  pending = new Promise((resolve) => { release = resolve; });
  await panel.getByRole("button", { name: "生成修复建议", exact: true }).click();
  await panel.getByRole("status").waitFor();
  await page.getByRole("button", { name: /其他执行/ }).click();
  await panel.getByText("尚未生成修复建议", { exact: true }).waitFor();
  const response = page.waitForResponse((item) => item.url().endsWith("/heal"));
  release();
  await (await response).finished();
  // 等待响应处理后的绘制，确保检查覆盖迟到结果触发的 React 状态更新。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await panel.getByRole("button", { name: "生成修复建议", exact: true }).waitFor();
  assert.equal(await panel.getByRole("status").count(), 0, "新记录不能继承旧记录的生成状态");
  assert.equal(await panel.getByRole("alert").count(), 0, "旧记录失败不能污染新记录");
  console.log("修复建议等待、失败、重试成功及切换记录状态检查通过");
} finally {
  release?.();
  await browser.close();
}
