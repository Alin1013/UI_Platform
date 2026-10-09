/**
 * 平台核心领域模型。
 * 先收敛 Web 自动化，桌面端通过扩展 target 和执行器适配层接入。
 */

export type TaskTarget = "web";

export type AutomationAction =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "wait"
  | "expectText";

export interface AutomationStep {
  action: AutomationAction;
  /** Playwright 定位表达式；goto/wait 不需要。 */
  target?: string;
  /** fill 的输入值、goto 的 URL 或 expectText 的期望文本。 */
  value?: string;
  /** wait 等待毫秒数，或单个元素操作超时。 */
  timeout?: number;
}

export interface AutomationTask {
  id: string;
  name: string;
  target: TaskTarget;
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
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  message?: string;
  screenshot?: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  currentStep?: number;
  totalSteps: number;
  logs: StepLog[];
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
