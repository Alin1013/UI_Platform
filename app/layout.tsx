/** 全局布局：承载导航和平台主视觉。 */

import type { Metadata } from "next";
import Link from "next/link";
import { MonitorPlay } from "lucide-react";
import { MainNavigation } from "@/components/MainNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "UI 自动化测试平台",
  description: "自然语言定义、有界并发执行和结果报告的轻量控制面。",
};

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
            <MainNavigation />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
