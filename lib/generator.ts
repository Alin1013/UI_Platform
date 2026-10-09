/**
 * AI 用例生成模块。
 * 模型只产出任务草稿；最终必须经过 parseTaskDraft 白名单校验，不直接执行。
 */

import { requestModelJson } from "./ai/model-client";
import type { RunnerId } from "./types";

interface GeneratedTask {
  name?: unknown;
  description?: unknown;
  labels?: unknown;
  headless?: unknown;
  steps?: unknown;
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
