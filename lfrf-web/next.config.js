/** @type {import('next').NextConfig} */

// 关键：把环境变量通过 env 字段传给 Next.js
// Next.js 会在 build 时把这些值编译进 JS bundle
// 这样运行时（无论是 Cloudflare Edge、Vercel Edge 还是 Node.js）都能读到
// 注意：API key 等敏感值不会暴露给浏览器，因为它们只在 server-side 代码里用
const nextConfig = {
  env: {
    ACCESS_PASSWORD: process.env.ACCESS_PASSWORD,
    DAILY_LIMIT_PER_IP: process.env.DAILY_LIMIT_PER_IP,
    PROVIDER_A_BASE_URL: process.env.PROVIDER_A_BASE_URL,
    PROVIDER_A_API_KEY: process.env.PROVIDER_A_API_KEY,
    PROVIDER_A_MODEL: process.env.PROVIDER_A_MODEL,
    PROVIDER_A_DISPLAY_NAME: process.env.PROVIDER_A_DISPLAY_NAME,
    PROVIDER_A_DISABLE_THINKING: process.env.PROVIDER_A_DISABLE_THINKING,
    PROVIDER_B_BASE_URL: process.env.PROVIDER_B_BASE_URL,
    PROVIDER_B_API_KEY: process.env.PROVIDER_B_API_KEY,
    PROVIDER_B_MODEL: process.env.PROVIDER_B_MODEL,
    PROVIDER_B_DISPLAY_NAME: process.env.PROVIDER_B_DISPLAY_NAME,
    PROVIDER_B_DISABLE_THINKING: process.env.PROVIDER_B_DISABLE_THINKING,
  },
};

module.exports = nextConfig;
