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
export type MidsceneCacheStrategy = "read-only" | "read-write" | "write-only";

/** Midscene 缓存能显著降低回归执行的模型调用；禁用是显式选择，而不是缺省行为。 */
export interface MidsceneCacheConfig {
  /** 缺省启用；false 用于需要每次重新规划的调试任务。 */
  enabled?: boolean;
  strategy?: MidsceneCacheStrategy;
  /** 不传时执行器使用任务 ID，保证同一任务复用缓存且不同任务不串缓存。 */
  id?: string;
}

export interface AutomationRuntime {
  browser?: BrowserId;
  /** 失败后额外尝试次数；0 表示只执行一次。 */
  retries?: number;
  /** 是否保存 Playwright trace，便于失败后回放操作序列。 */
  trace?: boolean;
  /** 仅 Midscene Runner 使用；Playwright 忽略该配置。 */
  cache?: MidsceneCacheConfig;
}

/**
 * Midscene 业务知识按 API 分层注入；default 覆盖所有调用，专用 key 优先级更高。
 * 先只开放三类高价值入口，避免把 Agent 全部上下文键直接暴露给任务 API。
 */
export type MidsceneAiContexts = {
  default?: string;
  aiAct?: string;
  aiQuery?: string;
};

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
  | "aiWaitFor"
  | "hover"
  | "scroll"
  | "doubleClick"
  | "rightClick"
  | "clearInput"
  | "aiBoolean"
  | "aiNumber"
  | "aiString";

/** scroll.value 的受控方向；until 系列会滚动到边界，比固定距离更适合分页加载。 */
export type MidsceneScrollDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "toTop"
  | "toBottom"
  | "toLeft"
  | "toRight";

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
  /** scroll 的滚动方向；其他 Midscene 步骤忽略。 */
  direction?: MidsceneScrollDirection;
  /** 单次调用上下文，优先级高于任务级 aiContexts。 */
  context?: string;
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
  /** Midscene 全局业务知识；保存为任务属性，而不是每次在步骤里重复。 */
  aiContexts?: MidsceneAiContexts;
  /** 关联的测试环境；为空时使用全局 UI_PLATFORM_BASE_URL。 */
  environmentId?: string;
  /** headless 默认 true，调试时可由任务覆盖。 */
  headless: boolean;
  steps: AutomationStep[];
  createdAt: string;
  updatedAt: string;
}

/** 测试环境定义；执行时 baseUrl 替换全局配置，凭证用于 {username}/{password} 占位符。 */
export interface TestEnvironment {
  id: string;
  /** 环境名称，例如 dev、test、prod。 */
  name: string;
  /** 被测系统基础 URL；goto 相对路径基于此解析。 */
  baseUrl: string;
  /** 登录账号，写入 fill 步骤的 {username} 占位符。 */
  username?: string;
  /** 登录密码，写入 fill 步骤的 {password} 占位符；列表页不回显。 */
  password?: string;
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
  /** 人工确认式修复建议；平台不会因为生成建议而自动改任务。 */
  healing?: HealingCandidate[];
  error?: string;
}

export type HealingStatus = "proposed" | "applied" | "rejected";

/** 一次定位器失败对应的候选修复；必须由用户确认后才写回任务。 */
export interface HealingCandidate {
  id: string;
  executionId: string;
  taskId: string;
  stepIndex: number;
  action: AutomationAction;
  originalTarget: string;
  healedTarget: string;
  reason: string;
  /** 0-1；模型自评置信度只做排序参考，不作为自动应用条件。 */
  confidence: number;
  screenshot?: string;
  status: HealingStatus;
  createdAt: string;
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
