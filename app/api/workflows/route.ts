/** 流程组合集合 API：保存用例引用顺序，运行时再校验用例是否仍存在。 */

import { NextResponse } from "next/server";
import { listWorkflows, saveWorkflow } from "@/lib/store";
import { parseWorkflowDraft, workflowFromDraft } from "@/lib/validation";

export async function GET() {
  return NextResponse.json({ workflows: await listWorkflows() });
}

export async function POST(request: Request) {
  try {
    const draft = parseWorkflowDraft(await request.json());
    const workflow = await saveWorkflow(workflowFromDraft(draft));
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建组合失败" },
      { status: 400 },
    );
  }
}
