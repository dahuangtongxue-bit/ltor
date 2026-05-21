import './globals.css';

export const metadata = {
  title: '左脚踩右脚 · 两个 AI 讨论博弈',
  description: '两个 AI 互相挑刺，你做裁判，得到更靠谱的答案',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
