/** 执行记录集合 API；供仪表盘、执行列表和报告页共用。 */

import { NextResponse } from "next/server";
import { queueSnapshot } from "@/lib/queue";
import { deleteExecutions, ExecutionDeletionError, listExecutions } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    executions: await listExecutions(),
    queue: await queueSnapshot(),
  });
}

/** 批量删除只接受明确的非空 ID 集合；任一记录不可删除时整批保持原样。 */
export async function DELETE(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是有效 JSON" }, { status: 400 });
  }
  const ids = payload && typeof payload === "object" && "ids" in payload ? payload.ids : undefined;
  if (!Array.isArray(ids) || !ids.length ||
    !ids.every((id): id is string => typeof id === "string" && id.trim().length > 0)) {
    return NextResponse.json({ error: "请选择要删除的执行记录，ids 必须是非空字符串数组" }, { status: 400 });
  }
  try {
    const deletedIds = await deleteExecutions(ids);
    return NextResponse.json({ ok: true, deletedIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除执行记录失败" },
      { status: error instanceof ExecutionDeletionError ? error.status : 500 },
    );
  }
}
