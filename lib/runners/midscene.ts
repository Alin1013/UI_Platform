/**
 * Midscene AI 执行适配器。
 * 把语义指令转换成 Midscene Agent 调用，同时保留平台自己的截图和步骤日志模型。
 */

import { copyFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type {
  AutomationStep,
  MidsceneAiContexts,
  MidsceneCacheConfig,
  MidsceneScrollDirection,
  RunnerId,
} from "../types";
import { normalizeUrl } from "./playwright";

/** 只声明平台实际使用的 Midscene 方法，避免依赖内部实现类型。 */
type MidsceneAgent = {
  aiTap(target: string, options?: { context?: string }): Promise<void>;
  aiInput(
    target: string,
    options: { value: string; mode?: "replace"; context?: string },
  ): Promise<void>;
  aiKeyboardPress(
    target: string | undefined,
    options: { keyName: string; context?: string },
  ): Promise<void>;
  aiHover(target: string, options?: { context?: string }): Promise<void>;
  aiScroll(
    target: string | undefined,
    options: {
      direction?: "up" | "down" | "left" | "right";
      scrollType:
        | "singleAction"
        | "scrollToTop"
        | "scrollToBottom"
        | "scrollToLeft"
        | "scrollToRight";
      context?: string;
    },
  ): Promise<void>;
  aiDoubleClick(target: string, options?: { context?: string }): Promise<void>;
  aiRightClick(target: string, options?: { context?: string }): Promise<void>;
  aiClearInput(target: string, options?: { context?: string }): Promise<void>;
  aiBoolean(prompt: string, options?: { context?: string }): Promise<boolean>;
  aiNumber(prompt: string, options?: { context?: string }): Promise<number>;
  aiString(prompt: string, options?: { context?: string }): Promise<string>;
  aiAct(instruction: string): Promise<string | undefined>;
  aiAct(instruction: string, options?: { context?: string }): Promise<string | undefined>;
  aiAssert(assertion: string): Promise<
    | {
        pass?: boolean;
        thought?: string;
        message?: string;
      }
    | undefined
  >;
  aiAssert(
    assertion: string,
    options?: { context?: string },
  ): Promise<
    | {
        pass?: boolean;
        thought?: string;
        message?: string;
      }
    | undefined
  >;
  aiQuery(demand: Record<string, unknown>): Promise<unknown>;
  aiQuery(
    demand: Record<string, unknown>,
    options?: { context?: string },
  ): Promise<unknown>;
  aiWaitFor(
    assertion: string,
    options?: { timeoutMs?: number; context?: string },
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

/** 把平台方向枚举转换为 Midscene 的 direction + scrollType 组合。 */
function midsceneScrollParams(direction: MidsceneScrollDirection): {
  direction?: "up" | "down" | "left" | "right";
  scrollType:
    | "singleAction"
    | "scrollToTop"
    | "scrollToBottom"
    | "scrollToLeft"
    | "scrollToRight";
} {
  const directions = { up: "up", down: "down", left: "left", right: "right" } as const;
  switch (direction) {
    case "up":
      return { direction: directions.up, scrollType: "singleAction" };
    case "down":
      return { direction: directions.down, scrollType: "singleAction" };
    case "left":
      return { direction: directions.left, scrollType: "singleAction" };
    case "right":
      return { direction: directions.right, scrollType: "singleAction" };
    case "toTop":
      return { direction: directions.up, scrollType: "scrollToTop" };
    case "toBottom":
      return { direction: directions.down, scrollType: "scrollToBottom" };
    case "toLeft":
      return { direction: directions.left, scrollType: "scrollToLeft" };
    case "toRight":
      return { direction: directions.right, scrollType: "scrollToRight" };
  }
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
  options: {
    taskName: string;
    taskId: string;
    executionId: string;
    defaultTimeout: number;
    aiContexts?: MidsceneAiContexts;
    cache?: MidsceneCacheConfig;
  },
): Promise<MidsceneSession> {
  assertMidsceneConfigured();
  const { PlaywrightAgent } = await import("@midscene/web/playwright");
  // 缓存 ID 绑定任务而不是执行；报告文件仍绑定执行，回归执行才能复用定位结果。
  const cache =
    options.cache?.enabled === false
      ? false
      : {
          id: options.cache?.id ?? options.taskId,
          strategy: options.cache?.strategy ?? "read-write",
        };
  const agent = new PlaywrightAgent(page, {
    groupName: options.taskName,
    groupDescription: "由 UI 自动化平台调度执行",
    generateReport: true,
    persistExecutionDump: true,
    reportFileName: `midscene-${options.executionId}`,
    aiContexts: options.aiContexts,
    cache,
  }) as unknown as MidsceneAgent;

  return { agent, defaultTimeout: options.defaultTimeout };
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
        session.agent.aiTap(target, { context: step.context }),
        timeout,
        `点击 ${target}`,
      );
    }
    case "fill": {
      const target = requiredText(step, "target");
      const value = requiredText(step, "value");
      return withTimeout(
        session.agent.aiInput(target, {
          value,
          // 平台 fill 语义是替换旧值；显式 mode 避免依赖 Midscene 的默认输入行为。
          mode: "replace",
          context: step.context,
        }),
        timeout,
        `输入 ${target}`,
      );
    }
    case "press": {
      const key = requiredText(step, "value");
      return withTimeout(
        session.agent.aiKeyboardPress(step.target, {
          keyName: key,
          context: step.context,
        }),
        timeout,
        `按下 ${key}`,
      );
    }
    case "hover": {
      const target = requiredText(step, "target");
      return withTimeout(
        session.agent.aiHover(target, { context: step.context }),
        timeout,
        `悬停 ${target}`,
      );
    }
    case "scroll": {
      const direction = step.direction ?? "down";
      return withTimeout(
        session.agent.aiScroll(step.target, {
          ...midsceneScrollParams(direction),
          context: step.context,
        }),
        timeout,
        `滚动 ${direction}`,
      );
    }
    case "doubleClick": {
      const target = requiredText(step, "target");
      return withTimeout(
        session.agent.aiDoubleClick(target, { context: step.context }),
        timeout,
        `双击 ${target}`,
      );
    }
    case "rightClick": {
      const target = requiredText(step, "target");
      return withTimeout(
        session.agent.aiRightClick(target, { context: step.context }),
        timeout,
        `右键 ${target}`,
      );
    }
    case "clearInput": {
      const target = requiredText(step, "target");
      return withTimeout(
        session.agent.aiClearInput(target, { context: step.context }),
        timeout,
        `清空 ${target}`,
      );
    }
    case "expectText": {
      const expected = requiredText(step, "value");
      const result = await withTimeout(
        session.agent.aiAssert(`页面包含文本 ${expected}`, {
          context: step.context,
        }),
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
        session.agent.aiAct(requiredText(step, "value"), {
          context: step.context,
        }),
        timeout,
        "AI 操作",
      );
    }
    case "aiAssert": {
      return withTimeout(
        session.agent.aiAssert(requiredText(step, "value"), {
          context: step.context,
        }),
        timeout,
        "AI 断言",
      );
    }
    case "aiQuery": {
      if (!step.schema || typeof step.schema !== "object") {
        throw new Error("action=aiQuery 必须提供 schema 对象");
      }
      return withTimeout(
        session.agent.aiQuery(step.schema, { context: step.context }),
        timeout,
        "AI 数据提取",
      );
    }
    case "aiWaitFor": {
      return withTimeout(
        session.agent.aiWaitFor(requiredText(step, "value"), {
          timeoutMs: timeout,
          context: step.context,
        }),
        timeout,
        "AI 等待条件",
      );
    }
    case "aiBoolean": {
      return withTimeout(
        session.agent.aiBoolean(requiredText(step, "value"), {
          context: step.context,
        }),
        timeout,
        "AI 布尔判断",
      );
    }
    case "aiNumber": {
      return withTimeout(
        session.agent.aiNumber(requiredText(step, "value"), {
          context: step.context,
        }),
        timeout,
        "AI 数值提取",
      );
    }
    case "aiString": {
      return withTimeout(
        session.agent.aiString(requiredText(step, "value"), {
          context: step.context,
        }),
        timeout,
        "AI 字符串提取",
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
