# UI 自动化测试平台 MVP

这是技术方案的第一版可运行实现，聚焦单机 Web UI 自动化：Next.js 提供管理界面，进程内调度器限制并发，Playwright 执行任务并生成截图报告。

## 快速启动

```bash
npm install
npx playwright install chromium
npm run build
npm run start
```

打开 `http://localhost:3000` 后，平台会自动创建一个内置登录示例。进入“任务管理”点击“运行”，即可验证任务提交、并发调度、步骤日志和截图产物。

“自然语言测试用例”面板支持常见中文指令：打开 URL、输入、点击、按键、等待和断言文本。系统会先解析为可编辑的 Playwright 步骤，再保存用例并立即执行。

登录字段支持紧凑写法，例如 `账号输入 demo@example.com`、`租户输入 tenant-1` 和 `密码输入 secret`。平台会将账号、租户、密码等常见字段解析为 label、placeholder 或 aria-label 定位器。

## 当前后端能力

- 任务 CRUD：`/api/tasks`
- 自然语言生成并执行：`POST /api/tasks/from-script`
- 任务执行：`POST /api/tasks/:id/run`
- 执行查询：`/api/executions`、`/api/executions/:id`
- 截图产物：`/api/executions/:id/artifacts/:name`
- 健康检查：`/api/health`

## 配置

`UI_PLATFORM_MAX_CONCURRENCY` 控制并发数，取值范围 1 到 10，默认 5。`UI_PLATFORM_BASE_URL` 用于把任务中的相对 URL 解析为本机演示页或指定环境。

## 当前边界

当前版本使用 JSON 文件保存任务和执行记录，适合验证和小规模使用；多实例部署前需要替换为数据库。桌面端尚未接入，执行器已按适配层组织，后续可以在不改变任务和报告模型的情况下增加 Midscene、flowproof 或其他 runner。
