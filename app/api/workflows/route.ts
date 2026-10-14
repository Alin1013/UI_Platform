/** 流程组合集合 API：保存用例引用顺序，运行时再校验用例是否仍存在。 */

import { NextResponse } from "next/server";
import { getTask, getWorkflow, listWorkflows, saveWorkflow } from "@/lib/store";
import { parseWorkflowDraft, workflowFromDraft } from "@/lib/validation";

export async function GET() {
  return NextResponse.json({ workflows: await listWorkflows() });
}

export async function POST(request: Request) {
  try {
    const draft = parseWorkflowDraft(await request.json());
    if (draft.kind === "test-workflow") {
      // 工作流只可引用已有单用例或普通组合，禁止嵌套测试工作流形成不透明执行树。
      const references = await Promise.all(draft.nodes!.map(async (node) => {
        if (node.type === "task") return Boolean(await getTask(node.taskId));
        const workflow = await getWorkflow(node.workflowId);
        return Boolean(workflow && workflow.kind !== "test-workflow");
      }));
      if (references.some((exists) => !exists)) throw new Error("工作流引用的用例或组合不存在");
    }
    const workflow = await saveWorkflow(workflowFromDraft(draft));
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建组合失败" },
      { status: 400 },
    );
  }
}
