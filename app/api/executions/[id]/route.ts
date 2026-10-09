/** 单次执行详情 API，包含步骤日志、耗时和失败原因。 */

import { NextResponse } from "next/server";
import { getExecution } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const execution = await getExecution(id);
  if (!execution) {
    return NextResponse.json({ error: "执行记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ execution });
}
