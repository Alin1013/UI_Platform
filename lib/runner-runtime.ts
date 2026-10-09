/**
 * Web Runner 运行时。
 * 这里统一管理浏览器、trace、截图、取消和步骤日志；具体 Runner 只实现“一步怎么执行”。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type {
  AutomationStep,
  AutomationTask,
  BrowserId,
  RunnerId,
  StepLog,
} from "./types";
import { runPlaywrightStep } from "./runners/playwright";
import {
  finalizeMidsceneSession,
  isMidsceneAiStep,
  prepareMidsceneSession,
  runMidsceneStep,
  type MidsceneSession,
} from "./runners/midscene";

const defaultActionTimeout = 10_000;
const defaultAiTimeout = Number(process.env.UI_PLATFORM_AI_STEP_TIMEOUT ?? 60_000);

/** 记录调用方要求取消的执行；只能在步骤边界安全停止，不能中断正在执行的浏览器 API。 */
const cancelledExecutions = new Set<string>();

export interface RunnerArtifacts {
  reportUrl?: string;
  tracePath?: string;
}

export interface WebExecutionOptions {
  attempt?: number;
  onStepLog?: (log: StepLog) => Promise<void> | void;
  /** 失败执行也要归档 trace/report，因此在抛出错误前回调一次产物结果。 */
  onArtifacts?: (artifacts: RunnerArtifacts) => Promise<void> | void;
}

/** 每个 Runner 的统一内部契约；session 只在 Runtime 内部传递。 */
interface WebRunner {
  id: RunnerId;
  prepare(page: Page): Promise<MidsceneSession | undefined>;
  runStep(
    page: Page,
    session: MidsceneSession | undefined,
    step: AutomationStep,
  ): Promise<unknown>;
  finalize(
    executionId: string,
    session: MidsceneSession | undefined,
  ): Promise<RunnerArtifacts & { runner: RunnerId }>;
}

export function requestExecutionCancel(executionId: string): void {
  cancelledExecutions.add(executionId);
}

function isExecutionCancelled(executionId: string): boolean {
  return cancelledExecutions.has(executionId);
}

export function artifactDir(executionId: string): string {
  return path.join(process.cwd(), "reports", executionId);
}

function actionTimeout(step: AutomationStep): number {
  return step.timeout ?? defaultActionTimeout;
}

function browserId(task: AutomationTask): BrowserId {
  return task.runtime?.browser ?? "chromium";
}

function createRunner(task: AutomationTask, executionId: string): WebRunner {
  if ((task.runner ?? "playwright") === "midscene") {
    return {
      id: "midscene",
      prepare: (page) =>
        prepareMidsceneSession(
          page,
          task.name,
          // 报告文件必须绑定本次执行；任务 ID 会在多次运行间冲突。
          executionId,
          defaultAiTimeout,
        ),
      runStep: (page, session, step) => {
        if (!session) throw new Error("Midscene 会话未初始化");
        return runMidsceneStep(page, session, step);
      },
      finalize: (executionId, session) =>
        finalizeMidsceneSession(session, executionId),
    };
  }

  return {
    id: "playwright",
    prepare: async () => undefined,
    runStep: (_page, _session, step) => runPlaywrightStep(_page, step),
    finalize: async () => ({ runner: "playwright" }),
  };
}

async function launchBrowser(task: AutomationTask): Promise<Browser> {
  const playwright = await import("playwright");
  const selected = playwright[browserId(task)];
  return selected.launch({
    headless: task.headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/**
 * 逐步执行任务并产出统一报告数据。
 * 成功日志和失败日志都先通过回调持久化，再继续执行，保证崩溃后报告仍保留真实进度。
 */
export async function executeWebTask(
  task: AutomationTask,
  executionId: string,
  options: WebExecutionOptions = {},
): Promise<StepLog[]> {
  const attempt = options.attempt ?? 1;
  const runner = createRunner(task, executionId);
  const outputDir = artifactDir(executionId);
  const tracePath = path.join(outputDir, "trace.zip");
  const browser = await launchBrowser(task);
  let context: BrowserContext | undefined;
  let session: MidsceneSession | undefined;
  let tracing = false;
  let artifacts: RunnerArtifacts = {};
  const logs: StepLog[] = [];

  try {
    await fs.mkdir(outputDir, { recursive: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    if (task.runtime?.trace) {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
      tracing = true;
    }

    const page = await context.newPage();
    session = await runner.prepare(page);

    for (const [index, step] of task.steps.entries()) {
      // 删除任务后不继续执行剩余步骤；上一批日志保留，最终状态由调度器标记失败。
      if (isExecutionCancelled(executionId)) {
        throw new Error("任务已删除，执行已取消");
      }

      const startedAt = new Date();
      try {
        const aiResult = await runner.runStep(page, session, step);
        if (isExecutionCancelled(executionId)) {
          throw new Error("任务已删除，执行已取消");
        }
        const screenshotName = `step-${String(index + 1).padStart(2, "0")}.png`;
        const screenshot = await page.screenshot({ fullPage: true });
        await fs.writeFile(path.join(outputDir, screenshotName), screenshot);
        const log: StepLog = {
          index: index + 1,
          action: step.action,
          runner: runner.id,
          kind:
            runner.id === "midscene" && isMidsceneAiStep(step)
              ? "ai"
              : "deterministic",
          attempt,
          selector: runner.id === "playwright" ? step.target : undefined,
          aiResult,
          status: "passed",
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          screenshot: screenshotName,
        };
        logs.push(log);
        await options.onStepLog?.(log);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const screenshotName = `step-${String(index + 1).padStart(2, "0")}-failed.png`;
        // 失败现场也需要截图，便于报告定位页面状态。
        const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
        if (screenshot) {
          await fs.writeFile(path.join(outputDir, screenshotName), screenshot);
        }
        const log: StepLog = {
          index: index + 1,
          action: step.action,
          runner: runner.id,
          kind:
            runner.id === "midscene" && isMidsceneAiStep(step)
              ? "ai"
              : "deterministic",
          attempt,
          selector: runner.id === "playwright" ? step.target : undefined,
          status: "failed",
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          message,
          screenshot: screenshot ? screenshotName : undefined,
        };
        logs.push(log);
        await options.onStepLog?.(log);
        throw error;
      }
    }

    return logs;
  } finally {
    try {
      if (context && tracing) {
        await context.tracing.stop({ path: tracePath });
        artifacts.tracePath = "trace.zip";
      }
      // Midscene Agent 可能持有页面监听器；先销毁再关闭浏览器，避免资源释放顺序问题。
      const { runner: _runnerId, ...runnerArtifacts } = await runner.finalize(executionId, session).catch(
        () => ({ runner: runner.id }),
      );
      artifacts = { ...runnerArtifacts, ...artifacts };
      await options.onArtifacts?.(artifacts);
    } finally {
      await browser.close().catch(() => undefined);
      cancelledExecutions.delete(executionId);
    }
  }

}
