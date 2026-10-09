/** 全局布局：承载导航和平台主视觉。 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MonitorPlay,
  Globe,
} from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "UI 自动化测试平台",
  description: "自然语言定义、有界并发执行和结果报告的轻量控制面。",
};

const navItems = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/tasks", label: "任务管理", icon: ClipboardList },
  { href: "/environments", label: "环境管理", icon: Globe },
  { href: "/executions", label: "执行监控", icon: MonitorPlay },
  { href: "/reports", label: "报告", icon: FileText },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-icon">
                <MonitorPlay size={18} aria-hidden />
              </span>
              UI 自动化平台
            </Link>
            <nav className="main-nav" aria-label="主导航">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href}>
                  <Icon size={16} aria-hidden />
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
