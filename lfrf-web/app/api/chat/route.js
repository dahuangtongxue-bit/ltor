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
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens || 1500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
      }),
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
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) {
      return Response.json({
        error: { type: 'empty_response', message: `${provider.label} 返回了空响应` }
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
