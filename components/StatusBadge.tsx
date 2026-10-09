/** 执行状态标签：统一颜色语义，避免各页面自行判断。 */

import type { TaskExecution } from "@/lib/types";
import { statusLabel } from "@/lib/client";

export function StatusBadge({ status }: { status: TaskExecution["status"] }) {
  return <span className={`status ${status}`}>{statusLabel(status)}</span>;
}
