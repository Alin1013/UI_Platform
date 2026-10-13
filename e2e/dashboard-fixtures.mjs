/** 仪表盘边界回归：在独立临时目录启动生产构建，夹具只写临时 SQLite，绝不修改真实运行数据。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium } from "playwright";

const root = process.cwd();
const directory = await mkdtemp(path.join(tmpdir(), "dashboard-fixtures-"));
const port = Number(process.argv[2] ?? 3102);
const origin = `http://127.0.0.1:${port}`;
let server;
let browser;
let database;
let output = "";

/** 等待可用响应而非固定延迟；服务退出或超过时间上限时给出日志。 */
async function ready() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      if ((await fetch(`${origin}/api/tasks`)).ok) return;
    } catch {
      /* 初次连接可能早于监听端口。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`生产服务未启动：${output}`);
}

/** 数据库只承担输入夹具边界，所有结果断言均通过真实页面和公开 API。 */
function fixtures(taskIds, executions) {
  database.transaction(() => {
    database.prepare("DELETE FROM executions").run();
    database.prepare("DELETE FROM tasks").run();
    const saveTask = database.prepare(
      "INSERT INTO tasks (id, name, steps, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)",
    );
    for (const id of taskIds)
      saveTask.run(
        id,
        "同名用例",
        "2026-10-13T00:00:00.000Z",
        "2026-10-13T00:00:00.000Z",
      );
    const saveExecution = database.prepare(
      "INSERT INTO executions (id, task_id, status, queued_at, started_at, duration_ms, total_steps, kind, workflow_id, workflow_execution_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    );
    for (const execution of executions)
      saveExecution.run(
        execution.id,
        execution.taskId,
        execution.status,
        execution.queuedAt,
        execution.startedAt ?? null,
        execution.durationMs ?? null,
        execution.kind ?? null,
        execution.workflowId ?? null,
        execution.workflowExecutionId ?? null,
      );
  })();
}

/** 同一浏览器测试完成后关闭，避免子服务收尾时留下浏览器进程。 */
async function verify(page) {
  await page.goto(origin);
  const child = spawn(
    process.execPath,
    [path.join(root, "e2e/dashboard.mjs"), origin],
    { stdio: "inherit" },
  );
  assert.equal(await new Promise((resolve) => child.once("exit", resolve)), 0);
}

try {
  // 只复用构建与依赖；cwd 决定数据库路径，临时服务无法访问真实 data/。
  for (const file of [
    ".next",
    "node_modules",
    "package.json",
    "next.config.mjs",
    "public",
  ])
    await symlink(path.join(root, file), path.join(directory, file));
  server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await ready();
  database = new Database(path.join(directory, "data/platform.db"));
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1244, height: 801 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const legend = page.getByRole("list", { name: "用例状态统计" });
  const chart = page.getByRole("img", { name: "用例最新执行状态分布" });

  // 无历史记录也必须显示 100% 未执行；零耗时不能显示成虚假的成功结果。
  fixtures(["fresh"], []);
  await verify(page);
  assert.equal(await chart.locator("circle").count(), 1);
  assert.equal(
    await legend
      .getByRole("listitem")
      .filter({ hasText: "未执行" })
      .textContent(),
    "未执行1100%",
  );
  assert.equal(
    await page
      .locator(".metric")
      .filter({ hasText: "平均耗时" })
      .locator("strong")
      .textContent(),
    "-",
  );

  // 大量旧失败不能挤掉其他用例；同名不同 ID 分开计数，组合父结果和已删除用例不计入。
  const taskIds = [
    "passed",
    "failed",
    "interrupted",
    "running",
    "queued",
    "fresh",
  ];
  const histories = Array.from({ length: 14 }, (_, index) => ({
    id: `old-${index}`,
    taskId: "passed",
    status: "failed",
    queuedAt: `2026-10-13T01:${String(index).padStart(2, "0")}:00.000Z`,
    durationMs: 99000,
  }));
  const mixed = [
    ...histories,
    {
      id: "current-pass",
      taskId: "passed",
      status: "succeeded",
      queuedAt: "2026-10-13T04:00:00.000Z",
      durationMs: 0,
      kind: "task",
      workflowId: "workflow",
      workflowExecutionId: "parent",
    },
    {
      id: "current-fail",
      taskId: "failed",
      status: "failed",
      queuedAt: "2026-10-13T03:00:00.000Z",
      durationMs: 3000,
    },
    {
      id: "current-interrupted",
      taskId: "interrupted",
      status: "interrupted",
      queuedAt: "2026-10-13T02:00:00.000Z",
    },
    {
      id: "current-running",
      taskId: "running",
      status: "running",
      queuedAt: "2026-10-13T05:00:00.000Z",
      durationMs: 60000,
    },
    {
      id: "current-queued",
      taskId: "queued",
      status: "queued",
      queuedAt: "2026-10-13T06:00:00.000Z",
    },
    {
      id: "parent",
      taskId: "passed",
      status: "failed",
      kind: "workflow",
      workflowId: "workflow",
      queuedAt: "2026-10-13T07:00:00.000Z",
    },
    {
      id: "deleted",
      taskId: "deleted",
      status: "failed",
      queuedAt: "2026-10-13T08:00:00.000Z",
    },
  ];
  fixtures(taskIds, mixed);
  await verify(page);
  assert.equal(await chart.locator("path").count(), 6);
  assert.equal(
    await page
      .locator(".metric")
      .filter({ hasText: "通过率" })
      .locator("strong")
      .textContent(),
    "33.3%",
  );
  assert.equal(
    await page
      .locator(".metric")
      .filter({ hasText: "平均耗时" })
      .locator("strong")
      .textContent(),
    "1.5s",
  );

  fixtures(
    ["passed"],
    [mixed.find((execution) => execution.id === "current-pass")],
  );
  await verify(page);
  assert.equal(await chart.locator("circle").count(), 1);
  assert.equal(
    await legend
      .getByRole("listitem")
      .filter({ hasText: "通过" })
      .textContent(),
    "通过1100%",
  );
  assert.equal(
    await page
      .locator(".metric")
      .filter({ hasText: "平均耗时" })
      .locator("strong")
      .textContent(),
    "0ms",
  );

  // 列表可截到 12 项，饼图仍基于全部用例；上方组合子执行已覆盖较早的单独执行。
  const manyIds = Array.from({ length: 13 }, (_, index) => `many-${index}`);
  fixtures(
    manyIds,
    manyIds.map((taskId, index) => ({
      id: `many-result-${index}`,
      taskId,
      status: "succeeded",
      kind: "task",
      queuedAt: `2026-10-13T09:${String(index).padStart(2, "0")}:00.000Z`,
    })),
  );
  await verify(page);
  assert.equal(
    await legend
      .getByRole("listitem")
      .filter({ hasText: "通过" })
      .textContent(),
    "通过13100%",
  );
  assert.deepEqual(errors, []);
  console.log(
    "隔离生产夹具：无历史、全通过、混合状态、重复历史、同名用例、组合父结果和 12 项上限通过",
  );
} finally {
  database?.close();
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
