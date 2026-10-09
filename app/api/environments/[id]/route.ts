/** 单个环境 API：查询、更新、删除。 */

import { NextResponse } from "next/server";
import {
  deleteEnvironment,
  getEnvironment,
  saveEnvironment,
} from "@/lib/store";
import { parseEnvironmentDraft } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  const { id } = await context.params;
  const environment = await getEnvironment(id);
  if (!environment) {
    return NextResponse.json({ error: "环境不存在" }, { status: 404 });
  }
  return NextResponse.json({ environment });
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const existing = await getEnvironment(id);
    if (!existing) {
      return NextResponse.json({ error: "环境不存在" }, { status: 404 });
    }
    const draft = parseEnvironmentDraft(await request.json());
    const environment = { ...draft, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    await saveEnvironment(environment);
    return NextResponse.json({ environment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新环境失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  const { id } = await context.params;
  const ok = await deleteEnvironment(id);
  if (!ok) {
    return NextResponse.json({ error: "环境不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
