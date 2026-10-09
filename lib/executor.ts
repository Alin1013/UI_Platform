/**
 * Web 执行器门面。
 * 队列只依赖这个小接口；具体 Playwright/Midscene 能力和运行时细节都藏在下游模块里。
 */

export {
  artifactDir,
  executeWebTask,
  requestExecutionCancel,
  type RunnerArtifacts,
  type WebExecutionOptions,
} from "./runner-runtime";
