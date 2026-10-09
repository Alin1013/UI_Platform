/** 执行产物 API：只允许读取 PNG 截图，防止路径穿越访问报告目录以外文件。 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { artifactDir } from "@/lib/executor";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await context.params;
  if (!id || !name || !/^[\w-]+\.png$/.test(name)) {
    return NextResponse.json({ error: "产物名称无效" }, { status: 400 });
  }

  try {
    const file = await readFile(path.join(artifactDir(id), name));
    return new NextResponse(new Uint8Array(file), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "截图不存在" }, { status: 404 });
  }
}
