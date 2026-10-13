/** 仪表盘浏览器回归：只读取当前数据，验证同一用例仅展示最新记录及图表、指标的一致性。 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1244, height: 801 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const [taskResponse, executionResponse] = await Promise.all([
    fetch(`${origin}/api/tasks`),
    fetch(`${origin}/api/executions`),
  ]);
  assert.ok(taskResponse.ok && executionResponse.ok, "读取验证数据失败");
  const { tasks } = await taskResponse.json();
  const { executions } = await executionResponse.json();
  // 以公开 API 的历史数据为输入，独立逐用例寻找最新记录；不读取页面内部状态。
  const latest = tasks
    .flatMap((task) => {
      const history = executions
        .filter(
          (execution) =>
            execution.kind !== "workflow" && execution.taskId === task.id,
        )
        .sort((first, second) => second.queuedAt.localeCompare(first.queuedAt));
      return history.length ? [history[0]] : [];
    })
    .sort((first, second) => second.queuedAt.localeCompare(first.queuedAt));
  const table = page.getByRole("table");
  assert.equal(
    await table.locator("tbody tr").count(),
    Math.min(12, latest.length),
    "每个用例只展示最新一次执行",
  );
  const details = await table
    .getByRole("link", { name: "详情" })
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.deepEqual(
    details,
    latest.slice(0, 12).map((execution) => `/executions?focus=${execution.id}`),
  );
  const chart = page.getByRole("img", { name: "用例最新执行状态分布" });
  await chart.waitFor();
  const legend = page.getByRole("list", { name: "用例状态统计" });
  const expected = [
    [
      "通过",
      latest.filter((execution) => execution.status === "succeeded").length,
    ],
    [
      "失败",
      latest.filter((execution) => execution.status === "failed").length,
    ],
    [
      "已中断",
      latest.filter((execution) => execution.status === "interrupted").length,
    ],
    [
      "执行中",
      latest.filter((execution) => execution.status === "running").length,
    ],
    [
      "排队中",
      latest.filter((execution) => execution.status === "queued").length,
    ],
    ["未执行", tasks.length - latest.length],
  ];
  for (const [label, count] of expected) {
    assert.equal(
      await legend
        .getByRole("listitem")
        .filter({ hasText: label })
        .locator("strong")
        .textContent(),
      String(count),
    );
  }
  const decided = latest.filter((execution) =>
    ["succeeded", "failed", "interrupted"].includes(execution.status),
  );
  const passRate = decided.length
    ? Math.round((expected[0][1] / decided.length) * 1000) / 10
    : 0;
  const metrics = page.locator(".metric");
  assert.equal(
    await metrics
      .filter({ hasText: "任务总数" })
      .locator("strong")
      .textContent(),
    String(tasks.length),
  );
  assert.equal(
    await metrics.filter({ hasText: "通过率" }).locator("strong").textContent(),
    `${passRate}%`,
  );
  assert.equal(
    (
      await metrics
        .filter({ hasText: "失败 / 已中断" })
        .locator("strong")
        .textContent()
    ).replace(/\s+/g, ""),
    `${expected[1][1]}/${expected[2][1]}`,
  );
  for (const width of [1244, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 801 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${width}px 页面不应横向溢出`,
    );
    assert.equal(await chart.isVisible(), true);
  }
  assert.deepEqual(errors, []);
  console.log("仪表盘去重、最新详情、状态饼图、指标一致性与响应式检查通过");
} finally {
  await browser.close();
}
