/** 失败自愈建议 API：为确定性定位器失败生成一条真实页面验证过的候选。 */

import { NextResponse } from "next/server";
import { createHealingCandidate, findHealableFailure } from "@/lib/healing";
import { getExecution, getTask, updateExecution } from "@/lib/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const execution = await getExecution(id);
    if (!execution) {
      return NextResponse.json({ error: "执行记录不存在" }, { status: 404 });
    }
    if (execution.status !== "failed") {
      throw new Error("只有失败执行可以生成修复建议");
    }

    const task = await getTask(execution.taskId);
    if (!task) {
      return NextResponse.json({ error: "关联任务不存在" }, { status: 409 });
    }
    if ((task.runner ?? "playwright") !== "playwright") {
      throw new Error("当前只为 Playwright 定位器失败生成修复建议");
    }

    const failure = findHealableFailure(execution);
    if (!failure) {
      throw new Error("没有可修复的 click/fill 定位器失败");
    }

    const existing = execution.healing?.find(
      (item) => item.stepIndex === failure.index && item.status === "proposed",
    );
    if (existing) {
      return NextResponse.json({ healing: existing });
    }

    const healing = await createHealingCandidate(task, execution, failure);
    await updateExecution(id, (current) => ({
      ...current,
      healing: [...(current.healing ?? []), healing],
    }));
    return NextResponse.json({ healing }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成修复建议失败" },
      { status: 400 },
    );
  }
}
