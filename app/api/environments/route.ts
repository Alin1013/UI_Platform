/** 环境集合 API：列表和创建。 */

import { NextResponse } from "next/server";
import { listEnvironments, newId, saveEnvironment } from "@/lib/store";
import { parseEnvironmentDraft } from "@/lib/validation";

export async function GET() {
  return NextResponse.json({ environments: await listEnvironments() });
}

export async function POST(request: Request) {
  try {
    const draft = parseEnvironmentDraft(await request.json());
    const now = new Date().toISOString();
    const environment = {
      ...draft,
      id: newId(),
      createdAt: now,
      updatedAt: now,
    };
    await saveEnvironment(environment);
    return NextResponse.json({ environment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建环境失败" },
      { status: 400 },
    );
  }
}
