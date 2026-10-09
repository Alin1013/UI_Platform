/**
 * Playwright 确定性执行适配器。
 * 只负责“一步如何执行”，浏览器生命周期、截图和日志仍由 Runner Runtime 统一处理。
 */

import type { Page } from "playwright";
import type { AutomationStep } from "../types";

const defaultActionTimeout = 10_000;

function stepTimeout(step: AutomationStep): number {
  return step.timeout ?? defaultActionTimeout;
}

/** goto 需要完整 URL；相对地址会交给平台 base URL 解析，方便同一用例跨环境运行。 */
export function normalizeUrl(value: string): string {
  const configured = process.env.UI_PLATFORM_BASE_URL ?? "http://127.0.0.1:3000";
  return new URL(value, configured).toString();
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

/** 执行一个 Playwright 原生动作；返回 void 表示该动作没有需要写入报告的结构化结果。 */
export async function runPlaywrightStep(
  page: Page,
  step: AutomationStep,
): Promise<void> {
  switch (step.action) {
    case "goto": {
      const url = normalizeUrl(step.value ?? step.target ?? "/");
      await page.goto(url, {
        timeout: stepTimeout(step),
        waitUntil: "domcontentloaded",
      });
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
    default:
      // 校验层已经拒绝组合错误；这里兜底提示，防止未来新增动作时静默失败。
      throw new Error(`Playwright Runner 不支持 action=${step.action}`);
  }
}
