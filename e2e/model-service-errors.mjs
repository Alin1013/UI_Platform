/** 模型错误链路回归：本地网关经真实模型客户端生成错误，再验证修复建议页面与手动重试。 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import ts from "typescript";
import { chromium } from "playwright";

// 使用项目已有编译器加载独立客户端，兼容不能直接导入 TypeScript 的 Node 版本。
const source = await readFile(
  new URL("../lib/ai/model-client.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
});
const { requestModelJson } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const html =
  "<!DOCTYPE html><html><title>504 Gateway time-out</title><body>proxy diagnostic</body></html>";
let status = 504;
let body = html;
let delay = 0;
let requests = 0;
const gateway = createServer((request, response) => {
  requests += 1;
  assert.equal(request.url, "/v1/chat/completions");
  request.resume();
  const reply = () => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  };
  if (delay) setTimeout(reply, delay);
  else reply();
});
await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
process.env.MIDSCENE_MODEL_BASE_URL = `http://127.0.0.1:${gateway.address().port}/v1`;
process.env.MIDSCENE_MODEL_API_KEY = "fixture-key";
process.env.MIDSCENE_MODEL_NAME = "fixture-model";
delete process.env.UI_PLATFORM_GENERATOR_MODEL;
process.env.UI_PLATFORM_AI_REQUEST_TIMEOUT = "3000";

/** 失败必须保留中文原因和必要状态码，且不包含网关页面源码。 */
async function failure(expected) {
  const before = requests;
  await assert.rejects(requestModelJson("fixture", "fixture"), (error) => {
    assert.match(error.message, expected);
    assert.doesNotMatch(
      error.message,
      /<!doctype|<html|<title|proxy diagnostic/i,
    );
    assert.ok(error.message.length < 250, "错误应为简短提示");
    return true;
  });
  assert.equal(requests, before + 1, "失败不能自动重复模型 POST 请求");
}

let browser;
try {
  await failure(/504.*超时.*重试/);
  for (const [code, expected] of [
    [502, /502.*暂时不可用/],
    [503, /503.*暂时不可用/],
    [429, /429.*额度/],
    [401, /401.*认证/],
    [403, /403.*权限/],
    [404, /404.*模型/],
  ]) {
    status = code;
    await failure(expected);
  }
  status = 400;
  body = JSON.stringify({ error: { message: "unsupported model" } });
  await failure(/400.*unsupported model/);
  body = JSON.stringify({ error: { message: html } });
  await failure(/400.*检查模型配置/);
  body = html;
  await failure(/400.*检查模型配置/);
  delay = 100;
  process.env.UI_PLATFORM_AI_REQUEST_TIMEOUT = "30";
  await failure(/模型请求超时.*重试/);
  delay = 0;
  process.env.UI_PLATFORM_AI_REQUEST_TIMEOUT = "3000";
  status = 200;
  body = JSON.stringify({
    choices: [{ message: { content: '{"target":"#username"}' } }],
  });
  assert.deepEqual(await requestModelJson("fixture", "fixture"), {
    target: "#username",
  });
  console.log("模型网关 HTTP 错误、HTML 隔离、超时和成功响应检查通过");

  // 所有应用 API 都由浏览器拦截，测试不会发起真实模型调用、重放步骤或写入任务。
  const execution = {
    id: "model-error-execution",
    taskId: "model-error-task",
    runner: "playwright",
    status: "failed",
    totalSteps: 1,
    logs: [
      {
        index: 1,
        action: "fill",
        status: "failed",
        selector: "#old",
        message: "定位器未找到",
      },
    ],
    healing: [],
  };
  const candidate = {
    id: "model-error-candidate",
    stepIndex: 1,
    action: "fill",
    originalTarget: "#old",
    healedTarget: "#username",
    reason: "定位器已验证",
    confidence: 0.9,
    status: "proposed",
  };
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1244, height: 801 },
  });
  status = 504;
  body = html;
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/heal")) {
      assert.equal(route.request().method(), "POST");
      try {
        await requestModelJson("fixture", "fixture");
        execution.healing = [candidate];
        await route.fulfill({ status: 201, json: { healing: candidate } });
      } catch (error) {
        await route.fulfill({ status: 400, json: { error: error.message } });
      }
      return;
    }
    assert.equal(route.request().method(), "GET", "其他应用接口只允许读取");
    const json =
      pathname === "/api/tasks"
        ? {
            tasks: [
              {
                id: execution.taskId,
                name: "模型错误回归",
                runner: "playwright",
              },
            ],
          }
        : pathname === "/api/executions"
          ? { executions: [execution] }
          : { execution };
    await route.fulfill({ json });
  });
  await page.goto(
    `${process.argv[2] ?? "http://localhost:3000"}/executions?focus=${execution.id}`,
  );
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "失败修复建议", exact: true }),
  });
  await panel
    .getByRole("button", { name: "生成修复建议", exact: true })
    .click();
  const alert = panel.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.innerText(), /504.*超时.*重试/);
  assert.doesNotMatch(await alert.innerText(), /<|proxy diagnostic/);
  assert.ok(
    (await alert.boundingBox()).height < 120,
    "网关错误不应占据大块页面",
  );
  await page.setViewportSize({ width: 390, height: 801 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "窄屏提示不应横向溢出",
  );
  status = 200;
  body = JSON.stringify({
    choices: [{ message: { content: '{"target":"#username"}' } }],
  });
  await panel
    .getByRole("button", { name: "生成修复建议", exact: true })
    .click();
  await panel.getByText(candidate.reason, { exact: true }).waitFor();
  assert.equal(await alert.count(), 0, "手动重试成功后应清除错误提示");
  console.log("修复建议页面 504 提示、窄屏布局与手动重试成功检查通过");
} finally {
  await browser?.close();
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
}
