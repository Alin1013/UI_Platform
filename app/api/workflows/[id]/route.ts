/** 单个流程组合 API；删除只移除组合定义，不删除历史执行报告。 */

import { NextResponse } from "next/server";
import { cancelWorkflowExecution } from "@/lib/queue";
import {
  deleteWorkflow,
  getWorkflow,
  listExecutions,
  saveWorkflow,
} from "@/lib/store";
import { parseWorkflowDraft, workflowFromDraft } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const workflow = await getWorkflow(id);
  if (!workflow) {
    return NextResponse.json({ error: "流程组合不存在" }, { status: 404 });
  }
  return NextResponse.json({ workflow });
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const existing = await getWorkflow(id);
  if (!existing) {
    return NextResponse.json({ error: "流程组合不存在" }, { status: 404 });
  }
  try {
    const draft = parseWorkflowDraft(await request.json());
    const workflow = await saveWorkflow(workflowFromDraft(draft, existing));
    return NextResponse.json({ workflow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新组合失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    // 组合可能仍有子用例在跑；先取消父流程，避免编排器继续派发后续用例。
    const executions = await listExecutions();
    const activeParent = executions.find(
      (execution) =>
        execution.kind === "workflow" &&
        execution.workflowId === id &&
        (execution.status === "queued" || execution.status === "running"),
    );
    if (activeParent) await cancelWorkflowExecution(activeParent.id);

    const deleted = await deleteWorkflow(id);
    if (!deleted) {
      return NextResponse.json({ error: "流程组合不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除组合失败" },
      { status: 500 },
    );
  }
}
