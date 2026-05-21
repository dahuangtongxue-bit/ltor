# 左脚踩右脚 · 部署指南

让 3-5 个朋友能真实测试你的产品。预计 **30 分钟** 完成部署。

---

## 架构

```
朋友的浏览器
  ↓
Vercel 上的网站 (Next.js)
  ↓
后端代理 (/api/chat，密码校验 + 限流)
  ↓ 根据 role 路由
  ├─→ Provider A：主答者 / 综合者 / 目标提取器
  └─→ Provider B：审查者
```

**两个 provider 都用 OpenAI 兼容格式**，你可以自由组合：
- DeepSeek + Kimi
- GPT-4 + Claude（通过 OpenRouter 转发）
- DeepSeek + 通义千问
- 国内组合，海外组合，任意搭配

---

## 准备工作（5 分钟）

需要先注册账号：

1. **GitHub** — https://github.com/signup
2. **Vercel** — https://vercel.com/signup（用 GitHub 登录）
3. **两家 LLM 提供商的 API key**（推荐组合见下）

### 推荐的 Provider 组合（国内）

| 角色 | 推荐 | 备选 |
|---|---|---|
| Provider A（主答） | DeepSeek（deepseek-chat 或 deepseek-reasoner） | 智谱 GLM-4-Plus |
| Provider B（审查） | Kimi（moonshot-v1-32k） | 通义 qwen-plus |

理由：DeepSeek 性价比极高、推理能力强适合做主答；Kimi 长上下文 + 风格不同于 DeepSeek，跨家族对抗效果好。

### 推荐的 Provider 组合（海外/全球）

| 角色 | 推荐 |
|---|---|
| Provider A | OpenAI gpt-4o（或通过 OpenRouter 用 Claude） |
| Provider B | OpenRouter → claude-3.5-sonnet（或 google/gemini） |

通过 OpenRouter（https://openrouter.ai）可以用 OpenAI 兼容格式调任意模型，包括 Claude / Gemini / Llama，单一 key 走天下。

---

## 部署步骤

### 第 1 步：推到 GitHub

```bash
cd lfrf-web
git init
git add .
git commit -m "initial commit"

# 在 GitHub 上创建一个 Private 仓库，然后：
git remote add origin https://github.com/你的用户名/lfrf-web.git
git branch -M main
git push -u origin main
```

### 第 2 步：在 Vercel 部署

1. 打开 https://vercel.com/new
2. 选择刚才的 GitHub 仓库 → Import
3. 在 **Environment Variables** 区域填以下变量（详细说明见 `.env.example`）：

```
ACCESS_PASSWORD=朋友登录用的密码
DAILY_LIMIT_PER_IP=20

PROVIDER_A_BASE_URL=https://api.deepseek.com/v1
PROVIDER_A_API_KEY=sk-xxx
PROVIDER_A_MODEL=deepseek-chat
PROVIDER_A_DISPLAY_NAME=DeepSeek

PROVIDER_B_BASE_URL=https://api.moonshot.cn/v1
PROVIDER_B_API_KEY=sk-xxx
PROVIDER_B_MODEL=moonshot-v1-32k
PROVIDER_B_DISPLAY_NAME=Kimi
```

4. 点 **Deploy**

等 1-2 分钟，部署成功后会给你一个 `https://xxx.vercel.app` 的网址。

### 第 3 步：发给朋友

把**网址 + 密码**一起发给朋友。打开网址输密码即可使用。密码会保存在浏览器，下次自动登录。

---

## 给朋友的微信文案（建议复制发送）

```
帮我测一下我做的产品「左脚踩右脚」🦶

地址：https://你的-vercel-地址
密码：你的密码

产品做什么：你提一个值得推敲的问题（比如复杂决策、技术选型、深度分析），
两个不同的 AI 会自动互相挑刺打磨答案。你可以随时作为裁判介入，引导讨论方向。

测试时希望你关注：
1. 提炼出的"第一性目标"是否准确
2. 审查者 B 找的问题是否真有价值，还是吹毛求疵
3. 修订后的答案是否真的变好了
4. 整个流程让你觉得是值得 vs 浪费时间

每人每天 20 次调用额度（一次完整 review 约 4-6 次调用）。
反馈微信直接发我。
```

---

## 成本估算

以推荐的 DeepSeek + Kimi 组合为例：
- 一次完整 review（主答 + 审查 + 修订 + 综合）约 **¥0.05-0.20**
- 5 个朋友 × 各试 5 轮 ≈ ¥2-5
- 比 Anthropic Opus 便宜 20-50 倍

如果用 OpenAI gpt-4o + Claude（通过 OpenRouter）：
- 一次完整 review 约 $0.20-0.50
- 5 朋友 × 5 轮 ≈ $10-20

**建议**：在每家 provider 的后台都设个月度上限，作为兜底。

---

## 想换 Provider？

只需改 Vercel 的 Environment Variables：
- 改 `PROVIDER_X_BASE_URL` / `API_KEY` / `MODEL` / `DISPLAY_NAME`
- 在 Vercel project → Deployments 里点最新部署的 ... → Redeploy

不需要改任何代码。前端会自动从后端拉新的 `DISPLAY_NAME` 显示在界面上。

---

## 本地开发

```bash
cd lfrf-web
npm install
cp .env.example .env.local
# 编辑 .env.local 填入两套 provider 配置
npm run dev
```

打开 http://localhost:3000

---

## 文件结构

```
lfrf-web/
├── app/
│   ├── api/chat/route.js       ← 后端代理（密码 + 限流 + 两 provider 路由）
│   ├── layout.js
│   ├── page.js
│   └── globals.css
├── components/
│   └── LeftFootRightFoot.jsx   ← 主组件
├── package.json
├── .env.example                ← 环境变量样板
└── README.md
```

---

## 测试完想关闭

去 Vercel project settings → 最下面 Delete Project。两家 LLM 的 API key 也建议去对应控制台 revoke。
