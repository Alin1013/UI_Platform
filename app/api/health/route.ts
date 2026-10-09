/** 健康检查暴露平台状态摘要和当前并发配置。 */

import { NextResponse } from "next/server";
import { queueSnapshot } from "@/lib/queue";
import { summarize } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    summary: await summarize(),
    queue: await queueSnapshot(),
  });
}
