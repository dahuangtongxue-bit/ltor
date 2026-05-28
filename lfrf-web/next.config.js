/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // 这些库只在浏览器端用（通过动态 import）。
    // 防止 webpack 在服务端打包时因 node 内置模块缺失而报错。
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        canvas: false,
      };
    }
    return config;
  },
};
module.exports = nextConfig;
