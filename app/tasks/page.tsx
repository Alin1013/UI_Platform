/** 任务管理一级入口：展示概况和二级页面入口，创建与列表拥有独立空间。 */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListChecks, Plus, Workflow } from "lucide-react";
import { loadTasks, loadWorkflows } from "@/lib/client";
import styles from "./tasks.module.css";

const entries = [
  {
    href: "/tasks/list",
    title: "用例列表",
    text: "查找和维护用例，查看最近结果，发起运行或重试。",
    icon: ListChecks,
    action: "查看用例",
  },
  {
    href: "/tasks/new",
    title: "新建用例",
    text: "从结构化步骤、规则脚本或 AI 生成开始创建自动化用例。",
    icon: Plus,
    action: "开始创建",
  },
  {
    href: "/tasks/workflows",
    title: "组合管理",
    text: "将多个用例按顺序串联，维护组合并统一执行。",
    icon: Workflow,
    action: "管理组合",
  },
];

/** 概况只读取定义数量；运行结果与操作留在列表和组合页。 */
export default function TasksPage() {
  const [counts, setCounts] = useState<{
    tasks: number;
    workflows: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([loadTasks(), loadWorkflows()])
      .then(([tasks, workflows]) => {
        if (active)
          setCounts({
            tasks: tasks.tasks.length,
            workflows: workflows.workflows.length,
          });
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : "概况加载失败");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>自动化工作空间</span>
          <h1>任务管理</h1>
          <p>从创建到执行，在各自的页面中专注完成每一步。</p>
        </div>
      </div>
      <section className={styles.overview} aria-label="任务概况">
        <div>
          <span className={styles.eyebrow}>用例资产</span>
          <h2>管理你的自动化流程</h2>
          <p>维护可复现的用例，将独立步骤组合成完整业务流程。</p>
        </div>
        <div className={styles.counts}>
          <div>
            <strong>{counts?.tasks ?? "—"}</strong>
            <span>个用例</span>
          </div>
          <div>
            <strong>{counts?.workflows ?? "—"}</strong>
            <span>个组合</span>
          </div>
        </div>
      </section>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.cards}>
        {entries.map(({ href, title, text, icon: Icon, action }) => (
          <Link key={href} href={href} className={styles.card}>
            <span className={styles.cardIcon}>
              <Icon size={22} aria-hidden />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
            <span className={styles.cardAction}>
              {action}
              <ArrowRight size={16} aria-hidden />
            </span>
          </Link>
        ))}
      </div>
      <div className={styles.note}>
        <strong>建议的工作顺序</strong>
        <p>
          新建用例 → 在用例列表中检查并运行 →
          按业务流程编排组合。执行进度和结果可在执行监控中查看。
        </p>
      </div>
    </>
  );
}
