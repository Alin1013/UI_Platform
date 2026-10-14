/** 执行重试 API；按原执行类型重新入队，保留失败记录用于结果对比。 */

import { NextResponse } from "next/server";
import { enqueueExecution, enqueueTestWorkflowExecution, enqueueWorkflowExecution } from "@/lib/queue";
import { getExecution, listExecutions } from "@/lib/store";

interface RetryRuntime {
  /** 以重试目标为 key 串行化检查与入队，避免并发展请求双写流程父执行。 */
  locks: Map<string, Promise<unknown>>;
}

const globalRetry = globalThis as typeof globalThis & {
  __uiAutomationRetry?: RetryRuntime;
};

function runtime(): RetryRuntime {
  globalRetry.__uiAutomationRetry ??= { locks: new Map() };
  return globalRetry.__uiAutomationRetry;
}

/**
 * Next 开发模式可能重载路由模块，锁必须挂在 globalThis。
 * 只覆盖控制面的检查-入队窗口；跨进程部署仍需要数据库或分布式锁。
 */
async function withRetryLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const locks = runtime().locks;
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

/** 按原执行类型手动重试；202 表示已重新入队，最终结果仍通过执行详情轮询。 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const source = await getExecution(id);
    if (!source) {
      return NextResponse.json({ error: "执行记录不存在" }, { status: 404 });
    }
    if (source.status === "queued" || source.status === "running") {
      return NextResponse.json(
        { error: "执行仍在进行中，不能重复重试" },
        { status: 409 },
      );
    }

    // 重试目标是业务对象而非旧记录：同一组合或用例在同一时刻只允许一个重试请求入队。
    const targetKey = source.kind === "workflow"
      ? `workflow:${source.workflowId ?? "missing"}`
      : `task:${source.taskId || "missing"}`;
    const execution = await withRetryLock(targetKey, async () => {
      const allExecutions = await listExecutions();
      const hasActiveTarget = allExecutions.some((item) => {
        if (item.status !== "queued" && item.status !== "running") return false;
        if (source.kind === "workflow") {
          return item.kind === "workflow" && item.workflowId === source.workflowId;
        }
        // 子用例重试也检查所属父流程，避免在原流程继续运行时产生旁路执行。
        return item.taskId === source.taskId ||
          (item.kind === "workflow" && Boolean(item.workflowTaskIds?.includes(source.taskId)));
      });
      if (hasActiveTarget) {
        throw new ActiveTargetError();
      }

      // 重试始终创建新执行；原记录不可变，方便追踪每次人工干预和修复后的结果。
      return source.kind === "workflow"
        ? source.workflowId
          ? source.workflowKind === "test-workflow"
            ? await enqueueTestWorkflowExecution(source.workflowId)
            : await enqueueWorkflowExecution(source.workflowId)
          : undefined
        : source.taskId
          ? await enqueueExecution(source.taskId)
          : undefined;
    });

    if (!execution) {
      return NextResponse.json(
        { error: "原执行缺少关联用例或流程组合" },
        { status: 409 },
      );
    }
    return NextResponse.json({ execution }, { status: 202 });
  } catch (error) {
    if (error instanceof ActiveTargetError) {
      return NextResponse.json(
        { error: "关联用例或流程正在执行中，请稍后重试" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "执行重试失败" },
      { status: 400 },
    );
  }
}

/** 只用类型区分“目标正在执行”，避免靠错误文案做流程控制。 */
class ActiveTargetError extends Error {
  constructor() {
    super("重试目标正在执行");
  }
}
