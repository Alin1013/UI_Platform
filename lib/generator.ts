/**
 * AI 用例生成模块。
 * 模型只产出任务草稿；最终必须经过 parseTaskDraft 白名单校验，不直接执行。
 */

import { requestModelJson } from "./ai/model-client";
import type { AutomationTask, RunnerId } from "./types";

interface GeneratedTask {
  name?: unknown;
  description?: unknown;
  labels?: unknown;
  headless?: unknown;
  steps?: unknown;
}

/** 已有用例转 Midscene 草稿时保留来源，便于 API 对模型输出做最小化兜底。 */
export interface MidsceneCaseDraft extends GeneratedTask {
  steps: unknown[];
}

const playwrightRules = `
2. runner=playwright 时只能使用这些 action：
   goto, click, fill, press, wait, expectText
   click/fill 的 target 必须是 Playwright page.locator 兼容的 CSS/XPath/text 选择器，或 label=字段名。
   不得使用 aiAct/aiAssert/aiQuery/aiWaitFor。`;

const midsceneRules = `
2. runner=midscene 时推荐：
   goto 打开页面；click/fill 的 target 使用简短中文语义目标；aiAssert/aiAct/aiWaitFor 的 value 使用自然语言。
   只有明确需要提取页面数据时才用 aiQuery，并提供 schema 对象。
   不要使用 page.getByRole 这类 JavaScript API 写法。`;

function generationPrompt(input: {
  requirement: string;
  targetUrl: string;
  runner: RunnerId;
}): string {
  return `你是 Web UI 自动化测试用例生成器。根据需求生成一个平台任务草稿。

硬性要求：
1. 只返回 JSON 对象，不返回 markdown、解释或代码块。
${input.runner === "playwright" ? playwrightRules : midsceneRules}
3. 第一步必须是 goto，targetUrl 是 ${input.targetUrl}。
4. 敏感数据不要编造真实手机号、身份证或银行卡；示例值使用明显的测试值。
5. 步骤数量不超过 15，业务上有意义时才添加 wait。

需求：
${input.requirement}

返回格式：
{
  "name": "简短用例名",
  "description": "测试目的",
  "labels": ["AI生成"],
  "headless": true,
  "steps": [
    { "action": "goto", "value": "${input.targetUrl}" }
  ]
}`;
}

/** 请求模型生成草稿；输出仍会走统一校验，模型不能扩大平台 action 或 runtime 能力。 */
export async function generateTaskDraft(input: {
  requirement: string;
  targetUrl: string;
  runner: RunnerId;
}): Promise<GeneratedTask> {
  return requestModelJson<GeneratedTask>(
    "你是严谨的 Web UI 自动化测试专家，只输出合法 JSON。",
    generationPrompt(input),
  );
}

/**
 * 从已保存用例生成 Midscene 语义草稿。
 * 这里复用 Midscene 的 OpenAI-compatible 模型配置，而不是把数据库内容直接拼进浏览器执行器，
 * 这样模型只负责“理解和补全”，保存、校验、排队仍由平台已有边界负责。
 */
export async function generateMidsceneCaseDraft(
  task: AutomationTask,
): Promise<MidsceneCaseDraft> {
  const source = JSON.stringify(
    {
      name: task.name,
      description: task.description,
      target: task.target,
      steps: task.steps,
    },
    null,
    2,
  );
  const prompt = `你是 Midscene Web 测试编排器。请读取下面这条已经保存的测试用例，把它转换为可以交给 Midscene Runner 执行的任务草稿。

转换要求：
1. 只返回 JSON 对象，不返回 markdown、解释或代码块。
2. 第一步必须保留 goto；如果原用例没有 goto，使用 "${process.env.UI_PLATFORM_BASE_URL ?? "http://127.0.0.1:3000/"}" 作为兜底地址。
3. 保留原用例的业务意图和测试数据；click、fill、press 等操作优先转换为语义清晰的 aiAct，必要时可使用 fill/press。
4. 原用例中的 expectText 必须转换为 aiAssert；如果原用例没有断言，必须在业务流程末尾补充至少一个 aiAssert，描述应验证的成功结果，不要写“断言通过”这类空话。
5. 只使用 goto、click、fill、press、wait、expectText、aiAct、aiAssert、aiWaitFor、aiQuery 这些 action；runner 固定为 midscene。
6. 步骤最多 20 个，不要臆造账号、订单号等真实敏感数据。

原测试用例：
${source}

返回格式：
{
  "name": "Midscene · ${task.name}",
  "description": "将已有测试用例转换为 Midscene 语义执行并补充业务断言",
  "labels": ["Midscene", "用例转换"],
  "headless": ${task.headless},
  "steps": [
    { "action": "goto", "value": "..." },
    { "action": "aiAct", "value": "..." },
    { "action": "aiAssert", "value": "..." }
  ]
}`;

  const generated = await requestModelJson<MidsceneCaseDraft>(
    "你是严谨的 Midscene Web 自动化专家，只输出合法 JSON。",
    prompt,
  );
  const rawSteps = Array.isArray(generated.steps) ? generated.steps : [];
  const sourceGoto = task.steps.find((step) => step.action === "goto");
  const firstGenerated = rawSteps[0];
  const normalizedSteps = [
    firstGenerated &&
    typeof firstGenerated === "object" &&
    (firstGenerated as Record<string, unknown>).action === "goto"
      ? firstGenerated
      : sourceGoto
        ? { action: "goto", value: sourceGoto.value ?? sourceGoto.target }
        : { action: "goto", value: process.env.UI_PLATFORM_BASE_URL ?? "/" },
    ...rawSteps.filter(
      (step, index) =>
        index > 0 ||
        !(
          firstGenerated &&
          typeof firstGenerated === "object" &&
          (firstGenerated as Record<string, unknown>).action === "goto"
        ),
    ),
  ];

  // 模型偶尔会遗漏断言；补一个明确的业务检查，保证“生成”不会退化成只有操作没有结论。
  const hasAssertion = normalizedSteps.some(
    (step) =>
      step &&
      typeof step === "object" &&
      ["aiAssert", "expectText"].includes(String((step as Record<string, unknown>).action)),
  );
  if (!hasAssertion) {
    normalizedSteps.push({
      action: "aiAssert",
      value: `验证“${task.name}”描述的业务结果已经达成`,
    });
  }

  return {
    ...generated,
    name: String(generated.name ?? `Midscene · ${task.name}`),
    description: String(
      generated.description ?? "将已有测试用例转换为 Midscene 语义执行并补充业务断言",
    ),
    labels: Array.isArray(generated.labels) ? generated.labels : ["Midscene", "用例转换"],
    headless: typeof generated.headless === "boolean" ? generated.headless : task.headless,
    steps: normalizedSteps.slice(0, 20),
  };
}
