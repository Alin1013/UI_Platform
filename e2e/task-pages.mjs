/** 任务页面回归：通过浏览器导航验证层级隔离，HTTP 拦截保护真实用例数据。 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.argv[2] ?? "http://localhost:3001";
const date = "2026-10-13T00:00:00.000Z";
let tasks = [
  {
    id: "task-fixture",
    name: "登录流程",
    target: "web",
    runner: "playwright",
    labels: ["冒烟"],
    headless: true,
    steps: [{ action: "goto", value: "/demo/login.html" }],
    createdAt: date,
    updatedAt: date,
  },
];
let workflows = [
  {
    id: "workflow-fixture",
    name: "登录组合",
    taskIds: [tasks[0].id],
    createdAt: date,
    updatedAt: date,
  },
];
const execution = {
  id: "execution-fixture",
  taskId: tasks[0].id,
  status: "failed",
  queuedAt: date,
  totalSteps: 1,
  logs: [],
  healing: [],
};
const parent = {
  ...execution,
  id: "parent-fixture",
  taskId: "",
  kind: "workflow",
  workflowId: workflows[0].id,
  queuedAt: "2026-10-14T00:00:00.000Z",
};
const requests = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1244, height: 801 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    requests.push(`${method} ${path}`);
    let payload;
    // 所有写请求在 HTTP 边界隔离，保留真实 UI 表单和导航行为。
    if (method === "POST" && path === "/api/tasks/generate")
      payload = { draft: { ...tasks[0], name: "AI 登录草稿" } };
    else if (method === "POST" && path === "/api/tasks") {
      const task = {
        ...request.postDataJSON(),
        id: `saved-${tasks.length}`,
        createdAt: date,
        updatedAt: date,
      };
      tasks.push(task);
      payload = { task };
    } else if (method === "PUT" && path === "/api/tasks/task-fixture") {
      tasks[0] = { ...tasks[0], ...request.postDataJSON() };
      payload = { task: tasks[0] };
    } else if (method === "DELETE" && path === "/api/tasks/task-fixture") {
      tasks = tasks.filter((task) => task.id !== "task-fixture");
      payload = { ok: true };
    } else if (method === "POST" && path === "/api/workflows") {
      const requestBody = request.postDataJSON();
      const workflow = {
        ...requestBody,
        id: requestBody.kind === "test-workflow" ? "saved-test-workflow" : "saved-workflow",
        createdAt: date,
        updatedAt: date,
      };
      workflows.push(workflow);
      payload = { workflow };
    } else if (method === "PUT" && path.startsWith("/api/workflows/")) {
      const workflowId = path.split("/").at(-1);
      const index = workflows.findIndex((workflow) => workflow.id === workflowId);
      workflows[index] = { ...workflows[index], ...request.postDataJSON() };
      payload = { workflow: workflows[index] };
    } else if (
      method === "POST" &&
      (path.endsWith("/run") ||
        path.endsWith("/retry") ||
        path === "/api/tasks/from-script")
    )
      payload = {
        task: tasks[0],
        execution: { ...execution, id: "new-execution", status: "queued" },
      };
    else if (method === "GET" && path === "/api/tasks") payload = { tasks };
    else if (method === "GET" && path === "/api/workflows")
      payload = { workflows };
    else if (method === "GET" && path === "/api/executions")
      payload = {
        executions: [execution, parent],
        queue: { running: 0, queued: 0, concurrency: 1 },
      };
    else if (method === "GET" && path === "/api/environments")
      payload = { environments: [] };
    else if (method === "GET" && path === "/api/tasks/task-fixture")
      payload = { task: tasks[0] };
    else if (method === "GET" && path === "/api/tasks/missing") {
      await route.fulfill({ status: 404, json: { error: "任务不存在" } });
      return;
    } else if (method === "GET" && path.startsWith("/api/executions/"))
      payload = {
        execution: { ...execution, id: "new-execution", status: "queued" },
      };
    else throw new Error(`未覆盖的 API 请求：${method} ${path}`);
    await route.fulfill({ json: payload });
  });
  await page.goto(`${origin}/tasks`);
  await page
    .getByRole("heading", { name: "任务管理", exact: true })
    .waitFor({ timeout: 10000 });
  assert.equal(
    await page.locator("form, table").count(),
    0,
    "一级入口不混入新建表单和用例列表",
  );
  await page
    .getByRole("link", { name: "用例列表", exact: true })
    .first()
    .click();
  await page.waitForURL("**/tasks/list");
  assert.equal(await page.locator("form").count(), 0, "列表页不混入新建表单");
  await page
    .getByRole("link", { name: "新建用例", exact: true })
    .first()
    .click();
  await page.waitForURL("**/tasks/new");
  await page.getByLabel("任务名称", { exact: true }).waitFor();
  assert.equal(await page.locator("table").count(), 0, "新建页不混入列表");
  await page.getByLabel("任务名称", { exact: true }).fill("手工创建流程");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.waitForURL("**/tasks/list");
  await page.getByRole("cell", { name: "手工创建流程", exact: true }).waitFor();
  await page.getByLabel("搜索用例").fill("冒烟");
  assert.equal(
    await page.locator("tbody tr").count(),
    1,
    "按标签筛选后只显示匹配项",
  );
  await page.getByLabel("搜索用例").fill("不存在");
  await page
    .getByText("没有匹配的用例，试试其他名称或标签。", { exact: true })
    .waitFor();
  await page.getByLabel("搜索用例").fill("");
  let row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "登录流程", exact: true }) });
  await row.getByRole("link", { name: "编辑", exact: true }).click();
  await page.waitForURL("**/tasks/task-fixture/edit");
  await page.reload();
  await page.getByLabel("任务名称", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("任务名称", { exact: true }).inputValue(),
    "登录流程",
    "直接刷新编辑页仍恢复当前用例",
  );
  await page.getByLabel("任务名称", { exact: true }).fill("登录流程已修改");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.waitForURL("**/tasks/list");
  await page
    .getByRole("cell", { name: "登录流程已修改", exact: true })
    .waitFor();
  await page.goto(`${origin}/tasks/task-fixture/edit`);
  await page.getByLabel("任务名称", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.waitForURL("**/tasks/list");
  await page.goto(`${origin}/tasks/missing/edit`);
  await page.getByRole("alert").filter({ hasText: "任务不存在" }).waitFor();
  assert.equal(
    await page.locator("form").count(),
    0,
    "不存在的任务不能显示新建表单",
  );

  await page.goto(`${origin}/tasks/new`);
  await page.getByRole("button", { name: /AI 生成/ }).click();
  assert.equal(
    await page.getByLabel("任务名称", { exact: true }).count(),
    0,
    "一种创建方式只展示对应表单",
  );
  await page.getByLabel("目标 URL").fill("/demo/login.html");
  await page.getByLabel("业务需求").fill("登录并验证成功");
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await page
    .getByRole("heading", { name: "AI 登录草稿", exact: true })
    .waitFor();
  assert.equal(
    requests.filter((item) => item === "POST /api/tasks").length,
    1,
    "AI 预览不会保存用例",
  );
  await page.getByRole("button", { name: "保存用例", exact: true }).click();
  await page.waitForURL("**/tasks/list");
  await page.getByRole("cell", { name: "AI 登录草稿", exact: true }).waitFor();
  await page.goto(`${origin}/tasks/new`);
  await page.getByRole("button", { name: /规则脚本/ }).click();
  await page.getByLabel("用例名称", { exact: true }).fill("脚本流程");
  await page.getByLabel("自然语言步骤").fill("打开 /demo/login.html");
  await page.getByRole("button", { name: "生成并执行", exact: true }).click();
  await page.waitForURL("**/executions?focus=new-execution");

  await page.goto(`${origin}/tasks/list`);
  row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "登录流程已修改", exact: true }),
  });
  await row.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForURL("**/executions?focus=new-execution");
  assert.ok(
    requests.includes("POST /api/executions/execution-fixture/retry"),
    "用例重试采用自身历史，不使用组合父执行",
  );
  await page.goto(`${origin}/tasks/list`);
  await row.getByRole("button", { name: "运行", exact: true }).click();
  await page.waitForURL("**/executions?focus=new-execution");

  await page.goto(`${origin}/tasks/workflows`);
  await page.getByRole("heading", { name: "组合列表", exact: true }).waitFor();
  await page.getByRole("link", { name: "新建组合", exact: true }).click();
  await page.waitForURL("**/tasks/workflows/new");
  await page.getByLabel("组合名称", { exact: true }).fill("新建业务组合");
  assert.equal(await page.getByRole("button", { name: "开始节点，可拖动用例到流程开头" }).getAttribute("draggable"), "true", "开始节点可拖动");
  assert.equal(await page.getByRole("button", { name: "结束节点，可拖动用例到流程末尾" }).getAttribute("draggable"), "true", "结束节点可拖动");
  await page.getByRole("button", { name: /添加用例 登录流程已修改/ }).click();
  await page.getByRole("button", { name: "保存组合", exact: true }).click();
  await page.waitForURL("**/tasks/workflows");
  await page.getByRole("cell", { name: "新建业务组合", exact: true }).waitFor();
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "新建业务组合", exact: true }) })
    .getByRole("link", { name: "编辑", exact: true })
    .click();
  await page.waitForURL("**/tasks/workflows/saved-workflow/edit");
  await page.getByLabel("组合名称", { exact: true }).fill("新建业务组合已修改");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.waitForURL("**/tasks/workflows");
  await page.getByRole("cell", { name: "新建业务组合已修改", exact: true }).waitFor();
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "登录组合", exact: true }) })
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await page.waitForURL("**/executions?focus=new-execution");
  assert.ok(
    requests.includes("POST /api/executions/parent-fixture/retry"),
    "组合重试采用父执行",
  );

  // 混合编排必须保留节点类型与顺序，编辑页刷新后也要恢复同一条执行链。
  await page.goto(`${origin}/tasks/test-workflows`);
  await page.getByRole("heading", { name: "测试工作流", level: 1 }).waitFor();
  await page.getByRole("link", { name: "新建工作流", exact: true }).first().click();
  await page.waitForURL("**/tasks/test-workflows/new");
  await page.getByLabel("工作流名称", { exact: true }).fill("核心回归工作流");
  await page.getByRole("button", { name: /添加单测试用例 登录流程已修改/ }).click();
  await page.getByRole("button", { name: /添加组合测试流 新建业务组合已修改/ }).click();
  const canvas = page.getByRole("region", { name: "测试工作流画布" });
  assert.equal(await canvas.locator("article").count(), 2, "画布同时接收单用例和组合节点");
  await page.getByRole("button", { name: "上移第 2 个节点" }).click();
  assert.match(await canvas.locator("article").first().innerText(), /新建业务组合已修改/, "节点排序改变执行顺序");
  await page.getByRole("button", { name: "下移第 1 个节点" }).click();
  await page.getByRole("button", { name: "保存工作流", exact: true }).click();
  await page.waitForURL("**/tasks/test-workflows");
  await page.getByRole("cell", { name: "核心回归工作流", exact: true }).waitFor();
  const savedTestWorkflow = workflows.find((workflow) => workflow.id === "saved-test-workflow");
  assert.equal(savedTestWorkflow?.kind, "test-workflow", "保存使用测试工作流类型和节点格式");
  assert.equal(savedTestWorkflow?.nodes?.length, 2, "保存保留全部混合节点");
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "核心回归工作流", exact: true }) }).getByRole("link", { name: "编辑", exact: true }).click();
  await page.waitForURL("**/tasks/test-workflows/saved-test-workflow/edit");
  await page.reload();
  await page.getByLabel("工作流名称", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("工作流名称", { exact: true }).inputValue(), "核心回归工作流", "直接刷新编辑路由恢复工作流信息");
  assert.equal(await page.getByRole("region", { name: "测试工作流画布" }).locator("article").count(), 2, "直接刷新编辑路由恢复节点列表");

  // 覆盖桌面、手机和边界宽度，表格可局部滚动，所有页面不能产生页面级水平溢出。
  for (const width of [1244, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 801 });
    for (const route of [
      "/tasks",
      "/tasks/list",
      "/tasks/new",
      "/tasks/task-fixture/edit",
      "/tasks/workflows",
      "/tasks/workflows/new",
      "/tasks/workflows/workflow-fixture/edit",
      "/tasks/test-workflows",
      "/tasks/test-workflows/new",
      "/tasks/test-workflows/saved-test-workflow/edit",
    ]) {
      await page.goto(`${origin}${route}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (route === "/tasks/new" || route === "/tasks/task-fixture/edit")
        await page.getByLabel("任务名称", { exact: true }).waitFor();
      if (route.endsWith("list"))
        await page
          .getByRole("cell", { name: "登录流程已修改", exact: true })
          .waitFor();
      if (route === "/tasks/workflows")
        await page
          .getByRole("heading", { name: "组合列表", exact: true })
          .waitFor();
      if (route === "/tasks/workflows/new" || route.endsWith("/workflows/workflow-fixture/edit"))
        await page.getByLabel("组合名称", { exact: true }).waitFor();
      if (route === "/tasks/test-workflows/new" || route.endsWith("/test-workflows/saved-test-workflow/edit"))
        await page.getByLabel("工作流名称", { exact: true }).waitFor();
      if (route === "/tasks/test-workflows")
        await page.getByRole("heading", { name: "工作流列表", exact: true }).waitFor();
      const size = await page.evaluate(() => ({
        viewport: window.innerWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.ok(
        size.content <= size.viewport + 1,
        `${route} 在 ${width}px 下溢出：${size.content}`,
      );
      const navHeights = await page
        .getByRole("navigation", { name: "主导航", exact: true })
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => link.getBoundingClientRect().height),
        );
      assert.ok(
        navHeights.every((height) => height < 55),
        "主导航必须按完整链接换行，不能挤成竖排",
      );
      if (process.env.TASK_SCREENSHOT_DIR && [1244, 390].includes(width))
        await page.screenshot({
          path: `${process.env.TASK_SCREENSHOT_DIR}/tasks-${route.split("/").at(-1)}-${width}.png`,
          fullPage: true,
        });
    }
  }
  await page.goto(`${origin}/tasks/list`);
  await page
    .getByRole("cell", { name: "登录流程已修改", exact: true })
    .waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "用例已删除" }).waitFor();
  assert.equal(
    await page
      .getByRole("cell", { name: "登录流程已修改", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, [], "页面没有浏览器运行时异常");
  console.log(
    "任务层级、创建/编辑/取消、AI 确认、脚本执行、列表操作、组合与响应式布局检查通过",
  );
} finally {
  await browser.close();
}
