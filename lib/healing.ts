/**
 * 失败自愈建议模块。
 * 只处理 Playwright 定位器失败；建议必须回到真实页面验证，且默认等待人工确认。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { requestModelJson, type ModelImage } from "./ai/model-client";
import { artifactDir } from "./runner-runtime";
import { resolveLocator, runPlaywrightStep } from "./runners/playwright";
import type {
  AutomationTask,
  AutomationStep,
  BrowserId,
  HealingCandidate,
  StepLog,
  TaskExecution,
} from "./types";

interface HealingModelResult {
  target?: unknown;
  reason?: unknown;
  confidence?: unknown;
}

/** 只对会使用 target 的确定性步骤生成候选；AI 语义步骤和纯文本断言不在自愈范围内。 */
export function findHealableFailure(
  execution: TaskExecution,
): StepLog | undefined {
  return [...execution.logs]
    .reverse()
    .find(
      (log) =>
        log.status === "failed" &&
        (log.action === "click" || log.action === "fill") &&
        Boolean(log.selector),
    );
}

function healingPrompt(step: AutomationStep, failure: StepLog): string {
  return `一个 Playwright 自动化步骤因为定位器失效失败了。请只根据失败截图和上下文提出一个可用的新 target。

原动作：${step.action}
原定位器：${step.target ?? ""}
输入值：${step.value ?? ""}
错误：${failure.message ?? "定位器未能找到元素"}

要求：
1. target 必须兼容 Playwright page.locator()；推荐 button:has-text("登录")、[name="email"]、xpath=//button[...]。
2. 也可以使用平台扩展的 label=字段名，它会按 label、placeholder 和 aria-label 解析。
3. 不要输出 getByRole 等 JavaScript API。
4. 只返回 JSON：{"target":"...","reason":"简短中文原因","confidence":0.82}`;
}

/** 读取失败截图并转成视觉模型输入；没有截图时仍可基于错误文本生成，但置信度通常更低。 */
async function loadScreenshot(
  executionId: string,
  fileName: string | undefined,
): Promise<ModelImage[]> {
  if (!fileName || !/^[\w-]+\.png$/.test(fileName)) return [];
  const source = path.join(artifactDir(executionId), fileName);
  const buffer = await readFile(source);
  return [{ mimeType: "image/png", base64: buffer.toString("base64") }];
}

function normalizeCandidate(
  raw: HealingModelResult,
): Pick<HealingCandidate, "healedTarget" | "reason" | "confidence"> {
  const target = String(raw.target ?? "").trim();
  if (!target || target.length > 500 || /[\r\n]/.test(target)) {
    throw new Error("模型返回的候选定位器无效");
  }
  const confidence = Number(raw.confidence ?? 0.6);
  return {
    healedTarget: target,
    reason: String(raw.reason ?? "模型建议替换失效定位器").slice(0, 500),
    confidence: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : 0.6,
  };
}

async function launchSameBrowser(
  browserId: BrowserId,
  headless: boolean,
): Promise<Browser> {
  const playwright = await import("playwright");
  return playwright[browserId].launch({
    headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/**
 * 重放失败步骤之前的步骤，再检查候选定位器是否存在且可见。
 * 这样能避免只验证首页、却把弹窗或第二页控件当成有效修复。
 */
async function validateCandidate(
  steps: AutomationStep[],
  candidate: HealingCandidate,
  browserId: BrowserId,
  headless: boolean,
): Promise<void> {
  const browser = await launchSameBrowser(browserId, headless);
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    for (const step of steps) {
      // 失败前的确定性步骤应该能重放；如果环境已变化，明确报错比保存无效建议更好。
      await runPlaywrightStep(page, step);
    }
    const locator = await resolveLocator(page, candidate.healedTarget);
    const count = await locator.count();
    const visible = count > 0 && (await locator.first().isVisible());
    if (!visible) {
      throw new Error(
        `候选定位器在失败现场不可见（count=${count}）：${candidate.healedTarget}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

/** 生成并验证一条候选；函数只返回数据，调用方决定是否持久化和展示。 */
export async function createHealingCandidate(
  task: AutomationTask,
  execution: TaskExecution,
  failure: StepLog,
): Promise<HealingCandidate> {
  const failedStep = task.steps[failure.index - 1];
  if (!failedStep) throw new Error("失败步骤在任务定义中不存在");

  const screenshots = await loadScreenshot(execution.id, failure.screenshot);
  const raw = await requestModelJson<HealingModelResult>(
    "你是 Web UI 自动化定位器修复专家，只输出合法 JSON。",
    healingPrompt(failedStep, failure),
    screenshots,
  );
  const normalized = normalizeCandidate(raw);
  const candidate: HealingCandidate = {
    id: crypto.randomUUID(),
    executionId: execution.id,
    taskId: task.id,
    stepIndex: failure.index,
    action: failedStep.action,
    originalTarget: failure.selector ?? failedStep.target ?? "",
    ...normalized,
    screenshot: failure.screenshot,
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
  await validateCandidate(
    task.steps.slice(0, failure.index - 1),
    candidate,
    task.runtime?.browser ?? "chromium",
    task.headless,
  );
  return candidate;
}
