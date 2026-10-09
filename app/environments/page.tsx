/** 环境管理页：配置 dev / test / prod 被测系统地址和账号凭证。 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { TestEnvironment } from "@/lib/types";
import {
  createEnvironment,
  loadEnvironments,
  removeEnvironment,
  updateEnvironment,
} from "@/lib/client";

interface EnvironmentDraft {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
}

const emptyDraft: EnvironmentDraft = {
  name: "",
  baseUrl: "",
  username: "",
  password: "",
};

export default function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<TestEnvironment[]>([]);
  const [draft, setDraft] = useState<EnvironmentDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const payload = await loadEnvironments();
    setEnvironments(payload.environments);
  }, []);

  useEffect(() => {
    refresh().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "加载环境失败"),
    );
  }, [refresh]);

  function startEdit(environment: TestEnvironment) {
    setEditingId(environment.id);
    setDraft({
      name: environment.name,
      baseUrl: environment.baseUrl,
      username: environment.username ?? "",
      password: environment.password ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (editingId) {
        await updateEnvironment(editingId, draft);
        setMessage("环境已更新");
      } else {
        await createEnvironment(draft);
        setMessage("环境已创建");
      }
      cancelEdit();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(environment: TestEnvironment) {
    if (!window.confirm(`删除环境「${environment.name}」？已关联的任务执行时会回退到全局 URL。`)) return;
    try {
      await removeEnvironment(environment.id);
      await refresh();
      setMessage("环境已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>环境管理</h1>
          <p>配置 dev / test / prod 的被测系统地址和账号，任务执行时按环境注入。</p>
        </div>
      </div>

      <div className="split">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">{editingId ? "编辑环境" : "新建环境"}</h2>
          </div>
          <form className="panel-body" onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="env-name">环境名称</label>
                <input
                  id="env-name"
                  value={draft.name}
                  placeholder="dev"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="env-url">基础 URL</label>
                <input
                  id="env-url"
                  type="url"
                  value={draft.baseUrl}
                  placeholder="https://test.example.com"
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="env-username">登录账号</label>
                <input
                  id="env-username"
                  value={draft.username}
                  placeholder="可选"
                  onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="env-password">登录密码</label>
                <input
                  id="env-password"
                  type="password"
                  value={draft.password}
                  placeholder="可选"
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                />
              </div>
            </div>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              任务步骤 fill 值中写 {"{username}"} 和 {"{password}"}，执行时自动替换为环境凭证。
            </p>
            <p className="error-text">{message}</p>
            <div className="toolbar" style={{ justifyContent: "flex-start" }}>
              <button className="button primary" disabled={busy}>
                {editingId ? "保存修改" : "创建环境"}
              </button>
              {editingId ? (
                <button type="button" className="button" onClick={cancelEdit}>
                  取消
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">环境列表</h2>
            <span className="muted">{environments.length} 个</span>
          </div>
          {environments.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>URL</th>
                  <th>账号</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {environments.map((env) => (
                  <tr key={env.id}>
                    <td><strong>{env.name}</strong></td>
                    <td className="muted" style={{ wordBreak: "break-all" }}>{env.baseUrl}</td>
                    <td>{env.username || "-"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="button small" onClick={() => startEdit(env)}>
                          <Pencil size={14} aria-hidden />
                        </button>
                        <button className="button small danger" onClick={() => void handleDelete(env)}>
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">暂无环境；先创建 dev 环境配置被测地址。</div>
          )}
        </section>
      </div>
    </>
  );
}
