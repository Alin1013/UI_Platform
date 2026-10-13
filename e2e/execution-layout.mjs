/** 执行详情布局回归检查：在真实页面检测长日志裁切、截图溢出和窄屏布局，不触发执行或重试。 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const targetUrl = process.argv[2] ?? "http://localhost:3000/executions";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // 独立开发端口可复用运行中服务的只读执行数据，避免复制数据库或触发新执行。
  if (process.env.EXECUTION_API_ORIGIN) {
    await page.route("**/api/**", async (route) => {
      assert.equal(route.request().method(), "GET", "布局检查只允许读取数据");
      const url = new URL(route.request().url());
      const response = await page.request.get(`${process.env.EXECUTION_API_ORIGIN}${url.pathname}${url.search}`);
      await route.fulfill({ response });
    });
  }
  await page.goto(targetUrl);
  await page.getByRole("heading", { name: "执行日志", exact: true }).waitFor();
  for (const width of [1244, 901, 390, 1440]) {
    await page.setViewportSize({ width, height: 801 });
    // 懒加载截图必须真正加载成功后再测量，避免空图片的边界产生假通过。
    for (const screenshot of await page.locator(".screenshot").all()) {
      await screenshot.scrollIntoViewIfNeeded();
      await screenshot.evaluate((img) => new Promise((resolve, reject) => {
        if (img.complete) {
          img.naturalWidth > 0 ? resolve() : reject(new Error("截图加载失败"));
          return;
        }
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", () => reject(new Error("截图加载失败")), { once: true });
      }));
    }
    // 检查内容的实际边界，而非仅检查滚动条；overflow:hidden 会掩盖日志被裁切的事实。
    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".log-item")];
      const clippedRows = rows.filter((row) => {
        const body = row.closest(".panel-body").getBoundingClientRect();
        return row.scrollWidth > row.clientWidth + 1 || [...row.children].some((child) => {
          const bounds = child.getBoundingClientRect();
          return child.scrollWidth > child.clientWidth + 1 ||
            child.scrollHeight > child.clientHeight + 1 || bounds.right > body.right + 1;
        });
      });
      const clippedImages = [...document.querySelectorAll(".screenshot")].filter((img) => {
        const bounds = img.getBoundingClientRect();
        const body = img.closest(".panel-body").getBoundingClientRect();
        return bounds.right > body.right + 1 || bounds.right > window.innerWidth;
      });
      return {
        viewport: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        rows: rows.length,
        clippedRows: clippedRows.length,
        clippedImages: clippedImages.length,
      };
    });
    assert.ok(result.rows > 0, "需要包含步骤日志的执行记录");
    assert.ok(result.pageWidth <= result.viewport, `页面横向溢出：${JSON.stringify(result)}`);
    assert.equal(result.clippedRows, 0, `执行日志被裁切：${JSON.stringify(result)}`);
    assert.equal(result.clippedImages, 0, `步骤截图超出面板：${JSON.stringify(result)}`);
    console.log(`${width}px：日志和截图完整显示`);
  }
} finally {
  await browser.close();
}
