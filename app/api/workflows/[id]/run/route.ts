/** 触发流程组合执行；返回父执行 ID，前端据此打开组合监控视图。 */

import { NextResponse } from "next/server";
import { enqueueWorkflowExecution } from "@/lib/queue";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const execution = await enqueueWorkflowExecution(id);
    return NextResponse.json({ execution }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "流程提交失败" },
      { status: 400 },
    );
  }
}
