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

    const requestBody = {
      model: provider.model,
      max_tokens: maxTokens || 1500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
    };

    const disableThinkingKey = `PROVIDER_${provider.label}_DISABLE_THINKING`;
    if (process.env[disableThinkingKey] === 'true') {
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
    const message_obj = data.choices?.[0]?.message;

    let text = message_obj?.content || '';
    const reasoningContent = message_obj?.reasoning_content || '';

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
      const finishReason = data.choices?.[0]?.finish_reason;
      const debug = {
        finishReason,
        hasContent: 'content' in (message_obj || {}),
        contentType: typeof message_obj?.content,
        messageKeys: message_obj ? Object.keys(message_obj) : [],
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

export async function GET() {
  return Response.json({
    providerA: process.env.PROVIDER_A_DISPLAY_NAME || 'Provider A',
    providerB: process.env.PROVIDER_B_DISPLAY_NAME || 'Provider B',
  });
}

export const runtime = 'nodejs';
export const maxDuration = 60;
