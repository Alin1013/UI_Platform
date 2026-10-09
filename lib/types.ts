/**
 * 平台核心领域模型。
 * 先收敛 Web 自动化，桌面端通过扩展 target 和执行器适配层接入。
 */

export type TaskTarget = "web";

/** 平台执行器 ID；旧数据没有该字段时按 Playwright 处理。 */
export type RunnerId = "playwright" | "midscene";

/** 单机 Runner 当前支持的浏览器内核。 */
export type BrowserId = "chromium" | "firefox" | "webkit";

/** 与执行环境相关的可选配置；不配置时由执行层给出安全默认值。 */
export interface AutomationRuntime {
  browser?: BrowserId;
  /** 失败后额外尝试次数；0 表示只执行一次。 */
  retries?: number;
  /** 是否保存 Playwright trace，便于失败后回放操作序列。 */
  trace?: boolean;
}

export type AutomationAction =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "wait"
  | "expectText"
  | "aiAct"
  | "aiAssert"
  | "aiQuery"
  | "aiWaitFor";

export interface AutomationStep {
  action: AutomationAction;
  /** Playwright 定位表达式，或 Midscene 语义目标；goto/wait 不需要。 */
  target?: string;
  /** fill 的输入值、goto 的 URL 或 expectText 的期望文本。 */
  value?: string;
  /** wait 等待毫秒数，或单个元素操作超时。 */
  timeout?: number;
  /** aiQuery 的结构化提取契约，字段名和描述都由被测业务决定。 */
  schema?: Record<string, unknown>;
}

export interface AutomationTask {
  id: string;
  name: string;
  target: TaskTarget;
  /** 执行引擎；缺省值只兼容 v0.1 的历史任务。 */
  runner?: RunnerId;
  runtime?: AutomationRuntime;
  description?: string;
  labels: string[];
  /** headless 默认 true，调试时可由任务覆盖。 */
  headless: boolean;
  steps: AutomationStep[];
  createdAt: string;
  updatedAt: string;
}

export type ExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted";

export interface StepLog {
  index: number;
  action: string;
  /** 记录产生日志时使用的执行器，便于报告解释定位方式。 */
  runner?: RunnerId;
  /** deterministic 表示代码直连浏览器；ai 表示交给模型驱动。 */
  kind?: "deterministic" | "ai";
  attempt?: number;
  /** Playwright 实际使用的定位器；AI 步骤可以留空。 */
  selector?: string;
  /** aiQuery/aiAssert 的结构化结果或说明。 */
  aiResult?: unknown;
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  message?: string;
  screenshot?: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  runner?: RunnerId;
  browser?: BrowserId;
  status: ExecutionStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** 实际执行次数，包含首次和重试。 */
  attempts?: number;
  currentStep?: number;
  totalSteps: number;
  logs: StepLog[];
  /** Midscene 单页 HTML 报告的 artifact 文件名。 */
  reportUrl?: string;
  /** Playwright trace 的 artifact 文件名。 */
  tracePath?: string;
  error?: string;
}

export interface PlatformState {
  version: 1;
  tasks: AutomationTask[];
  executions: TaskExecution[];
}

export interface QueueSnapshot {
  concurrency: number;
  running: number;
  queued: number;
  limits: { min: 1; max: 10 };
}
