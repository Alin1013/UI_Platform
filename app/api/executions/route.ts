/** 执行记录集合 API；供仪表盘、执行列表和报告页共用。 */

import { NextResponse } from "next/server";
import { queueSnapshot } from "@/lib/queue";
import { listExecutions } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    executions: await listExecutions(),
    queue: await queueSnapshot(),
  });
}
