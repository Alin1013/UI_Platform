/** Next 配置：当前平台保持单进程部署，便于全局并发上限保持准确。 */
const nextConfig = {
  // Playwright 和 Midscene 都包含原生/Node 侧资源，交给 Node require 可避免 Next 打包破坏运行时。
  serverExternalPackages: ["playwright", "@midscene/web"],
  outputFileTracingIncludes: {
    "/api/executions/[id]/artifacts/[name]": ["./reports/**/*"],
  },
};

export default nextConfig;
