// 后端代理：两个 OpenAI 兼容的 API 槽位
// PROVIDER_A: 用于主答者（main）、综合者（synthesizer）、目标提取器（goal）
// PROVIDER_B: 用于审查者（critic）
// OpenAI 兼容格式：DeepSeek / Kimi / 智谱 / 豆包 / 阿里通义 / OpenAI / 月之暗面 都支持

const usageMap = new Map();
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT_PER_IP || '20');

function getIp(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = usageMap.get(ip);
  if (!record || now > record.resetAt) {
    usageMap.set(ip, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    return { ok: true, remaining: DAILY_LIMIT - 1 };
  }
  if (record.count >= DAILY_LIMIT) {
    return { ok: false, remaining: 0, resetAt: record.resetAt };
  }
  record.count += 1;
  return { ok: true, remaining: DAILY_LIMIT - record.count };
}

// 根据 role 选 provider：critic 走 B，其他（main / synthesizer / goal）走 A
function getProviderConfig(role) {
  if (role === 'critic') {
    return {
      baseUrl: process.env.PROVIDER_B_BASE_URL,
      apiKey: process.env.PROVIDER_B_API_KEY,
      model: process.env.PROVIDER_B_MODEL,
      displayName: process.env.PROVIDER_B_DISPLAY_NAME || 'Provider B',
      label: 'B',
    };
  }
  return {
    baseUrl: process.env.PROVIDER_A_BASE_URL,
    apiKey: process.env.PROVIDER_A_API_KEY,
    model: process.env.PROVIDER_A_MODEL,
    displayName: process.env.PROVIDER_A_DISPLAY_NAME || 'Provider A',
    label: 'A',
  };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { password, role, system, message, maxTokens } = body;

    if (process.env.ACCESS_PASSWORD && password !== process.env.ACCESS_PASSWORD) {
      return Response.json({ error: { type: 'unauthorized', message: '访问密码错误' } }, { status: 401 });
    }

    const ip = getIp(req);
    const rl = checkRateLimit(ip);
    if (!rl.ok) {
      const hoursLeft = Math.ceil((rl.resetAt - Date.now()) / (60 * 60 * 1000));
      return Response.json({
        error: { type: 'rate_limit', message: `你今天已用完 ${DAILY_LIMIT} 次额度，${hoursLeft} 小时后重置` }
      }, { status: 429 });
    }

    const provider = getProviderConfig(role);
    if (!provider.baseUrl || !provider.apiKey || !provider.model) {
      return Response.json({
        error: {
          type: 'config_error',
          message: `Provider ${provider.label} 未配置完整，请检查环境变量 PROVIDER_${provider.label}_BASE_URL / API_KEY / MODEL`
        }
      }, { status: 500 });
    }

    const endpoint = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    // 构建请求体
    const requestBody = {
      model: provider.model,
      max_tokens: maxTokens || 1500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
    };

    // 可选：禁用 thinking 模式（DeepSeek V4 Pro / GLM-5.1 等推理模型默认开启 thinking）
    // 在环境变量 PROVIDER_X_DISABLE_THINKING=true 时启用
    const disableThinkingKey = `PROVIDER_${provider.label}_DISABLE_THINKING`;
    if (process.env[disableThinkingKey] === 'true') {
      // 智谱 GLM 格式：thinking: { type: 'disabled' }
      // DeepSeek V4 格式：thinking: { type: 'disabled' } 或 enable_thinking: false
      // 两个都加上，兼容两家
      requestBody.thinking = { type: 'disabled' };
      requestBody.enable_thinking = false;
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let parsed = null;
      try { parsed = JSON.parse(errText); } catch (_) {}
      return Response.json({
        error: {
          type: 'upstream_error',
          message: parsed?.error?.message || errText.slice(0, 300) || `上游 ${provider.label} 返回 ${upstream.status}`,
          status: upstream.status,
          providerLabel: provider.label,
        }
      }, { status: upstream.status });
    }

    const data = await upstream.json();
    const message = data.choices?.[0]?.message;

    // 兼容多种字段：
    // - 标准 OpenAI 格式：content
    // - DeepSeek thinking 模式：可能在 reasoning_content（思考过程）和 content（最终回答）
    // - 智谱 GLM thinking：有些版本可能也用 reasoning_content
    // 如果 content 为空但 reasoning_content 有，说明模型只输出了思考过程没出最终答案（max_tokens 不够）
    let text = message?.content || '';
    const reasoningContent = message?.reasoning_content || '';

    // 如果 content 空但 reasoning 有，说明 max_tokens 被思考过程耗尽了，给用户一个明确的错误
    if (!text && reasoningContent) {
      return Response.json({
        error: {
          type: 'thinking_overflow',
          message: `${provider.label} 的思考过程占满了 max_tokens 但没输出最终答案。模型 "${provider.model}" 可能是 thinking 模式模型，需要更大的 max_tokens 或换成非 thinking 版本。`,
          providerLabel: provider.label,
          finishReason: data.choices?.[0]?.finish_reason,
          reasoningPreview: reasoningContent.slice(0, 200) + '...',
        }
      }, { status: 502 });
    }

    if (!text) {
      // 详细诊断信息
      const finishReason = data.choices?.[0]?.finish_reason;
      const debug = {
        finishReason,
        hasContent: 'content' in (message || {}),
        contentType: typeof message?.content,
        messageKeys: message ? Object.keys(message) : [],
        firstChoice: data.choices?.[0],
      };
      return Response.json({
        error: {
          type: 'empty_response',
          message: `${provider.label}（${provider.model}）返回了空响应。finish_reason=${finishReason || 'unknown'}。可能原因：模型不支持当前调用方式，或返回结构非标准 OpenAI 格式。`,
          providerLabel: provider.label,
          debug,
        }
      }, { status: 502 });
    }

    return Response.json({
      text,
      remaining: rl.remaining,
      providerLabel: provider.label,
      modelName: provider.displayName,
    });

  } catch (err) {
    console.error('API error:', err);
    return Response.json({
      error: {
        type: 'server_error',
        message: err.message || '未知错误',
      }
    }, { status: 500 });
  }
}

// 公开两个 provider 的显示名，前端展示用
export async function GET() {
  return Response.json({
    providerA: process.env.PROVIDER_A_DISPLAY_NAME || 'Provider A',
    providerB: process.env.PROVIDER_B_DISPLAY_NAME || 'Provider B',
  });
}

export const runtime = 'nodejs';
export const maxDuration = 60;
