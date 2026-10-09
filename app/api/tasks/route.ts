/** 任务集合 API：列出任务、创建任务，并提供首次启动示例。 */

import { NextResponse } from "next/server";
import { ensureSeedTask } from "@/lib/seed";
import { listTasks, saveTask } from "@/lib/store";
import { parseTaskDraft, taskFromDraft } from "@/lib/validation";

export async function GET() {
  await ensureSeedTask();
  return NextResponse.json({ tasks: await listTasks() });
}

export async function POST(request: Request) {
  try {
    const draft = parseTaskDraft(await request.json());
    const task = await saveTask(taskFromDraft(draft));
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建任务失败" },
      { status: 400 },
    );
  }
}
