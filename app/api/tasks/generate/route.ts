/** AI 用例生成 API：产出并可选保存草稿，但永远不直接入队执行。 */

import { NextResponse } from "next/server";
import { generateTaskDraft } from "@/lib/generator";
import { saveTask } from "@/lib/store";
import { parseTaskDraft, taskFromDraft } from "@/lib/validation";
import type { RunnerId } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const requirement = String(body.requirement ?? "").trim();
    if (requirement.length < 5) {
      throw new Error("需求描述至少 5 个字符");
    }

    const runnerInput = String(body.runner ?? "playwright");
    if (runnerInput !== "playwright" && runnerInput !== "midscene") {
      throw new Error("runner 只支持 playwright 或 midscene");
    }
    const runner = runnerInput as RunnerId;

    // 相对地址在服务端解析一次，避免模型把 /demo/login.html 改成虚构域名。
    const targetUrlInput = String(body.targetUrl ?? "/").trim() || "/";
    const base = process.env.UI_PLATFORM_BASE_URL ?? "http://127.0.0.1:3000";
    const parsedTargetUrl = new URL(targetUrlInput, base);
    if (!/^https?:$/.test(parsedTargetUrl.protocol)) {
      throw new Error("targetUrl 只支持 http 或 https");
    }
    const targetUrl = parsedTargetUrl.toString();

    const generated = await generateTaskDraft({ requirement, targetUrl, runner });
    const rawSteps = Array.isArray(generated.steps) ? generated.steps : [];
    const firstStep = rawSteps[0];
    if (
      !firstStep ||
      typeof firstStep !== "object" ||
      (firstStep as Record<string, unknown>).action !== "goto"
    ) {
      throw new Error("模型生成的用例缺少第一步 goto");
    }

    // 生成的 runner/运行时以请求为准；名称允许调用方覆盖，保证 API 行为可预期。
    const draft = parseTaskDraft({
      ...generated,
      name: String(body.name ?? generated.name ?? "AI 生成用例").trim(),
      target: "web",
      runner,
      runtime: body.runtime ?? {
        browser: "chromium",
        retries: 0,
        trace: false,
      },
      headless: generated.headless ?? true,
    });

    if (body.save === true) {
      const task = await saveTask(taskFromDraft(draft));
      return NextResponse.json({ draft, task }, { status: 201 });
    }

    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 用例生成失败" },
      { status: 400 },
    );
  }
}
