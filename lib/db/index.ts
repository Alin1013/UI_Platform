/**
 * SQLite 数据库连接。
 * 使用 WAL 模式提升并发读性能；外键约束显式开启保证数据一致性。
 */

import path from "node:path";
import { mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const dbFile = path.join(process.cwd(), "data", "platform.db");

// SQLite 不会自动创建父目录；首次运行或 data/ 被清理后必须手动保证存在。
mkdirSync(path.dirname(dbFile), { recursive: true });

// better-sqlite3 是同步驱动；drizzle 将其包装为 Promise API，调用方不需要感知差异。
const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// 模块首次加载时确保表存在；单进程 Next.js 只会执行一次，不引入额外迁移工具依赖。
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT 'web',
    runner TEXT,
    runtime TEXT,
    description TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    headless INTEGER NOT NULL DEFAULT 1,
    steps TEXT NOT NULL,
    environment_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    runner TEXT,
    browser TEXT,
    status TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    attempts INTEGER,
    current_step INTEGER,
    total_steps INTEGER NOT NULL,
    logs TEXT NOT NULL DEFAULT '[]',
    report_url TEXT,
    trace_path TEXT,
    healing TEXT,
    error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
  CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
  CREATE INDEX IF NOT EXISTS idx_executions_queued_at ON executions(queued_at);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
