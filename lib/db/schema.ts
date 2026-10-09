/**
 * SQLite 表结构定义（drizzle-orm）。
 * 复杂嵌套字段（steps / logs / healing / runtime / labels）以 JSON text 列存储；
 * 迁移 PostgreSQL 时只需把 text 列改为 jsonb，API 层不变。
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** 测试环境表；管理页配置，执行时按任务关联的环境注入 URL 和凭证。 */
export const environments = sqliteTable("environments", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  baseUrl: text("base_url").notNull(),
  username: text("username"),
  password: text("password"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 自动化任务表；结构化步骤整体存 JSON，避免拆行导致迁移复杂化。 */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  target: text("target").notNull().default("web"),
  runner: text("runner"),
  runtime: text("runtime", { mode: "json" }),
  description: text("description"),
  labels: text("labels", { mode: "json" }).notNull().default([]),
  headless: integer("headless", { mode: "boolean" }).notNull().default(true),
  steps: text("steps", { mode: "json" }).notNull().default([]),
  environmentId: text("environment_id"),
  aiContexts: text("ai_contexts", { mode: "json" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 执行记录表；logs / healing 同样以 JSON 列存储，保留完整历史。 */
export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  runner: text("runner"),
  browser: text("browser"),
  status: text("status").notNull(),
  queuedAt: text("queued_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  durationMs: integer("duration_ms"),
  attempts: integer("attempts"),
  currentStep: integer("current_step"),
  totalSteps: integer("total_steps").notNull().default(0),
  logs: text("logs", { mode: "json" }).notNull().default([]),
  reportUrl: text("report_url"),
  tracePath: text("trace_path"),
  healing: text("healing", { mode: "json" }),
  error: text("error"),
});
