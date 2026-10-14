/** 顶部主导航：根据当前 pathname 高亮所在业务模块，并提供当前页语义。 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  FileText,
  Globe,
  LayoutDashboard,
  MonitorPlay,
} from "lucide-react";

const navItems = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/tasks", label: "任务管理", icon: ClipboardList },
  { href: "/environments", label: "环境管理", icon: Globe },
  { href: "/executions", label: "执行监控", icon: MonitorPlay },
  { href: "/reports", label: "报告", icon: FileText },
];

/** 根路径只匹配仪表盘，其余导航同时覆盖各自的详情和编辑子页面。 */
function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** 路由切换时更新高亮，保持顶部主导航与任务区域的二级导航同步。 */
export function MainNavigation() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="main-nav" aria-label="主导航">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = isNavItemActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
