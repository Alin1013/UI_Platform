/** 已有用例转 Midscene API：读取任务、生成可审阅草稿，确认后再保存并执行。 */

import { NextResponse } from "next/server";
import { generateMidsceneCaseDraft } from "@/lib/generator";
import { enqueueExecution } from "@/lib/queue";
import { getTask, saveTask } from "@/lib/store";
import { parseTaskDraft, taskFromDraft } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const taskId = String(body.taskId ?? "").trim();
    if (!taskId) throw new Error("必须选择已有测试用例");

    const source = await getTask(taskId);
    if (!source) {
      return NextResponse.json({ error: "源测试用例不存在，请刷新后重试" }, { status: 404 });
    }

    // 确认阶段允许回传预览草稿，避免用户确认后再次调用模型造成步骤漂移。
    const rawDraft = body.draft;
    const draft = rawDraft
      ? parseTaskDraft({
          ...(rawDraft as Record<string, unknown>),
          target: "web",
          runner: "midscene",
        })
      : parseTaskDraft({
          ...(await generateMidsceneCaseDraft(source)),
          target: "web",
          runner: "midscene",
          // 新任务不能复用源用例的 cache.id，否则两个任务会共享 Midscene 规划缓存。
          runtime: source.runtime
            ? {
                ...source.runtime,
                cache: source.runtime.cache
                  ? { ...source.runtime.cache, id: undefined }
                  : undefined,
              }
            : { browser: "chromium", retries: 0, trace: false },
          environmentId: source.environmentId,
          aiContexts: source.aiContexts,
        });

    if (body.save !== true) return NextResponse.json({ draft });

    const task = await saveTask(taskFromDraft(draft));
    const execution = body.execute === false ? undefined : await enqueueExecution(task.id);
    return NextResponse.json({ task, execution }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Midscene 用例生成失败" },
      { status: 400 },
    );
  }
}
