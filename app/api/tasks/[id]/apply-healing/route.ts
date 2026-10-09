/** 应用修复建议 API：用户确认后才把候选定位器写回任务定义。 */

import { NextResponse } from "next/server";
import { getExecution, getTask, saveTask, updateExecution } from "@/lib/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const executionId = String(body.executionId ?? "");
    const healingId = String(body.healingId ?? "");
    if (!executionId || !healingId) {
      throw new Error("必须提供 executionId 和 healingId");
    }

    const [task, execution] = await Promise.all([getTask(id), getExecution(executionId)]);
    if (!task || !execution || execution.taskId !== task.id) {
      return NextResponse.json({ error: "任务或执行记录不存在" }, { status: 404 });
    }

    const healing = execution.healing?.find((item) => item.id === healingId);
    if (!healing || healing.status !== "proposed") {
      throw new Error("修复建议不存在或已处理");
    }
    const step = task.steps[healing.stepIndex - 1];
    if (!step || step.action !== healing.action) {
      throw new Error("任务步骤已变化，修复建议需要重新生成");
    }
    if (step.target !== healing.originalTarget) {
      throw new Error("任务定位器已被修改，修复建议需要重新生成");
    }

    // 只替换与失败现场一致的 target；不改步骤语义，也不覆盖用户在生成建议后的手工修改。
    const updatedTask = {
      ...task,
      steps: task.steps.map((item, index) =>
        index === healing.stepIndex - 1 ? { ...item, target: healing.healedTarget } : item,
      ),
      updatedAt: new Date().toISOString(),
    };
    await saveTask(updatedTask);
    const updatedExecution = await updateExecution(executionId, (current) => ({
      ...current,
      healing: (current.healing ?? []).map((item) =>
        item.id === healingId ? { ...item, status: "applied" as const } : item,
      ),
    }));

    return NextResponse.json({ task: updatedTask, execution: updatedExecution });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "应用修复失败" },
      { status: 400 },
    );
  }
}
