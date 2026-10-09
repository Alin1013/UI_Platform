/** 自然语言用例 API：一次请求完成“解析 -> 保存测试用例 -> 入队执行”。 */

import { NextResponse } from "next/server";
import { parseNaturalLanguageScript } from "@/lib/natural-language";
import { enqueueExecution } from "@/lib/queue";
import { saveTask } from "@/lib/store";
import { taskFromDraft } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const script = String(body.script ?? "").trim();
    if (!name) throw new Error("用例名称不能为空");
    if (!script) throw new Error("自然语言脚本不能为空");

    const result = parseNaturalLanguageScript(script);
    if (result.errors.length > 0) {
      return NextResponse.json({ error: result.errors.join("\n") }, { status: 400 });
    }

    const task = await saveTask(
      taskFromDraft({
        name,
        target: "web",
        description: "由自然语言脚本生成的测试用例。",
        labels: ["自然语言"],
        headless: body.headless == null ? true : Boolean(body.headless),
        steps: result.steps,
      }),
    );
    const execution = await enqueueExecution(task.id);
    return NextResponse.json({ task, execution }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成用例失败" },
      { status: 400 },
    );
  }
}
