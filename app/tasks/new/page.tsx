/** 独立创建页：按需展开一种创建方式，结构化和 AI 草稿保存后回到列表。 */
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrainCircuit, ListChecks, Sparkles, WandSparkles } from "lucide-react";
import { TaskEditor } from "@/components/TaskEditor";
import { ScriptTaskForm } from "@/components/ScriptTaskForm";
import { AiTaskForm } from "@/components/AiTaskForm";
import { MidsceneCaseForm } from "@/components/MidsceneCaseForm";
import styles from "../tasks.module.css";

const modes = [
  {
    id: "structured",
    title: "结构化步骤",
    text: "逐步定义动作、定位器和断言",
    icon: ListChecks,
  },
  {
    id: "script",
    title: "规则脚本",
    text: "按固定话术编写，生成后立即执行",
    icon: WandSparkles,
  },
  {
    id: "ai",
    title: "AI 生成",
    text: "描述业务需求，预览确认后保存",
    icon: Sparkles,
  },
  {
    id: "midscene",
    title: "Midscene 编排",
    text: "读取已有用例，自动补齐语义步骤和断言",
    icon: BrainCircuit,
  },
] as const;

/** 切换方式会卸载旧表单，有未保存输入时先确认，避免草稿无声丢失。 */
export default function NewTaskPage() {
  const router = useRouter();
  const [mode, setMode] = useState<string>("structured");
  const [dirty, setDirty] = useState(false);
  /** 保留当前选项的输入；只有切换到另一种表单时才丢弃已编辑草稿。 */
  function selectMode(next: string) {
    if (next === mode) return;
    if (dirty && !window.confirm("切换创建方式将放弃当前输入，是否继续？"))
      return;
    setMode(next);
    setDirty(false);
  }
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h1>新建用例</h1>
          <p>选择一种创建方式，专注编写当前用例。</p>
        </div>
        <Link href="/tasks/list" className="button">
          返回列表
        </Link>
      </div>
      <div className={styles.modes} role="group" aria-label="创建方式">
        {modes.map(({ id, title, text, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={styles.mode}
            aria-pressed={mode === id}
            onClick={() => selectMode(id)}
          >
            <strong>
              <Icon size={18} aria-hidden />
              {title}
            </strong>
            <span>{text}</span>
          </button>
        ))}
      </div>
      <div className={styles.editor} onChangeCapture={() => setDirty(true)}>
        {mode === "structured" ? (
          <section className="panel" aria-label="结构化用例">
            <div className="panel-header">
              <h2 className="panel-title">用例定义</h2>
              <span className="muted">保存后可在列表中运行</span>
            </div>
            <TaskEditor
              onSaved={() => router.push("/tasks/list")}
              onCancel={() => router.push("/tasks/list")}
            />
          </section>
        ) : mode === "script" ? (
          <ScriptTaskForm />
        ) : mode === "ai" ? (
          <AiTaskForm onSaved={() => router.push("/tasks/list")} />
        ) : (
          <MidsceneCaseForm />
        )}
      </div>
    </>
  );
}
