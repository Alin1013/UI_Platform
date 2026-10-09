/** 单个任务 API：详情、更新和删除共用同一套任务校验规则。 */

import { NextResponse } from "next/server";
import { deleteTask, getTask, saveTask } from "@/lib/store";
import { parseTaskDraft, taskFromDraft } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ task });
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const existing = await getTask(id);
  if (!existing) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  try {
    const draft = parseTaskDraft(await request.json());
    const task = await saveTask(taskFromDraft(draft, existing));
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新任务失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const deleted = await deleteTask(id);
  if (!deleted) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
