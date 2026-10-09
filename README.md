# UI 自动化测试平台 MVP

这是技术方案的可运行实现，聚焦单机 Web UI 自动化：Next.js 提供管理界面，进程内调度器限制并发，Playwright 执行确定性步骤，Midscene 执行 AI 语义步骤，Runner Runtime 统一产出截图、trace 和报告。

## 快速启动

```bash
npm install
npx playwright install chromium
npm run build
npm run start
```

打开 `http://localhost:3000` 后，平台会自动创建一个内置登录示例。进入“任务管理”点击“运行”，即可验证任务提交、并发调度、步骤日志和截图产物。

“自然语言测试用例”面板支持常见中文指令：打开 URL、输入、点击、按键、等待和断言文本。系统会先解析为可编辑的 Playwright 步骤，再保存用例并立即执行。

任务可以选择两个执行引擎：

- `Playwright`：适合选择器稳定的核心链路，支持 Chromium、Firefox 和 WebKit。
- `Midscene`：适合语义定位和业务断言，支持 `aiAct`、`aiAssert`、`aiQuery`、`aiWaitFor`，并生成 HTML 报告。

登录字段支持紧凑写法，例如 `账号输入 demo@example.com`、`租户输入 tenant-1` 和 `密码输入 secret`。平台会将账号、租户、密码等常见字段解析为 label、placeholder 或 aria-label 定位器。`点击登录按钮` 会优先定位页面的 submit 按钮，避免标题或页签误命中。

## 当前后端能力

核心结构分为四层：

```text
UI / API
  └─ validation + natural-language + store
      └─ queue
          └─ executor facade
              ├─ Runner Runtime：浏览器、trace、截图、取消、日志
              ├─ Playwright Runner：确定性定位和断言
              └─ Midscene Runner：AI 操作、断言、提取、等待
```

- 任务 CRUD：`/api/tasks`
- 自然语言生成并执行：`POST /api/tasks/from-script`
- 任务执行：`POST /api/tasks/:id/run`
- 执行查询：`/api/executions`、`/api/executions/:id`
- 截图产物：`/api/executions/:id/artifacts/:name`
- 健康检查：`/api/health`

## 配置

`UI_PLATFORM_MAX_CONCURRENCY` 控制并发数，取值范围 1 到 10，默认 5。`UI_PLATFORM_BASE_URL` 用于把任务中的相对 URL 解析为本机演示页或指定环境。

Midscene 需要配置：

```env
MIDSCENE_MODEL_BASE_URL=
MIDSCENE_MODEL_API_KEY=
MIDSCENE_MODEL_NAME=
MIDSCENE_MODEL_FAMILY=
```

未配置时，`runner=midscene` 的任务会快速失败并列出缺失变量；Playwright 任务不受影响。

任务级 `runtime` 支持 `browser`（`chromium`、`firefox`、`webkit`）、`retries`（0-3）和 `trace`。开启 trace 后，执行详情页可以下载 `trace.zip`。

## 当前边界

当前版本使用 JSON 文件保存任务和执行记录，适合验证和小规模使用；多实例部署前需要替换为数据库。桌面端和 flowproof 尚未接入，执行器已拆成 Runner Runtime 和 Runner 适配器，后续可以在不改变任务和报告模型的情况下扩展更多 Runner。
