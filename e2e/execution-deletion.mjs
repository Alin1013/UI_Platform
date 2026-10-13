/** 执行删除端到端回归：通过真实 API 创建独立用例，验证 UI 删除、事务保护和流程级联；仅清理本次创建的数据。 */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.argv[2] ?? "http://localhost:3000";
const taskIds = [];
const executionIds = new Set();
let workflowId;
const browser = await chromium.launch();

/** 所有验证均走公开 API；状态码不符时附带响应，方便区分功能失败和服务启动失败。 */
async function api(path, method = "GET", body, expected = 200) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error(`${method} ${path}: HTTP ${response.status}, 非 JSON 响应 ${raw.slice(0, 200)}`); }
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

/** 有界轮询真实执行；不依赖内部数据库结构或调度器私有状态。 */
async function finished(id) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const payload = await api(`/executions/${id}`);
    if (!["queued", "running"].includes(payload.execution.status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`执行未在 30 秒内完成：${id}`);
}

/** 创建仅等待本地空白页面的用例，不访问业务站点或模型服务。 */
async function createTask(name) {
  const { task } = await api("/tasks", "POST", {
    name: `删除回归 ${Date.now()} ${name}`,
    headless: true,
    runtime: { trace: false },
    steps: [{ action: "wait", value: "3000" }],
  }, 201);
  taskIds.push(task.id);
  return task;
}

/** 跟踪创建的执行，保证失败清理也不会碰到用户已有数据。 */
async function runTask(task) {
  const { execution } = await api(`/tasks/${task.id}/run`, "POST", undefined, 202);
  executionIds.add(execution.id);
  return execution;
}

try {
  const firstTask = await createTask("单条");
  const first = await runTask(firstTask);
  await api(`/executions/${first.id}`, "DELETE", undefined, 409);
  const firstResult = await finished(first.id);
  assert.equal(firstResult.execution.status, "succeeded");

  const secondTask = await createTask("批量");
  const second = await runTask(secondTask);
  // 活动记录混入批量时，已结束记录也不能被部分删除。
  await api("/executions", "DELETE", { ids: [first.id, second.id] }, 409);
  await api(`/executions/${first.id}`);
  await finished(second.id);
  for (const body of [null, {}, { ids: [] }, { ids: [null] }, { ids: [" "] }]) {
    await api("/executions", "DELETE", body, 400);
  }
  await api("/executions", "DELETE", { ids: [first.id, "missing-deletion-fixture"] }, 404);
  await api(`/executions/${first.id}`);

  const page = await browser.newPage({ viewport: { width: 1244, height: 801 } });
  await page.goto(`${origin}/executions?focus=${first.id}`);
  const row = (id) => page.getByRole("group", { name: `执行记录 ${id}`, exact: true });
  await row(first.id).waitFor();
  // 取消确认不会发起删除，记录继续可读。
  page.once("dialog", (dialog) => dialog.dismiss());
  await row(first.id).getByRole("button", { name: `删除执行记录 ${first.id}`, exact: true }).click();
  await api(`/executions/${first.id}`);
  page.once("dialog", (dialog) => dialog.accept());
  await row(first.id).getByRole("button", { name: `删除执行记录 ${first.id}`, exact: true }).click();
  await row(first.id).waitFor({ state: "detached" });
  await page.getByRole("status").filter({ hasText: "已删除 1 条执行记录" }).waitFor();
  await api(`/executions/${first.id}`, "GET", undefined, 404);
  assert.equal(await page.getByText("执行记录不存在", { exact: true }).count(), 0);

  const third = await runTask(firstTask);
  await finished(third.id);
  await page.reload();
  await row(third.id).waitFor();
  await row(second.id).getByRole("checkbox").check();
  await row(third.id).getByRole("checkbox").check();
  const selectableCount = await page.getByRole("group", { name: /^执行记录 / }).getByRole("checkbox").filter({ visible: true }).evaluateAll((inputs) => inputs.filter((input) => !input.disabled).length);
  assert.equal(await page.getByRole("checkbox", { name: "全选可删除的执行记录", exact: true }).evaluate((input) => input.indeterminate), selectableCount > 2);
  for (const width of [390, 1244]) {
    await page.setViewportSize({ width, height: 801 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px 页面不应横向溢出`);
  }
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "批量删除 (2)", exact: true }).click();
  await row(second.id).waitFor({ state: "detached" });
  await row(third.id).waitFor({ state: "detached" });
  for (const id of [second.id, third.id]) await api(`/executions/${id}`, "GET", undefined, 404);

  const { workflow } = await api("/workflows", "POST", {
    name: `删除回归组合 ${Date.now()}`, taskIds,
  }, 201);
  workflowId = workflow.id;
  const { execution: parent } = await api(`/workflows/${workflow.id}/run`, "POST", undefined, 202);
  executionIds.add(parent.id);
  await api(`/executions/${parent.id}`, "DELETE", undefined, 409);
  const parentResult = await finished(parent.id);
  assert.equal(parentResult.execution.status, "succeeded");
  assert.equal(parentResult.children.length, 2);
  parentResult.children.forEach((child) => executionIds.add(child.id));
  // 父详情已打开时删除子记录，详情必须重新读取，不能留下进入 404 的旧操作。
  await page.goto(`${origin}/executions?focus=${parent.id}`);
  const firstChild = parentResult.children.find((child) => child.taskId === firstTask.id);
  const childCell = page.getByRole("cell", { name: firstTask.name, exact: true });
  await childCell.waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await row(firstChild.id).getByRole("button", { name: `删除执行记录 ${firstChild.id}`, exact: true }).click();
  await childCell.waitFor({ state: "detached" });
  await page.getByRole("cell", { name: secondTask.name, exact: true }).waitFor();
  assert.equal(await childCell.count(), 0, "父报告加载完成后不能重新出现已删除的子记录");
  await api(`/executions/${firstChild.id}`, "GET", undefined, 404);
  const remainingChildren = parentResult.children.filter((child) => child.id !== firstChild.id);
  // 父子同时被选中和重复 ID 都应只删除一次，并返回完整级联范围。
  const result = await api("/executions", "DELETE", {
    ids: [parent.id, parent.id, remainingChildren[0].id],
  });
  assert.deepEqual(new Set(result.deletedIds), new Set([parent.id, ...remainingChildren.map((child) => child.id)]));
  for (const id of result.deletedIds) await api(`/executions/${id}`, "GET", undefined, 404);
  console.log("执行删除：单条确认/取消、批量事务、输入校验、活动保护、组合级联和窄屏布局通过");
} finally {
  await browser.close();
  // 尽力清理本次夹具；先等待执行结束，再删记录与用例，不覆盖其他任务。
  if (workflowId) await api(`/workflows/${workflowId}`, "DELETE");
  for (const id of executionIds) {
    const response = await fetch(`${origin}/api/executions/${id}`);
    if (response.status === 404) continue;
    const payload = await finished(id);
    payload.children?.forEach((child) => executionIds.add(child.id));
    await api(`/executions/${id}`, "DELETE");
  }
  for (const id of taskIds) await api(`/tasks/${id}`, "DELETE");
  for (const id of executionIds) await rm(new URL(`../reports/${id}/`, import.meta.url), { recursive: true, force: true });
}
