/**
 * Midscene AI 执行适配器。
 * 把语义指令转换成 Midscene Agent 调用，同时保留平台自己的截图和步骤日志模型。
 */

import { copyFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { AutomationStep, RunnerId } from "../types";
import { normalizeUrl } from "./playwright";

/** 只声明平台实际使用的 Midscene 方法，避免依赖内部实现类型。 */
type MidsceneAgent = {
  aiAct(instruction: string): Promise<string | undefined>;
  aiAssert(assertion: string): Promise<
    | {
        pass?: boolean;
        thought?: string;
        message?: string;
      }
    | undefined
  >;
  aiQuery(demand: Record<string, unknown>): Promise<unknown>;
  aiWaitFor(
    assertion: string,
    options?: { timeoutMs?: number },
  ): Promise<void>;
  destroy(): Promise<void>;
};

/** prepare 后保存在 Runner Runtime 里的页面级会话。 */
export interface MidsceneSession {
  agent: MidsceneAgent;
  /** 单个 AI 调用的默认硬超时；步骤可覆盖。 */
  defaultTimeout: number;
}

/** AI 步骤会调用模型；goto/wait 仍直接使用 Playwright，避免不必要成本。 */
export function isMidsceneAiStep(step: AutomationStep): boolean {
  return !["goto", "wait"].includes(step.action);
}

function assertMidsceneConfigured(): void {
  const missing = [
    "MIDSCENE_MODEL_BASE_URL",
    "MIDSCENE_MODEL_API_KEY",
    "MIDSCENE_MODEL_NAME",
  ].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Midscene 未配置：缺少 ${missing.join(", ")}`);
  }
}

/** 给模型调用加硬超时，防止一次语义操作长时间占用平台并发槽。 */
async function withTimeout<T>(
  operation: Promise<T>,
  timeout: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 超过 ${timeout}ms 未完成`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function requiredText(step: AutomationStep, field: "target" | "value"): string {
  const text = step[field];
  if (!text) {
    throw new Error(`action=${step.action} 必须提供 ${field}`);
  }
  return text;
}

/**
 * Midscene 报告默认生成在 midscene_run/report 下。
 * 文件名绑定 executionId，保证并发执行互不覆盖；完成后复制进平台统一产物目录。
 */
async function copyMidsceneReport(executionId: string): Promise<string | undefined> {
  const source = path.join(
    process.cwd(),
    "midscene_run",
    "report",
    `midscene-${executionId}.html`,
  );
  const targetName = "midscene-report.html";
  try {
    await copyFile(source, path.join(process.cwd(), "reports", executionId, targetName));
    return targetName;
  } catch {
    // 报告生成失败不应让已通过的执行变成失败；平台截图仍是最小证据。
    return undefined;
  }
}

export async function prepareMidsceneSession(
  page: Page,
  taskName: string,
  executionId: string,
  defaultTimeout: number,
): Promise<MidsceneSession> {
  assertMidsceneConfigured();
  const { PlaywrightAgent } = await import("@midscene/web/playwright");
  const agent = new PlaywrightAgent(page, {
    groupName: taskName,
    groupDescription: "由 UI 自动化平台调度执行",
    generateReport: true,
    persistExecutionDump: true,
    reportFileName: `midscene-${executionId}`,
  }) as unknown as MidsceneAgent;

  return { agent, defaultTimeout };
}

export async function runMidsceneStep(
  page: Page,
  session: MidsceneSession,
  step: AutomationStep,
): Promise<unknown> {
  const timeout = step.timeout ?? session.defaultTimeout;

  switch (step.action) {
    case "goto": {
      await page.goto(normalizeUrl(requiredText(step, "value")), {
        timeout,
        waitUntil: "domcontentloaded",
      });
      return undefined;
    }
    case "wait": {
      await page.waitForTimeout(Number(step.timeout ?? step.value ?? 1000));
      return undefined;
    }
    case "click": {
      const target = step.target ?? requiredText(step, "value");
      return withTimeout(
        session.agent.aiAct(`点击页面中的 ${target}`),
        timeout,
        `点击 ${target}`,
      );
    }
    case "fill": {
      const target = requiredText(step, "target");
      const value = requiredText(step, "value");
      return withTimeout(
        session.agent.aiAct(`在页面中的 ${target} 输入 ${value}`),
        timeout,
        `输入 ${target}`,
      );
    }
    case "press": {
      const key = requiredText(step, "value");
      return withTimeout(
        session.agent.aiAct(`按下 ${key} 键`),
        timeout,
        `按下 ${key}`,
      );
    }
    case "expectText": {
      const expected = requiredText(step, "value");
      const result = await withTimeout(
        session.agent.aiAssert(`页面包含文本 ${expected}`),
        timeout,
        `断言 ${expected}`,
      );
      if (result && result.pass === false) {
        throw new Error(result.message ?? result.thought ?? `页面不包含 ${expected}`);
      }
      return result;
    }
    case "aiAct": {
      return withTimeout(
        session.agent.aiAct(requiredText(step, "value")),
        timeout,
        "AI 操作",
      );
    }
    case "aiAssert": {
      return withTimeout(
        session.agent.aiAssert(requiredText(step, "value")),
        timeout,
        "AI 断言",
      );
    }
    case "aiQuery": {
      if (!step.schema || typeof step.schema !== "object") {
        throw new Error("action=aiQuery 必须提供 schema 对象");
      }
      return withTimeout(
        session.agent.aiQuery(step.schema),
        timeout,
        "AI 数据提取",
      );
    }
    case "aiWaitFor": {
      return withTimeout(
        session.agent.aiWaitFor(requiredText(step, "value"), { timeoutMs: timeout }),
        timeout,
        "AI 等待条件",
      );
    }
    default:
      throw new Error(`Midscene Runner 不支持 action=${step.action}`);
  }
}

/** 销毁 Agent 并把 Midscene 报告归档到平台报告目录。 */
export async function finalizeMidsceneSession(
  session: MidsceneSession | undefined,
  executionId: string,
): Promise<{ reportUrl?: string; runner: RunnerId }> {
  await session?.agent.destroy().catch(() => undefined);
  return { reportUrl: await copyMidsceneReport(executionId), runner: "midscene" };
}
