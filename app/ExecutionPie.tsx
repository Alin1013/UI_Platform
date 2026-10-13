/** 用例最新状态饼图：服务端生成 SVG，使用文字图例补充颜色和占比信息。 */
import type { summarizeLatestTasks } from "@/lib/dashboard";
import styles from "./dashboard.module.css";

const statuses = [
  { key: "succeeded", label: "通过", color: "var(--success)" },
  { key: "failed", label: "失败", color: "var(--danger)" },
  { key: "interrupted", label: "已中断", color: "#8056b8" },
  { key: "running", label: "执行中", color: "var(--accent)" },
  { key: "queued", label: "排队中", color: "var(--warning)" },
  { key: "notRun", label: "未执行", color: "#a3afbd" },
] as const;

/** 从十二点方向顺时针绘制扇区；整圆由 circle 单独处理，避免 SVG 同点弧线退化。 */
function sectorPath(start: number, end: number) {
  const radius = 94;
  const startAngle = start * 2 * Math.PI - Math.PI / 2;
  const endAngle = end * 2 * Math.PI - Math.PI / 2;
  return `M 100 100 L ${100 + radius * Math.cos(startAngle)} ${100 + radius * Math.sin(startAngle)} A ${radius} ${radius} 0 ${end - start > 0.5 ? 1 : 0} 1 ${100 + radius * Math.cos(endAngle)} ${100 + radius * Math.sin(endAngle)} Z`;
}

/** counts 与任务总数来自统一快照；零状态保留图例，空库不绘制虚假的百分比扇区。 */
export function ExecutionPie({
  summary,
}: {
  summary: ReturnType<typeof summarizeLatestTasks>;
}) {
  let cumulative = 0;
  const slices = statuses.map((status) => {
    const count = summary.counts[status.key];
    const start = cumulative;
    cumulative += summary.taskCount ? count / summary.taskCount : 0;
    return { ...status, count, start, end: cumulative };
  });
  // SVG title 使用单个字符串，避免 SSR 文本分段与浏览器合并文本产生水合差异。
  return (
    <div className={styles.chartBody}>
      <svg
        className={styles.pie}
        viewBox="0 0 200 200"
        role="img"
        aria-label="用例最新执行状态分布"
      >
        <title>用例最新执行状态分布</title>
        <desc>
          {slices.map((slice) => `${slice.label} ${slice.count} 个`).join("，")}
        </desc>
        {summary.taskCount ? (
          slices
            .filter((slice) => slice.count > 0)
            .map((slice) =>
              slice.count === summary.taskCount ? (
                <circle
                  key={slice.key}
                  cx="100"
                  cy="100"
                  r="94"
                  fill={slice.color}
                >
                  <title>{`${slice.label}：${slice.count} 个（100%）`}</title>
                </circle>
              ) : (
                <path
                  key={slice.key}
                  d={sectorPath(slice.start, slice.end)}
                  fill={slice.color}
                  stroke="var(--surface)"
                  strokeWidth="2"
                >
                  <title>
                    {`${slice.label}：${slice.count} 个（${Math.round((slice.count / summary.taskCount) * 1000) / 10}%）`}
                  </title>
                </path>
              ),
            )
        ) : (
          <>
            <circle cx="100" cy="100" r="94" fill="var(--surface-muted)" />
            <text
              x="100"
              y="100"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--muted)"
              fontSize="14"
            >
              暂无用例
            </text>
          </>
        )}
      </svg>
      <p className={styles.chartTotal}>
        共 <strong>{summary.taskCount}</strong> 个用例
      </p>
      <ul className={styles.legend} aria-label="用例状态统计">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span
              className={styles.dot}
              style={{ background: slice.color }}
              aria-hidden
            />
            <span>{slice.label}</span>
            <strong>{slice.count}</strong>
            <span className={styles.percentage}>
              {summary.taskCount
                ? `${Math.round((slice.count / summary.taskCount) * 1000) / 10}%`
                : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
