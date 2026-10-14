/** 任务区域布局：持久化二级导航，用路径和面包屑表达独立工作页面。 */
"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  LayoutGrid,
  ListChecks,
  Plus,
  Workflow,
} from "lucide-react";
import styles from "./tasks.module.css";

const navigation = [
  { href: "/tasks", label: "管理概览", icon: LayoutGrid },
  { href: "/tasks/list", label: "用例列表", icon: ListChecks },
  { href: "/tasks/new", label: "新建用例", icon: Plus },
  { href: "/tasks/workflows", label: "组合管理", icon: Workflow },
  { href: "/tasks/test-workflows", label: "测试工作流", icon: Workflow },
];

/** 编辑页归属列表；深链接也能通过第三层面包屑返回父页面。 */
export default function TasksLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pathReady, setPathReady] = useState(false);
  // 静态页面首屏的服务端路径可能与客户端路由不同，等挂载后再绘制路径高亮。
  useEffect(() => setPathReady(true), []);
  const editing = pathname.endsWith("/edit");
  const workflowPage = pathname.startsWith("/tasks/workflows");
  const testWorkflowPage = pathname.startsWith("/tasks/test-workflows");
  // 两种流程共享画布布局，但通过各自路由保持列表和编辑语义清晰。
  const current = testWorkflowPage
    ? editing
      ? "编辑工作流"
      : pathname.endsWith("/new")
        ? "新建工作流"
        : "测试工作流"
    : workflowPage
    ? editing
      ? "编辑组合"
      : pathname.endsWith("/new")
        ? "新建组合"
        : "组合管理"
    : navigation.find((item) => item.href === pathname)?.label ?? "编辑用例";
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/tasks" className={styles.sectionTitle}>
          任务管理
        </Link>
        <p>用例与流程</p>
        <nav className={styles.navigation} aria-label="任务管理二级导航">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = pathReady && (
              pathname === href ||
              (editing && href === "/tasks/list") ||
              (workflowPage && href === "/tasks/workflows") ||
              (testWorkflowPage && href === "/tasks/test-workflows"));
            return (
              <Link
                key={href}
                href={href}
                className={active ? styles.active : undefined}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className={styles.content}>
        <nav className={styles.breadcrumb} aria-label="面包屑">
          {pathname === "/tasks" ? (
            <span aria-current="page">任务管理</span>
          ) : (
            <>
              <Link href="/tasks">任务管理</Link>
              <ChevronRight size={14} aria-hidden />
              {(workflowPage && pathname !== "/tasks/workflows") || testWorkflowPage ? (
                <>
                  <Link href={testWorkflowPage ? "/tasks/test-workflows" : "/tasks/workflows"}>
                    {testWorkflowPage ? "测试工作流" : "组合管理"}
                  </Link>
                  <ChevronRight size={14} aria-hidden />
                </>
              ) : null}
              {editing && !workflowPage ? (
                <>
                  <Link href="/tasks/list">用例列表</Link>
                  <ChevronRight size={14} aria-hidden />
                </>
              ) : null}
              <span aria-current="page">{current}</span>
            </>
          )}
        </nav>
        {children}
      </div>
    </div>
  );
}
