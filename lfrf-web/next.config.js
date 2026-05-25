/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages 兼容性配置
  // 因为我们使用了 Edge Runtime 的 API Routes，不需要特殊配置
  // 但如果 Cloudflare 报错说 "Node.js targeting issue"，可以参考下面注释的配置
  // experimental: { runtime: 'edge' },
};
module.exports = nextConfig;
