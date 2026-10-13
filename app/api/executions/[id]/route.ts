/** 单次执行详情 API；流程父执行会附带子用例执行，便于一次请求渲染组合报告。 */

import { NextResponse } from "next/server";
import { deleteExecutions, ExecutionDeletionError, getExecution, listExecutions } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const execution = await getExecution(id);
  if (!execution) {
    return NextResponse.json({ error: "执行记录不存在" }, { status: 404 });
  }
  const children = execution.kind === "workflow"
    ? (await listExecutions()).filter(
        (item) => item.workflowExecutionId === execution.id,
      )
    : undefined;
  return NextResponse.json({
    execution,
    // 单用例调用方继续只读 execution 字段；新增字段向后兼容。
    children,
  });
}

/** 单条删除复用批量事务；删除流程父执行时响应包含一并删除的子执行 ID。 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const deletedIds = await deleteExecutions([id]);
    return NextResponse.json({ ok: true, deletedIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除执行记录失败" },
      { status: error instanceof ExecutionDeletionError ? error.status : 500 },
    );
  }
}
