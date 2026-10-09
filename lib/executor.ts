/**
 * Web 执行器适配层。
 * 目前使用 Playwright 的确定性语义执行；未来可在此并列接入 Midscene 或桌面 runner。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type {
  AutomationTask,
  AutomationStep,
  StepLog,
} from "./types";

const defaultActionTimeout = 10_000;

/**
 * 记录调用方要求取消的执行。
 * 删除任务发生在另一个请求里，Playwright 步骤无法安全中断，因此只在步骤边界检查并停止后续工作。
 */
const cancelledExecutions = new Set<string>();

export function requestExecutionCancel(executionId: string): void {
  cancelledExecutions.add(executionId);
}

function isExecutionCancelled(executionId: string): boolean {
  return cancelledExecutions.has(executionId);
}

export function artifactDir(executionId: string): string {
  return path.join(process.cwd(), "reports", executionId);
}

function stepTimeout(step: AutomationStep): number {
  return step.timeout ?? defaultActionTimeout;
}

/** goto 需要完整 URL；相对地址会让 Playwright 因缺少 base URL 而失败。 */
function normalizeUrl(value: string): string {
  const configured = process.env.UI_PLATFORM_BASE_URL ?? "http://127.0.0.1:3000";
  return new URL(value, configured).toString();
}

async function runStep(page: Page, step: AutomationStep): Promise<void> {
  switch (step.action) {
    case "goto": {
      const url = normalizeUrl(step.value ?? step.target ?? "/");
      await page.goto(url, { timeout: stepTimeout(step), waitUntil: "domcontentloaded" });
      return;
    }
    case "click":
      await resolveLocator(page, requiredTarget(step)).then((locator) =>
        locator.click({ timeout: stepTimeout(step) }),
      );
      return;
    case "fill":
      await resolveLocator(page, requiredTarget(step)).then((locator) =>
        locator.fill(step.value ?? "", { timeout: stepTimeout(step) }),
      );
      return;
    case "press":
      await page.keyboard.press(step.value ?? "Enter");
      return;
    case "wait":
      await page.waitForTimeout(Number(step.timeout ?? step.value ?? 1000));
      return;
    case "expectText": {
      const locator = step.target
        ? page.locator(step.target)
        : page.locator("body");
      await locator
        .getByText(step.value ?? "", { exact: false })
        .first()
        .waitFor({ timeout: stepTimeout(step), state: "visible" });
      return;
    }
  }
}

function requiredTarget(step: AutomationStep): string {
  if (!step.target) throw new Error(`action=${step.action} 必须提供 target`);
  return step.target;
}

/**
 * 解析语义化字段定位器。
 * 中文界面的控件含义常在 label、placeholder 或 aria-label 中，不能把字段名直接交给 CSS 引擎。
 */
async function resolveLocator(page: Page, target: string) {
  const fieldMatch = target.match(/^label=(.+)$/);
  if (!fieldMatch) return page.locator(target);

  const label = fieldMatch[1];
  const byLabel = page.getByLabel(label, { exact: false });
  if ((await byLabel.count()) === 1) return byLabel;

  const byPlaceholder = page.getByPlaceholder(label, { exact: false });
  if ((await byPlaceholder.count()) === 1) return byPlaceholder;

  // JSON.stringify 生成带引号的 CSS 属性值，避免字段名中有特殊字符时破坏选择器。
  const cssValue = JSON.stringify(label);
  return page
    .locator(
      [
        `input[aria-label*=${cssValue} i]`,
        `textarea[aria-label*=${cssValue} i]`,
        `input[name*=${cssValue} i]`,
        `textarea[name*=${cssValue} i]`,
      ].join(","),
    )
    .first();
}

/**
 * 逐步执行并落盘截图。
 * 每完成一步都通过回调通知调度器；即使后续步骤失败，前面步骤也不会丢失。
 */
export async function executeWebTask(
  task: AutomationTask,
  executionId: string,
  onStepLog?: (log: StepLog) => Promise<void> | void,
): Promise<StepLog[]> {
  const { chromium } = await import("playwright");
  const outputDir = artifactDir(executionId);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: task.headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    const logs: StepLog[] = [];

    for (const [index, step] of task.steps.entries()) {
      // 删除任务后不继续执行剩余步骤；上一批日志保留，最终状态由调度器标记失败。
      if (isExecutionCancelled(executionId)) {
        throw new Error("任务已删除，执行已取消");
      }
      const startedAt = new Date();
      try {
        await runStep(page, step);
        if (isExecutionCancelled(executionId)) {
          throw new Error("任务已删除，执行已取消");
        }
        const screenshotName = `step-${String(index + 1).padStart(2, "0")}.png`;
        const screenshot = await page.screenshot({ fullPage: true });
        await fs.writeFile(path.join(outputDir, screenshotName), screenshot);
        logs.push({
          index: index + 1,
          action: step.action,
          status: "passed",
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          screenshot: screenshotName,
        });
        // 先把成功日志持久化，再继续下一步，保证失败报告包含真实进度。
        await onStepLog?.(logs[logs.length - 1]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const screenshotName = `step-${String(index + 1).padStart(2, "0")}-failed.png`;
        // 失败现场也需要截图，便于报告定位页面状态。
        const screenshot = await page
          .screenshot({ fullPage: true })
          .catch(() => null);
        if (screenshot) {
          await fs.writeFile(
            path.join(outputDir, screenshotName),
            screenshot,
          );
        }
        logs.push({
          index: index + 1,
          action: step.action,
          status: "failed",
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          message,
          screenshot: screenshot ? screenshotName : undefined,
        });
        // 失败日志必须先落库再抛出，否则队列只能看到最终异常。
        await onStepLog?.(logs[logs.length - 1]);
        throw error;
      }
    }

    return logs;
  } finally {
    await browser.close();
    cancelledExecutions.delete(executionId);
  }
}
