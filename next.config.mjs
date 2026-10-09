/** Next 配置：当前平台保持单进程部署，便于全局并发上限保持准确。 */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/executions/[id]/artifacts/[name]": ["./reports/**/*"],
  },
};

export default nextConfig;
