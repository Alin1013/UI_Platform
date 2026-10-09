/** 触发任务执行；调度器立即返回排队结果，前端轮询获取进度。 */

import { NextResponse } from "next/server";
import { enqueueExecution } from "@/lib/queue";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const execution = await enqueueExecution(id);
    return NextResponse.json({ execution }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "任务提交失败" },
      { status: 400 },
    );
  }
}
