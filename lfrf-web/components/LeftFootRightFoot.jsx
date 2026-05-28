'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Pause, SkipForward, Target, Sparkles, AlertTriangle, Eye, FileSearch, Gavel, RotateCw, ChevronRight, ChevronDown, Loader2, Copy, Check, Quote, Lock } from 'lucide-react';

export default function LeftFootRightFoot() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [providerNames, setProviderNames] = useState({ providerA: 'Provider A', providerB: 'Provider B' });
  const [question, setQuestion] = useState('');
  const [stage, setStage] = useState('input'); // input | confirming-goal | running | done
  const [firstPrinciple, setFirstPrinciple] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [rounds, setRounds] = useState([]); // [{role, content, version, critiques?}]
  const [currentStep, setCurrentStep] = useState(''); // describes what's happening
  const [judgeInput, setJudgeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selection, setSelection] = useState(null); // {text, x, y, sourceLabel}
  const [lastFailedAction, setLastFailedAction] = useState(null); // function to retry
  const [newBToast, setNewBToast] = useState(null); // {roundNum, modelName, ts} — B 跑完后右下角浮动提示
  const [converging, setConverging] = useState(false); // 是否正在整合（用于按钮变"停止整合"）
  const convergeAbortRef = useRef(null); // 整合的 AbortController，用于中止
  const scrollRef = useRef(null);
  const judgeInputRef = useRef(null);
  const conversationRef = useRef(null);
  // 流式跟随相关：识别用户是否在向上阅读，避免强制把用户拉到底
  const userScrolledUpRef = useRef(false); // 用户是否手动滚到了非底部位置
  const isAutoScrollingRef = useRef(false); // 标记当前 onScroll 是程序触发的（避免被误判为用户滚动）

  // 流式自动跟随：仅当用户在底部（没主动向上滚）时才追底
  useEffect(() => {
    if (!scrollRef.current) return;
    const lastRound = rounds[rounds.length - 1];
    const isStreaming = lastRound && lastRound.status === 'streaming';
    if ((isStreaming || currentStep) && !userScrolledUpRef.current) {
      isAutoScrollingRef.current = true;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      // 释放标志（next tick 后 onScroll 已经处理完）
      setTimeout(() => { isAutoScrollingRef.current = false; }, 50);
    }
  }, [rounds, currentStep]);

  // onScroll 监听：判断用户是否在底部
  const handleScroll = () => {
    if (!scrollRef.current) return;
    // 程序触发的滚动直接跳过
    if (isAutoScrollingRef.current) return;
    const el = scrollRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 80px 容差：用户在最后一屏内就算"跟随"，否则视为主动向上阅读
    userScrolledUpRef.current = distanceFromBottom > 80;
  };

  // B 提示自动消失：当用户滚动到 B 的位置（可见）时
  useEffect(() => {
    if (!newBToast) return;
    // 5 秒后自动消失（如果用户没主动点）
    const timer = setTimeout(() => setNewBToast(null), 5000);
    return () => clearTimeout(timer);
  }, [newBToast]);

  // 恢复保存的密码（朋友只需输入一次）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lfrf_pw');
      if (saved) {
        setPassword(saved);
        setAuthed(true);
      }
    }
  }, []);

  // 拉取两个 provider 的显示名
  useEffect(() => {
    fetch('/api/chat').then(r => r.json()).then(data => {
      if (data.providerA || data.providerB) {
        setProviderNames({
          providerA: data.providerA || 'Provider A',
          providerB: data.providerB || 'Provider B',
        });
      }
    }).catch(() => {});
  }, []);

  // 监听文本选中事件，弹出"引用到裁判意见"小按钮
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setSelection(null);
        return;
      }
      // 只在对话区内的选中才弹出
      if (!conversationRef.current) return;
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const node = container.nodeType === 1 ? container : container.parentElement;
      if (!conversationRef.current.contains(node)) {
        setSelection(null);
        return;
      }

      // 找到所属的来源块
      let el = node;
      let sourceLabel = '引用';
      while (el && el !== conversationRef.current) {
        if (el.dataset && el.dataset.sourceLabel) {
          sourceLabel = el.dataset.sourceLabel;
          break;
        }
        el = el.parentElement;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = conversationRef.current.getBoundingClientRect();
      setSelection({
        text: sel.toString().trim(),
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top - containerRect.top,
        sourceLabel,
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleSelectionChange);
    };
  }, [stage]);

  const quoteToJudge = () => {
    if (!selection) return;
    const truncated = selection.text.length > 200 ? selection.text.slice(0, 200) + '…' : selection.text;
    const quoted = `> 引用${selection.sourceLabel}："${truncated}"\n\n`;
    setJudgeInput((prev) => quoted + prev);
    setSelection(null);
    window.getSelection().removeAllRanges();
    setTimeout(() => {
      if (judgeInputRef.current) {
        judgeInputRef.current.focus();
        judgeInputRef.current.setSelectionRange(judgeInputRef.current.value.length, judgeInputRef.current.value.length);
      }
    }, 50);
  };

  // 从 B 的回答内容里 parse 出评级（A+/A/B/C），找不到则返回 null
  // B 的标准输出第一行格式：**评级：A+** ｜ **总评**：...
  const parseRating = (content) => {
    if (!content) return null;
    const match = content.match(/\*\*评级[：:]\s*([ABC]\+?)\s*\*\*/);
    return match ? match[1] : null;
  };

  // 评级 → Tailwind class 完整映射（必须是完整字符串，JIT 才能识别）
  // A+ 翠绿（赞美）/ A 天蓝（认可）/ B 琥珀（中等批评）/ C 玫红（重大缺陷）
  const ratingStyles = {
    'A+': {
      cardBg: 'bg-emerald-50/40',
      cardBorder: 'border-emerald-100',
      dotBg: 'bg-emerald-100',
      dotText: 'text-emerald-800',
      titleText: 'text-emerald-900',
      subText: 'text-emerald-700',
      tag: 'bg-emerald-100 text-emerald-800',
      toastBg: 'bg-emerald-600 hover:bg-emerald-700',
      cursor: 'bg-emerald-500',
      label: 'A+',
    },
    'A': {
      cardBg: 'bg-sky-50/40',
      cardBorder: 'border-sky-100',
      dotBg: 'bg-sky-100',
      dotText: 'text-sky-800',
      titleText: 'text-sky-900',
      subText: 'text-sky-700',
      tag: 'bg-sky-100 text-sky-800',
      toastBg: 'bg-sky-600 hover:bg-sky-700',
      cursor: 'bg-sky-500',
      label: 'A',
    },
    'B': {
      cardBg: 'bg-amber-50/40',
      cardBorder: 'border-amber-100',
      dotBg: 'bg-amber-100',
      dotText: 'text-amber-800',
      titleText: 'text-amber-900',
      subText: 'text-amber-700',
      tag: 'bg-amber-100 text-amber-800',
      toastBg: 'bg-amber-600 hover:bg-amber-700',
      cursor: 'bg-amber-500',
      label: 'B',
    },
    'C': {
      cardBg: 'bg-rose-50/40',
      cardBorder: 'border-rose-100',
      dotBg: 'bg-rose-100',
      dotText: 'text-rose-800',
      titleText: 'text-rose-900',
      subText: 'text-rose-700',
      tag: 'bg-rose-100 text-rose-800',
      toastBg: 'bg-rose-600 hover:bg-rose-700',
      cursor: 'bg-rose-500',
      label: 'C',
    },
  };
  // 默认（评级解析失败时回退到原 B 的橙色）
  const defaultBStyle = {
    cardBg: 'bg-white',
    cardBorder: 'border-stone-100',
    dotBg: 'bg-orange-100',
    dotText: 'text-orange-800',
    titleText: 'text-stone-900',
    subText: 'text-stone-500',
    tag: 'bg-orange-100 text-orange-800',
    toastBg: 'bg-orange-600 hover:bg-orange-700',
    cursor: 'bg-orange-500',
    label: '',
  };

  const copyEntireConversation = () => {
    const lines = [`# 问题\n${question}\n`];
    if (firstPrinciple) lines.push(`# 第一性目标\n${firstPrinciple}\n`);
    rounds.forEach((r) => {
      if (r.role === 'A') lines.push(`## 主答者 A · Round ${r.round} (${r.version})\n${r.content}\n`);
      else if (r.role === 'B') {
        if (r.status === 'pending') lines.push(`## 评审者 B · Round ${r.round}\n（评审进行中…）\n`);
        else if (r.status === 'failed') lines.push(`## 评审者 B · Round ${r.round}\n（评审失败）\n`);
        else lines.push(`## 评审者 B · Round ${r.round}\n${r.content}\n`);
      }
      else if (r.role === 'JUDGE') lines.push(`## 我（裁判）· Round ${r.round}\n${r.content}\n`);
      else if (r.role === 'FINAL') lines.push(`## 整合者 · 综合答案\n${r.content}\n`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // 调用后端代理。role 决定走哪个 provider：
  //   'main' / 'synthesizer' / 'goal' → Provider A
  //   'critic' → Provider B
  // 自带最多 2 次指数退避重试
  // 流式调用：使用 SSE 接收增量内容
  // onChunk(delta) 每收到一段新内容就调用一次
  // 返回 { text, modelName, providerLabel } —— text 是完整累积的文本
  const callClaudeStream = async (systemPrompt, userMessage, opts) => {
    const { role, maxTokens, onChunk, signal } = opts;
    const maxRetries = 1; // 流式重试一次就够，避免重复触发 onChunk
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1000));
        }

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal, // 支持外部中止
          body: JSON.stringify({
            password,
            role,
            maxTokens,
            stream: true,
            system: systemPrompt,
            message: userMessage,
          }),
        });

        // 不是 SSE：可能是错误响应（密码错、限流、配置错等）
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('text/event-stream')) {
          if (response.status === 401) {
            setAuthed(false);
            if (typeof window !== 'undefined') localStorage.removeItem('lfrf_pw');
            throw new Error('访问密码错误，请重新输入');
          }
          let errMsg = `请求失败（HTTP ${response.status}）`;
          try {
            const data = await response.json();
            errMsg = data.error?.message || errMsg;
            if (response.status === 429) throw new Error(errMsg);
          } catch (jsonErr) {
            if (jsonErr.message?.includes('额度')) throw jsonErr;
          }
          if (response.status === 504 || response.status === 408) {
            errMsg = `请求超时（HTTP ${response.status}）`;
          }
          lastError = new Error(errMsg);
          if (attempt === maxRetries) throw lastError;
          continue;
        }

        // 开始读 SSE 流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let metadata = {};
        let streamError = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr) continue;

            try {
              const json = JSON.parse(dataStr);
              if (json.delta) {
                accumulated += json.delta;
                if (onChunk) onChunk(json.delta, accumulated);
              } else if (json.done) {
                metadata = {
                  modelName: json.modelName,
                  providerLabel: json.providerLabel,
                  remaining: json.remaining,
                };
              } else if (json.error) {
                streamError = json.error;
              }
            } catch (_) {
              // 单行解析失败不中断
            }
          }
        }

        if (streamError) {
          throw new Error(typeof streamError === 'string' ? streamError : (streamError.message || '流式响应出错'));
        }
        if (!accumulated) {
          throw new Error('流式响应未收到任何内容');
        }
        if (typeof metadata.remaining === 'number') setRemaining(metadata.remaining);
        return {
          text: accumulated,
          modelName: metadata.modelName,
          providerLabel: metadata.providerLabel,
        };
      } catch (err) {
        if (err.message?.includes('密码') || err.message?.includes('额度')) throw err;
        lastError = err;
        if (attempt === maxRetries) throw err;
      }
    }
    throw lastError || new Error('流式调用失败');
  };

  // 调用后端代理。如果传入 onChunk 则走流式（SSE），否则走非流式
  const callClaude = async (systemPrompt, userMessage, opts = {}) => {
    const { role = 'main', maxTokens = 1500, onChunk, signal } = opts;

    // 如果调用方提供了 onChunk 回调，走流式分支
    if (onChunk) {
      return callClaudeStream(systemPrompt, userMessage, { role, maxTokens, onChunk, signal });
    }

    // 否则走原有非流式逻辑
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = attempt === 1 ? 800 : 2000;
          await new Promise(r => setTimeout(r, delay));
        }

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password,
            role,
            maxTokens,
            system: systemPrompt,
            message: userMessage,
          }),
        });

        // 安全解析响应
        let data;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            data = await response.json();
          } catch (parseErr) {
            data = { error: { message: `响应解析失败（HTTP ${response.status}）。可能是请求超过 Vercel 60 秒上限被中断。` } };
          }
        } else {
          const text = await response.text();
          const snippet = text.slice(0, 200).replace(/<[^>]*>/g, '').trim();
          if (response.status === 504 || response.status === 408) {
            data = { error: { message: `请求超时（HTTP ${response.status}）：单次响应超过 Vercel 60 秒上限。建议减少对话轮次，或在裁判意见中要求 AI 更精炼。` } };
          } else if (response.status === 502 || response.status === 503) {
            data = { error: { message: `Vercel 服务暂时不可用（HTTP ${response.status}）。请稍后重试。` } };
          } else {
            data = { error: { message: `服务返回了非 JSON 响应（HTTP ${response.status}）：${snippet || '无内容'}` } };
          }
        }

        if (response.ok && data.text) {
          if (typeof data.remaining === 'number') setRemaining(data.remaining);
          return { text: data.text, modelName: data.modelName, providerLabel: data.providerLabel };
        }

        const errInfo = data.error || { type: 'unknown', message: '未知错误', status: response.status };

        if (response.status === 401) {
          setAuthed(false);
          if (typeof window !== 'undefined') localStorage.removeItem('lfrf_pw');
          throw new Error('访问密码错误，请重新输入');
        }

        if (response.status === 429) {
          throw new Error(errInfo.message);
        }

        const shouldRetry = response.status >= 500;
        lastError = new Error(formatApiError(errInfo, role, attempt));

        if (!shouldRetry || attempt === maxRetries) {
          throw lastError;
        }
      } catch (err) {
        if (err.message?.includes('密码') || err.message?.includes('额度')) throw err;
        lastError = err;
        if (attempt === maxRetries) throw err;
      }
    }
    throw lastError;
  };

  // 格式化错误为用户友好信息
  const formatApiError = (info, role, attempt) => {
    const attemptStr = attempt > 0 ? `（已重试 ${attempt} 次）` : '';
    const providerLabel = info.providerLabel ? `[Provider ${info.providerLabel}] ` : '';
    const status = info.status;
    if (status === 400) return `${providerLabel}请求格式错误：${info.message}${attemptStr}`;
    if (status === 404) return `${providerLabel}模型不可用。${info.message || ''}${attemptStr}`;
    if (status >= 500) return `${providerLabel}服务端错误（${status}）${attemptStr}：${info.message || '请稍后重试'}`;
    return `${providerLabel}${info.message || '调用失败'}${attemptStr}`;
  };

  // 第一性目标提取者 — 从问题里精炼出用户真正在解的核心目标
  const SYSTEM_GOAL_EXTRACTOR = `你是一个目标分析师。用户提出了一个问题，你的任务是识别出这个问题背后真正的"第一性目标"——即用户在更深层次上想达成的核心目标，所有讨论都应围绕它展开。

第一性目标的标准：
- 比表面问题更本质（例如表面是"选 A 还是 B 数据库"，第一性目标可能是"在 X 业务场景下，让系统在未来 2 年内可扩展且可维护"）
- 可作为判断"哪些讨论有价值、哪些是跑题"的尺子
- 一句话，30 字以内，明确、具体、可衡量倾向

只输出一行第一性目标本身，不要加引号、标题、解释。`;

  // 角色 A 的 system prompt — 主答者（Opus 4.7，深度回答模式）
  const SYSTEM_A_INITIAL = (goal) => `你是"主答者 A"，由 Claude Opus 4.7 担任。用户向你咨询一个值得深度思考的问题，请像你正常工作时一样，给出完整、深入、结构化的高质量回答。

【第一性目标】（你的回答必须服务于此）：
${goal}

回答要求：
- 精炼优先：用最少的篇幅说清最重要的事，避免冗长展开。
- 不要堆砌"该展开就展开"的内容，每一段都必须服务于第一性目标。
- 思考用户没说出口的隐含需求和边界条件，但简短指出即可。
- 对关键论断给出简明推理，不要长篇大论。
- 主动指出 1-2 个最关键的不确定点。
- 在结尾用一句话回应"这个回答如何服务于第一性目标"。

风格：务实、精准、有判断力。不要过度免责声明，不要套话开场，直接进入实质内容。**控制在 800 字以内**。

输出结构（用 Markdown 组织，简洁紧凑）：
**核心判断 / 结论**（2-3 句）
**关键理由**（3-5 点，每点 1-2 句）
**关键权衡或不确定性**（1-2 点）
**置信度评估**：XX%
**对第一性目标的服务方式**：（1 句话）`;

  const SYSTEM_A_REVISE = (goal) => `你是"主答者 A"。评审者 B 已经对你的上一版答案给出了评级（A+/A/B/C 四档）和审视意见，用户作为裁判可能也给了介入意见。
请精炼地重写你的答案，给出一个更对齐第一性目标的版本。

【第一性目标】（修订必须更好地服务于此）：
${goal}

修订原则：
1. 优先关注 B 的评级和总评——评级低（B/C）说明有重大问题需要正面回应；评级高（A+/A）说明只需打磨边角
2. 不是小修小补，而是基于反馈做实质性调整——但保持精炼
3. 明确说明你改了什么、为什么改（简短，3-5 点即可）
4. 如果某些批评你不接受，明确说明并给出理由
5. **控制在 900 字以内**，深度优先于篇幅

输出结构（用 Markdown）：
**修订后的核心判断**
**相比上版的关键改动**（要点形式，说明改了什么、为什么改）
**展开分析**（深度回答，含子小节）
**对评审意见的逐条回应**（接受 / 不接受 + 理由）
**剩余的不确定性**
**置信度评估**：XX%
**对第一性目标的服务方式**：（1 句话）`;

  // 角色 B 的 system prompt — 独立评审者，先评级后批评，严格倾向
  const SYSTEM_B = (goal) => `你是"独立评审者 B"。你的任务是审视主答者 A 的回答，对它做出公允但严格的评级，并给出有判断力的审视意见。

【第一性目标】（你的北极星，评级和批评都必须最终服务于此）：
${goal}

---

【评级体系】（必须严格——评级通货膨胀会让你失去价值）

**A+ 级**（稀有，默认不要给）
- 同时满足 3 条硬性条件：（1）事实准确无误；（2）覆盖了与第一性目标相关的所有关键视角；（3）直击目标，没有跑题或冗余
- 你需要在内心反复确认"挑不出实质问题"才能给 A+
- 大多数答案不配 A+

**A 级**（整体扎实）
- 主体正确、对齐目标，但存在 1-2 个值得讨论的边角问题或可补充的视角

**B 级**（方向对但有薄弱点）—— 这是你的默认档位
- 答案大体对，但有 2-3 个明显的薄弱点：可能某个视角缺失，某个论证不够，某个事实可疑
- 如果你挑不出实质问题，但也没把握给 A，**默认就给 B**——这比通货膨胀给 A 更诚实

**C 级**（有重大缺陷）
- 存在以下任一致命问题：事实错误、严重逻辑漏洞、严重遗漏关键视角、跑题偏离第一性目标
- 给 C 级时你必须在总评里明确说"这个答案需要重做"

【评级倾向规则】（必读）
- 你的默认档位是 **B 级**——挑不出实质问题但也没把握给 A，就给 B
- A+ 级要稀有，需要主动论证"为什么挑不出问题"
- 看到答案的第一反应不应该是"找几个温和的补充"——而应该是"这答案能不能对得起第一性目标"

---

【输出格式】（严格遵守，前端需要解析）

第一行必须是这个固定格式（前端会从这里提取评级）：
\`\`\`
**评级：[A+ / A / B / C]** ｜ **总评**：（1 句话，说明评级的核心理由，C 级时必须明确说"这个答案需要重做"）
\`\`\`

然后空一行，按以下结构输出：

**A 的核心强项：**
- （承认 A 答得好的地方，1-2 条，要具体不要空话）
- （如果是 C 级且实在没有强项，可以写"暂未发现实质强项"）

**审视意见：**

**1. [类别] 标题（简短有力）**
（2 句具体说明，直击要害，不要客套）
*对第一性目标的影响：* （1 句话）

**2. [类别] 标题**
（同上结构）

**3.（仅 B/C 级需要第 3 条；A+/A 级允许只给 1-2 条）**

【类别选择】
- A+/A 级允许用：[可补充视角] / [可强化论证] / [可深入边角]
- B/C 级必须用：[事实存疑] / [忽略视角] / [逻辑漏洞]

【数量规则】
- A+ 级：1 条审视意见（轻度建议）
- A 级：1-2 条
- B 级：2-3 条
- C 级：3 条（必须 3 条，因为是重大缺陷）

控制总长在 600 字以内，直接进入评级，不要客套，不要总结结尾。`;

  // 第一步：从问题提取第一性目标，进入确认页
  const extractGoal = async () => {
    if (!question.trim()) return;
    setError('');
    setLastFailedAction(null);
    setLoading(true);

    try {
      const result = await callClaude(
        SYSTEM_GOAL_EXTRACTOR,
        `用户的问题：\n${question}\n\n请提炼第一性目标，一行输出。`,
        { role: 'goal', maxTokens: 200 }
      );
      setFirstPrinciple(result.text.trim().replace(/^["'"']|["'"']$/g, ''));
      setStage('confirming-goal');
    } catch (e) {
      setError(e.message);
      setLastFailedAction(() => extractGoal);
    } finally {
      setLoading(false);
    }
  };

  // 后台触发 B 审查（fire-and-forget，不占位、不阻塞 UI）
  // B 跑完才会被插入到 rounds，跑的过程中 UI 上没有任何痕迹
  // 跑完后会通过 newBToastRound 触发右下角提示
  const triggerBReview = (aContent, roundNum, isRevise = false, aVersion = '') => {
    const userMessage = isRevise
      ? `用户的问题：\n${question}\n\n这是 A 的修订版答案（${aVersion}）：\n${aContent}\n\n请重点审查：A 是否在向第一性目标真正收敛？是否引入了新问题或新分歧？按格式输出。`
      : `用户的问题是：\n${question}\n\nA 的回答是：\n${aContent}\n\n请按"先发散后收敛"的方式输出你的审查批评，每条都要回答它如何影响第一性目标。`;

    // 立即插入 pending 占位（A 答案下方显示"B 正在评审中..."）
    setRounds(prev => [...prev, {
      role: 'B',
      content: '',
      round: roundNum,
      model: providerNames.providerB,
      status: 'pending',
      expanded: true,
    }]);

    callClaude(
      SYSTEM_B(firstPrinciple),
      userMessage,
      {
        role: 'critic',
        maxTokens: 800,
        onChunk: () => {} // 保活连接，避免 Netlify 10s 超时
      }
    ).then(bResult => {
      // 把同 roundNum 的 pending 占位 update 成完整 done
      setRounds(prev => prev.map(r =>
        (r.role === 'B' && r.round === roundNum && r.status === 'pending')
          ? { ...r, content: bResult.text, model: bResult.modelName, status: 'done', expanded: true }
          : r
      ));
      // 触发右下角 toast 提示（带评级，让 toast 颜色化）
      const rating = parseRating(bResult.text);
      setNewBToast({ roundNum, modelName: bResult.modelName, rating, ts: Date.now() });
    }).catch(err => {
      // 失败：把 pending 占位 update 成 failed
      setRounds(prev => prev.map(r =>
        (r.role === 'B' && r.round === roundNum && r.status === 'pending')
          ? { ...r, content: `审查失败：${err.message}`, status: 'failed', dismissed: false }
          : r
      ));
    });
  };

  // 用户点击展开/折叠 B 卡片（保留功能，用户读完后想折叠的话）
  const toggleBExpanded = (roundNum) => {
    setRounds(prev => prev.map(r => {
      if (r.role === 'B' && r.round === roundNum) {
        return { ...r, expanded: !r.expanded };
      }
      return r;
    }));
  };

  // 关闭失败的 B 标记
  const dismissFailedB = (roundNum) => {
    setRounds(prev => prev.map(r => {
      if (r.role === 'B' && r.round === roundNum && r.status === 'failed') {
        return { ...r, dismissed: true };
      }
      return r;
    }));
  };

  // 第二步：在第一性目标确认后，真正开始辩论
  // 新交互：A 出来立刻显示，B 后台静默跑
  const runDebate = async () => {
    if (!firstPrinciple.trim()) return;
    setError('');
    setLastFailedAction(null);
    setStage('running');
    setRounds([]);
    setLoading(true);

    try {
      // Round 1 - A 主答（SSE 流式，逐字显示）
      setCurrentStep(`${providerNames.providerA} 正在深度思考第一轮答案……`);

      // 立刻插入一个 streaming 状态的空 A 卡片，后续 onChunk 会实时更新它的 content
      setRounds([{
        role: 'A',
        content: '',
        version: 'v1',
        round: 1,
        model: providerNames.providerA,
        status: 'streaming',
      }]);
      userScrolledUpRef.current = false; // 新一轮开始，重置跟随状态
      setCurrentStep('');
      setLoading(false); // A 一开始流式就解锁 UI，让用户看到字逐渐出来

      const aResult = await callClaude(
        SYSTEM_A_INITIAL(firstPrinciple),
        question,
        {
          role: 'main',
          maxTokens: 1500,
          onChunk: (delta, accumulated) => {
            // 实时把累积内容写回 rounds
            setRounds(prev => prev.map(r =>
              (r.role === 'A' && r.round === 1 && r.status === 'streaming')
                ? { ...r, content: accumulated }
                : r
            ));
          },
        }
      );

      // A 完成：清掉 streaming 状态，更新 modelName
      setRounds(prev => prev.map(r =>
        (r.role === 'A' && r.round === 1 && r.status === 'streaming')
          ? { ...r, content: aResult.text, model: aResult.modelName || r.model, status: undefined }
          : r
      ));

      // B 后台静默跑（不 await，不阻塞）
      triggerBReview(aResult.text, 1, false);
    } catch (e) {
      setError(e.message);
      setLastFailedAction(() => runDebate);
      // 清理 streaming 状态的半截 A 卡片
      setRounds(prev => prev.filter(r => !(r.role === 'A' && r.status === 'streaming')));
      setStage('confirming-goal');
      setCurrentStep('');
      setLoading(false);
    }
  };

  const submitJudgeAndContinue = async () => {
    const judgeMsg = judgeInput.trim();
    setJudgeInput('');
    setLoading(true);
    setError('');
    setLastFailedAction(null);

    try {
      const currentRounds = [...rounds];

      // 加入裁判消息（如有）
      if (judgeMsg) {
        currentRounds.push({ role: 'JUDGE', content: judgeMsg, round: rounds[rounds.length - 1].round });
        setRounds([...currentRounds]);
      }

      const nextRoundNum = currentRounds[currentRounds.length - 1].round + 1;

      // 拼接历史给 A —— 只传最近的关键节点（避免轮次增加导致 token 暴涨）
      // 修订所需的最小上下文：上一版 A 答案 + 上一次 B 批评（如有完成的） + 用户最新裁判意见
      const buildRecentHistoryForA = () => {
        // 找出最近一条 A 答案
        const lastA = [...currentRounds].reverse().find(r => r.role === 'A');
        // 找出最近一条已完成的 B 批评（跳过 pending/failed）
        const lastB = [...currentRounds].reverse().find(r => r.role === 'B' && r.status !== 'pending' && r.status !== 'failed');
        // 找出最近一条裁判意见（如有）
        const lastJudge = [...currentRounds].reverse().find(r => r.role === 'JUDGE');

        const parts = [];
        if (lastA) parts.push(`[A 的上一版答案（${lastA.version}）]\n${lastA.content}`);
        if (lastB) parts.push(`[B 对上一版的审查批评]\n${lastB.content}`);
        if (lastJudge) parts.push(`[用户最新裁判意见]\n${lastJudge.content}`);
        return parts.join('\n\n---\n\n');
      };
      const historyForA = buildRecentHistoryForA();

      setCurrentStep(`Round ${nextRoundNum} — ${providerNames.providerA} 正在深度修订答案……`);
      const version = `v${currentRounds.filter(r => r.role === 'A').length + 1}`;

      // 立刻插入 streaming 状态的 A 修订占位卡片
      const placeholderA = {
        role: 'A',
        content: '',
        version,
        round: nextRoundNum,
        model: providerNames.providerA,
        status: 'streaming',
      };
      currentRounds.push(placeholderA);
      setRounds([...currentRounds]);
      userScrolledUpRef.current = false; // 新一轮 A 修订，重置跟随
      setCurrentStep('');
      setLoading(false); // A 一开始流式就解锁 UI

      const aResult = await callClaude(
        SYSTEM_A_REVISE(firstPrinciple),
        `用户的原始问题：\n${question}\n\n以下是你需要回应的最近一轮反馈：\n${historyForA}\n\n请输出修订版答案。新答案必须比上版更好地达成第一性目标。`,
        {
          role: 'main',
          maxTokens: 1500,
          onChunk: (delta, accumulated) => {
            setRounds(prev => prev.map(r =>
              (r.role === 'A' && r.round === nextRoundNum && r.status === 'streaming')
                ? { ...r, content: accumulated }
                : r
            ));
          },
        }
      );

      // A 完成：清掉 streaming 状态
      setRounds(prev => prev.map(r =>
        (r.role === 'A' && r.round === nextRoundNum && r.status === 'streaming')
          ? { ...r, content: aResult.text, model: aResult.modelName || r.model, status: undefined }
          : r
      ));

      // B 二审后台跑（不 await）
      triggerBReview(aResult.text, nextRoundNum, true, version);
    } catch (e) {
      setError(e.message);
      setCurrentStep('');
      setLoading(false);
      // 清理半截 streaming 的 A
      setRounds(prev => prev.filter(r => !(r.role === 'A' && r.status === 'streaming')));
      // 重试：保留当前 rounds（含已添加的 judge），重新跑剩余流程
      setLastFailedAction(() => submitJudgeAndContinue);
    }
  };

  const converge = async () => {
    setLoading(true);
    setError('');
    setLastFailedAction(null);

    // 建立 AbortController，允许用户中途停止整合
    const controller = new AbortController();
    convergeAbortRef.current = controller;
    setConverging(true);

    try {
      setCurrentStep('整合者正在综合双方答案……');

      // 智能压缩历史：最近一轮保留完整内容，更早的内容做摘要级截断
      // 跳过 pending/failed 状态的 B（用户在 B 没跑完时点了整合，或 B 失败了）
      const buildCompactHistory = () => {
        const validRounds = rounds.filter(r => {
          if (r.role === 'B' && (r.status === 'pending' || r.status === 'failed')) return false;
          return true;
        });
        const lastRoundNum = validRounds.length > 0 ? Math.max(...validRounds.map(r => r.round || 0)) : 0;

        return validRounds.map(r => {
          const isLastRound = (r.round || 0) === lastRoundNum;
          const cap = isLastRound ? 2000 : 400; // 最后一轮保留充分，更早的限 400 字
          const text = (r.content || '').slice(0, cap);
          const truncated = (r.content || '').length > cap ? text + '\n......（节选）' : text;

          if (r.role === 'A') return `[A 的 ${r.version} 答案${isLastRound ? '·最终版本' : ''}]\n${truncated}`;
          if (r.role === 'B') return `[B 的评审意见${isLastRound ? '·最近一次' : ''}]\n${truncated}`;
          if (r.role === 'JUDGE') return `[用户裁判介入]\n${truncated}`;
          return '';
        }).join('\n\n---\n\n');
      };
      const history = buildCompactHistory();

      // 立刻插入 streaming 状态的 FINAL 占位卡片
      setRounds(prev => [...prev, {
        role: 'FINAL',
        content: '',
        model: providerNames.providerA,
        status: 'streaming',
      }]);
      userScrolledUpRef.current = false; // 整合开始，重置跟随
      setCurrentStep('');
      setLoading(false); // 流式开始就解锁 UI

      const finalResult = await callClaude(
        `你是一位"整合者"。你的职责不是裁判 A 和 B 谁对谁错，而是站在比双方都更高的视角，用第一性原理思考，把 A 的深度和 B 的批判性洞察融合成一个比任何单方都更好的完整答案。

【第一性目标】（你的最高北极星，整个答案必须服务于此，不要被 A/B 的具体表述束缚）：
${firstPrinciple}

【核心工作方式】
1. 回到第一性：先问"用户真正要解决的问题是什么"，从根本需求出发组织答案，而不是简单拼接 A 和 B 的观点。
2. 融合为主：把 A 的论证和 B 的洞察看作同一个答案的不同侧面，主动寻找并整合它们的共识与互补之处，形成一个连贯、统一的回答。
3. 分歧为辅：只有当 A 和 B 存在"会实质影响用户决策"的分歧时，才单独点出——而且不要替用户选边，而是说清楚"这个权衡取决于什么"，把决策依据交给用户。无关紧要的措辞差异不要提。

【输出格式】
**综合结论**：（站在第一性目标的高度，给出一个直接、完整、可用的结论——这是融合后的答案，不是"谁赢了"）
**关键要点**：（3-5 条，把 A 的深度和 B 的洞察融合进去，每条简要展开）
**需要你自己权衡的地方**（可选，仅当存在影响决策的实质分歧时才写）：（说清楚权衡的两端分别适合什么情况，由用户根据自身处境判断，不替用户拍板）
**对第一性目标的达成度**：（1-2 句）
**剩余的不确定性**
**置信度评估**：XX%
**给你的下一步建议**：（2-4 条可执行的行动）

风格：像一个见识更高的人帮你把两方智慧整合成一个清晰答案，温和、有洞察、不制造对立。深入，不必刻意短。`,
        `用户原始问题：\n${question}\n\n讨论历史（最近一轮完整保留，更早内容已节选）：\n${history}\n\n请站在第一性目标的高度，融合 A 和 B 的内容，输出一个统一的综合答案。重点参考最近一轮，更早内容仅供参考。`,
        {
          role: 'synthesizer',
          maxTokens: 1800,
          signal: controller.signal,
          onChunk: (delta, accumulated) => {
            setRounds(prev => prev.map(r =>
              (r.role === 'FINAL' && r.status === 'streaming')
                ? { ...r, content: accumulated }
                : r
            ));
          },
        }
      );

      // FINAL 完成：清掉 streaming 状态
      setRounds(prev => prev.map(r =>
        (r.role === 'FINAL' && r.status === 'streaming')
          ? { ...r, content: finalResult.text, model: finalResult.modelName || r.model, status: undefined }
          : r
      ));
      setStage('done');
      setConverging(false);
      convergeAbortRef.current = null;
    } catch (e) {
      // 用户主动中止：丢弃半截 FINAL，回到可继续 battle 的状态，不报错
      if (e.name === 'AbortError' || controller.signal.aborted) {
        setRounds(prev => prev.filter(r => !(r.role === 'FINAL' && r.status === 'streaming')));
        setCurrentStep('');
        setLoading(false);
        setConverging(false);
        convergeAbortRef.current = null;
        return;
      }
      // 真正的错误
      setError(e.message);
      setCurrentStep('');
      setRounds(prev => prev.filter(r => !(r.role === 'FINAL' && r.status === 'streaming')));
      setLastFailedAction(() => converge);
      setLoading(false);
      setConverging(false);
      convergeAbortRef.current = null;
    }
  };

  // 中止整合：丢弃半截内容，回到 battle 状态
  const stopConverge = () => {
    if (convergeAbortRef.current) {
      convergeAbortRef.current.abort();
    }
  };

  const reset = () => {
    setStage('input');
    setRounds([]);
    setQuestion('');
    setFirstPrinciple('');
    setEditingGoal(false);
    setJudgeInput('');
    setError('');
    setCurrentStep('');
    setLastFailedAction(null);
  };

  // 可复用的错误卡 — 显示详细错误并支持重试
  const ErrorCard = () => {
    if (!error) return null;
    return (
      <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-start gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-red-900 mb-1">操作失败</div>
            <div className="text-xs text-red-800 leading-relaxed break-words font-mono whitespace-pre-wrap">{error}</div>
            <div className="text-[11px] text-red-600 mt-2 leading-relaxed">
              已自动重试 2 次仍未成功。常见原因：响应超过 60 秒、API 限流、网络抖动。可尝试：让讨论继续（不输入裁判意见）、或点"整合者：综合答案"结束本次讨论。
            </div>
          </div>
        </div>
        {lastFailedAction && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-red-200">
            <button
              onClick={() => {
                setError('');
                lastFailedAction();
              }}
              disabled={loading}
              className="flex-1 bg-red-700 text-white py-2 rounded-md text-xs font-medium hover:bg-red-800 disabled:opacity-40 flex items-center justify-center gap-1.5 transition"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
              重试当前操作
            </button>
            <button
              onClick={() => { setError(''); setLastFailedAction(null); }}
              className="px-3 py-2 border border-red-300 text-red-700 rounded-md text-xs hover:bg-red-100 transition"
            >
              忽略
            </button>
          </div>
        )}
      </div>
    );
  };

  // 简单的 Markdown 渲染（粗体）
  const renderMarkdown = (text) => {
    return text.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <div key={i} className="min-h-[1.2em]">
          {parts.map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <span key={j} className="font-medium">{part.slice(2, -2)}</span>;
            }
            return <span key={j}>{part}</span>;
          })}
        </div>
      );
    });
  };

  const renderCritique = (text) => {
    // 给 [类别] 标签上色
    return text.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*|\[(?:事实存疑|忽略视角|逻辑漏洞)\])/g);
      return (
        <div key={i} className="min-h-[1.2em]">
          {parts.map((part, j) => {
            if (part === '[事实存疑]') {
              return <span key={j} className="inline-block px-2 py-0.5 text-xs rounded bg-teal-100 text-teal-800 font-medium mr-1">事实存疑</span>;
            }
            if (part === '[忽略视角]') {
              return <span key={j} className="inline-block px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800 font-medium mr-1">忽略视角</span>;
            }
            if (part === '[逻辑漏洞]') {
              return <span key={j} className="inline-block px-2 py-0.5 text-xs rounded bg-red-100 text-red-800 font-medium mr-1">逻辑漏洞</span>;
            }
            if (part.startsWith('**') && part.endsWith('**')) {
              return <span key={j} className="font-medium">{part.slice(2, -2)}</span>;
            }
            return <span key={j}>{part}</span>;
          })}
        </div>
      );
    });
  };

  // === 密码登录页 ===
  if (!authed) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-medium text-lg">L</div>
              <h1 className="text-2xl font-medium text-stone-900">左脚踩右脚</h1>
              <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-800 flex items-center justify-center font-medium text-lg">R</div>
            </div>
            <p className="text-stone-600 text-sm">两个 AI 讨论博弈，给你更靠谱的答案</p>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
            <label className="block text-sm font-medium text-stone-700 mb-2 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> 测试访问密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && password.trim()) { setAuthed(true); localStorage.setItem('lfrf_pw', password); } }}
              placeholder="请输入访问密码"
              autoFocus
              className="w-full p-3 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mb-3"
            />
            <button
              onClick={() => { if (password.trim()) { setAuthed(true); localStorage.setItem('lfrf_pw', password); } }}
              disabled={!password.trim()}
              className="w-full bg-stone-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-stone-800 disabled:opacity-40 transition"
            >
              进入
            </button>
            <p className="text-xs text-stone-400 mt-3 text-center">这是 beta 测试版，密码由作者提供给你</p>
          </div>
        </div>
      </div>
    );
  }

  // === 输入页 ===
  if (stage === 'input') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-medium text-lg">L</div>
              <h1 className="text-2xl font-medium text-stone-900">左脚踩右脚</h1>
              <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-800 flex items-center justify-center font-medium text-lg">R</div>
            </div>
            <p className="text-stone-600 text-sm">两个 AI 讨论博弈，给你更靠谱的答案</p>
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
            <label className="block text-sm font-medium text-stone-700 mb-2">提出一个值得推敲的问题</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="比如：复杂决策、技术选型、投资判断、深度分析……"
              className="w-full p-4 border border-stone-200 rounded-xl text-sm resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              rows={4}
            />

            <div className="p-3 bg-stone-50 rounded-lg mb-4 text-xs text-stone-600 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded font-medium">主答 A</span>
                <span className="text-stone-500">{providerNames.providerA} · 深度回答</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded font-medium">评审 B</span>
                <span className="text-stone-500">{providerNames.providerB} · 独立评级</span>
              </div>
              <div className="text-stone-400 pt-1 border-t border-stone-100">A+ / A / B / C 四档评级 · 你随时可作为裁判介入</div>
              {remaining !== null && (
                <div className="text-stone-500 pt-1">你今天还剩 <span className="font-medium text-stone-700">{remaining}</span> 次调用</div>
              )}
            </div>

            <ErrorCard />

            <button
              onClick={extractGoal}
              disabled={!question.trim() || loading}
              className="w-full bg-stone-900 text-white py-3 rounded-xl text-sm font-medium hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> 正在提炼第一性目标……</> : <><Sparkles className="w-4 h-4" /> 提炼第一性目标</>}
            </button>
          </div>

          <p className="text-center text-xs text-stone-400 mt-4">两个不同的大模型互相博弈打磨答案，你做最终裁判</p>
        </div>
      </div>
    );
  }

  // === 第一性目标确认页 ===
  if (stage === 'confirming-goal') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 mb-2 text-stone-500 text-xs">
              <Target className="w-3.5 h-3.5" />
              <span>第一性目标 · 锚定整场讨论</span>
            </div>
            <h2 className="text-lg font-medium text-stone-900">你真正想解决的核心目标</h2>
            <p className="text-xs text-stone-500 mt-1">B 的所有批评和 A 的所有修订都会围绕它收敛 — 请确认或修改</p>
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
            <div className="text-xs text-stone-500 mb-2">你的问题</div>
            <div className="text-sm text-stone-700 mb-5 p-3 bg-stone-50 rounded-lg leading-relaxed">{question}</div>

            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-stone-500 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-amber-700" />
                AI 提炼的第一性目标
              </div>
              {!editingGoal && (
                <button
                  onClick={() => setEditingGoal(true)}
                  className="text-xs text-blue-700 hover:text-blue-900 transition"
                >
                  修改
                </button>
              )}
            </div>

            {editingGoal ? (
              <textarea
                value={firstPrinciple}
                onChange={(e) => setFirstPrinciple(e.target.value)}
                autoFocus
                className="w-full p-3 border border-amber-300 bg-amber-50/40 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-200 mb-4"
                rows={2}
              />
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 leading-relaxed mb-4 font-medium">
                {firstPrinciple}
              </div>
            )}

            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-900 leading-relaxed mb-5">
              <div className="font-medium mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                这个目标会被怎么用？
              </div>
              · B 可以发散思考，但每条批评结尾都要说明它如何影响这个目标<br/>
              · A 修订时必须证明新版本"更好地达成这个目标"<br/>
              · 整合者的综合答案会评估对这个目标的达成度
            </div>

            <ErrorCard />

            <div className="flex gap-2">
              <button
                onClick={() => { setStage('input'); setEditingGoal(false); }}
                className="px-4 py-2.5 border border-stone-200 text-stone-700 rounded-xl text-sm hover:bg-stone-50 transition"
              >
                返回
              </button>
              <button
                onClick={runDebate}
                disabled={!firstPrinciple.trim() || loading}
                className="flex-1 bg-stone-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-stone-800 disabled:opacity-40 transition flex items-center justify-center gap-2"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> 启动中……</> : <>确认并开始对抗式 review <ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === 运行/完成页 ===
  return (
    <div className="min-h-screen bg-stone-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* 顶栏 */}
        <div className="bg-white rounded-t-2xl border border-stone-200 border-b-0 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-blue-100 text-blue-800 flex items-center justify-center font-medium text-xs">L</div>
            <span className="font-medium text-sm">左脚踩右脚</span>
            <span className="ml-2 text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">深度模式</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyEntireConversation}
              disabled={rounds.length === 0}
              className="text-xs px-3 py-1.5 rounded-md border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-50 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="复制整段对话"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-700" />
                  <span className="text-green-700">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  复制全部
                </>
              )}
            </button>
            <button
              onClick={reset}
              className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1 px-2 py-1.5"
            >
              <RotateCw className="w-3 h-3" /> 重新开始
            </button>
          </div>
        </div>

        {/* 第一性目标锚条 */}
        {firstPrinciple && (
          <div className="bg-amber-50/60 border-x border-amber-200 px-5 py-2.5 flex items-start gap-2 border-b border-amber-200">
            <Target className="w-3.5 h-3.5 text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-amber-700 uppercase tracking-wider font-medium mb-0.5">第一性目标 · 锚定全场</div>
              <div className="text-xs text-amber-900 font-medium leading-relaxed">{firstPrinciple}</div>
            </div>
          </div>
        )}

        {/* 问题 */}
        <div className="bg-stone-50 border-x border-stone-200 px-5 py-4 border-b border-stone-200">
          <div className="text-xs text-stone-500 mb-1">我的问题</div>
          <div className="text-sm font-medium text-stone-900">{question}</div>
        </div>

        {/* 对话区 */}
        <div ref={scrollRef} onScroll={handleScroll} className="bg-white border-x border-stone-200 max-h-[60vh] overflow-y-auto relative">
          <div ref={conversationRef}>
          {rounds.map((r, idx) => {
            if (r.role === 'A') {
              return (
                <div key={idx} data-source-label={`A 的 ${r.version}`} className="border-b border-stone-100 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center text-sm font-medium">A</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium flex items-center gap-2">
                        主答者 A
                        <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-medium">{r.model || providerNames.providerA}</span>
                      </div>
                      <div className="text-xs text-stone-500">
                        Round {r.round} · {r.version} · {r.status === 'streaming' ? '正在生成…' : '深度回答'}
                      </div>
                    </div>
                    <span className="text-xs px-2 py-1 bg-purple-50 text-purple-800 rounded-full border border-purple-200">{r.version}</span>
                  </div>
                  <div className="text-sm text-stone-700 leading-relaxed pl-10 select-text">
                    {r.content
                      ? renderMarkdown(r.content)
                      : <span className="text-stone-400 italic">思考中…</span>}
                    {r.status === 'streaming' && (
                      <span className="inline-block w-[2px] h-4 bg-purple-500 ml-0.5 align-middle animate-pulse" />
                    )}
                  </div>
                </div>
              );
            }
            if (r.role === 'B') {
              // status: 'pending'（B 还在评审）/ 'done'（评审完成）/ 'failed'（评审失败）
              const status = r.status || 'done';

              // pending：B 还在后台跑，A 答案下方显示一个轻量占位条
              if (status === 'pending') {
                return (
                  <div key={idx} className="border-b border-stone-100 px-5 py-3 bg-stone-50/60">
                    <div className="flex items-center gap-2.5 text-xs text-stone-500">
                      <span className="w-5 h-5 rounded-md bg-stone-200 text-stone-600 flex items-center justify-center font-medium text-[11px]">B</span>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
                      <span>{r.model || providerNames.providerB} 正在评审中……</span>
                    </div>
                  </div>
                );
              }

              // failed：B 失败了，可关闭
              if (status === 'failed') {
                if (r.dismissed) return null; // 用户关掉就不显示
                return (
                  <div key={idx} className="border-b border-stone-100 px-5 py-2.5 bg-red-50/30">
                    <div className="flex items-center justify-between gap-3 text-xs text-red-700">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>评审者 B 评审未完成（可忽略，不影响后续讨论）</span>
                      </div>
                      <button
                        onClick={() => dismissFailedB(r.round)}
                        className="text-red-500 hover:text-red-900 text-[11px] px-2 py-0.5 rounded hover:bg-red-100/60 transition"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                );
              }

              // 解析评级，决定颜色
              const rating = parseRating(r.content);
              const style = (rating && ratingStyles[rating]) || defaultBStyle;

              // done 折叠状态（用户主动收起后）
              if (!r.expanded) {
                return (
                  <div key={idx} className={`border-b border-stone-100 ${style.cardBg}`}>
                    <button
                      onClick={() => toggleBExpanded(r.round)}
                      className={`w-full px-5 py-3 flex items-center justify-center gap-3 text-xs ${style.dotText} hover:opacity-80 transition group`}
                    >
                      <span className="opacity-30">···</span>
                      <span className={`w-5 h-5 rounded-md ${style.dotBg} ${style.dotText} flex items-center justify-center font-medium text-[11px]`}>B</span>
                      <span className="font-medium">
                        {r.model || providerNames.providerB}
                        {rating && <span className={`ml-1.5 px-1.5 py-0.5 rounded ${style.tag} text-[10px] font-semibold`}>{rating}</span>}
                        <span className="ml-1.5">已给出审视意见</span>
                      </span>
                      <ChevronRight className={`w-3.5 h-3.5 ${style.subText} group-hover:translate-x-0.5 transition`} />
                      <span className="opacity-30">···</span>
                    </button>
                  </div>
                );
              }

              // done 展开（默认）：完整卡片，附带折叠按钮
              return (
                <div key={idx} data-source-label={`B 的 Round ${r.round} 审查`} className={`border-b border-stone-100 p-5 ${style.cardBg}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg ${style.dotBg} ${style.dotText} flex items-center justify-center text-sm font-medium`}>B</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium flex items-center gap-2">
                        独立评审 B
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${style.tag}`}>{r.model || providerNames.providerB}</span>
                        {rating && <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${style.tag}`}>评级 {rating}</span>}
                      </div>
                      <div className={`text-xs ${style.subText}`}>Round {r.round} · {rating ? `${rating} 级评审` : '独立评审'}</div>
                    </div>
                    <button
                      onClick={() => toggleBExpanded(r.round)}
                      className="text-xs text-stone-500 hover:text-stone-900 px-2 py-1 rounded hover:bg-white/60 transition"
                    >
                      收起
                    </button>
                  </div>
                  <div className="text-sm text-stone-700 leading-relaxed pl-10 select-text">{renderCritique(r.content)}</div>
                </div>
              );
            }
            if (r.role === 'JUDGE') {
              return (
                <div key={idx} data-source-label={`我之前的裁判意见`} className="border-b border-stone-100 p-5 bg-blue-50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center text-sm font-medium">我</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-blue-900 flex items-center gap-1.5"><Gavel className="w-3.5 h-3.5" /> 裁判介入</div>
                      <div className="text-xs text-blue-700">用户作为最终决策者</div>
                    </div>
                  </div>
                  <div className="text-sm text-blue-900 leading-relaxed pl-10 select-text whitespace-pre-wrap">{r.content}</div>
                </div>
              );
            }
            if (r.role === 'FINAL') {
              return (
                <div key={idx} data-source-label={`最终答案`} className="border-b border-stone-100 p-5 bg-gradient-to-b from-green-50/50 to-white">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-green-700 text-white flex items-center justify-center"><Target className="w-4 h-4" /></div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-green-900 flex items-center gap-2">
                        整合者 · 综合答案
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-800 rounded font-medium">{r.model || providerNames.providerA}</span>
                      </div>
                      <div className="text-xs text-green-700">
                        {r.status === 'streaming' ? '整合者正在综合双方答案…' : '站在第一性目标的高度，融合 A 与 B 的洞察'}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-stone-800 leading-relaxed pl-10 select-text">
                    {r.content
                      ? renderMarkdown(r.content)
                      : <span className="text-stone-400 italic">综合中…</span>}
                    {r.status === 'streaming' && (
                      <span className="inline-block w-[2px] h-4 bg-green-600 ml-0.5 align-middle animate-pulse" />
                    )}
                  </div>
                </div>
              );
            }
            return null;
          })}
          </div>

          {/* 当前进行中的步骤 */}
          {currentStep && (
            <div className="p-5 flex items-center gap-3 text-sm text-stone-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{currentStep}</span>
            </div>
          )}

          {/* 划词引用浮动按钮 */}
          {selection && stage === 'running' && (
            <button
              onMouseDown={(e) => { e.preventDefault(); quoteToJudge(); }}
              className="absolute z-10 bg-stone-900 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 hover:bg-stone-800 transition"
              style={{
                left: `${Math.max(60, Math.min(selection.x, 600))}px`,
                top: `${Math.max(0, selection.y - 38)}px`,
                transform: 'translateX(-50%)',
              }}
            >
              <Quote className="w-3 h-3" />
              引用到裁判意见
            </button>
          )}

          {/* B 已给出审查意见的浮动提示（像微信"新消息"那样） */}
          {newBToast && (
            <button
              onClick={() => {
                // 点击：滚到该 round 的 B 位置 + 关闭提示
                const targetRound = newBToast.roundNum;
                setNewBToast(null);
                // 尝试找到对应的 B 卡片元素并滚动到它
                requestAnimationFrame(() => {
                  const container = scrollRef.current;
                  if (!container) return;
                  const cards = container.querySelectorAll('[data-source-label]');
                  for (const card of cards) {
                    const label = card.getAttribute('data-source-label') || '';
                    if (label.includes(`B 的 Round ${targetRound}`)) {
                      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      break;
                    }
                  }
                });
              }}
              className={`absolute bottom-4 right-4 z-20 ${((newBToast.rating && ratingStyles[newBToast.rating]) || defaultBStyle).toastBg} text-white text-xs px-3.5 py-2 rounded-full shadow-lg flex items-center gap-2 transition animate-bounce-once`}
              style={{ animation: 'fadeInUp 0.3s ease-out' }}
            >
              <span className="w-4 h-4 rounded-md bg-white/20 flex items-center justify-center font-medium text-[10px]">B</span>
              <span>
                {newBToast.modelName || providerNames.providerB}
                {newBToast.rating && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-white/25 rounded text-[10px] font-bold">{newBToast.rating}</span>
                )}
                <span className="ml-1.5">已给出审视意见</span>
              </span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 底部操作 */}
        {stage === 'running' && !loading && rounds.length > 0 && (
          <div className="bg-white border-x border-b border-stone-200 rounded-b-2xl p-4">
            <textarea
              ref={judgeInputRef}
              value={judgeInput}
              onChange={(e) => setJudgeInput(e.target.value)}
              placeholder="作为裁判，补充信息、表态、或指定下一轮重点……（在上方划选文字可直接引用）"
              className="w-full p-3 border border-stone-200 rounded-lg text-sm resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mb-3 whitespace-pre-wrap"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={submitJudgeAndContinue}
                disabled={converging}
                className="flex-1 bg-stone-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-stone-800 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {judgeInput.trim() ? <><Send className="w-4 h-4" /> 提交裁判意见并继续下一轮</> : <><ChevronRight className="w-4 h-4" /> 让它们继续下一轮</>}
              </button>
              {converging ? (
                <button
                  onClick={stopConverge}
                  className="px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-1.5 transition"
                >
                  <Pause className="w-4 h-4" /> 停止整合，继续 battle
                </button>
              ) : (
                <button
                  onClick={converge}
                  className="px-4 py-2.5 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 flex items-center gap-1.5 transition"
                >
                  <Target className="w-4 h-4" /> 整合者：综合答案
                </button>
              )}
            </div>
          </div>
        )}

        {stage === 'running' && loading && (
          <div className="bg-white border-x border-b border-stone-200 rounded-b-2xl p-5 text-center text-xs text-stone-400">
            两个 AI 正在工作中，请稍候……
          </div>
        )}

        {stage === 'done' && (
          <div className="bg-white border-x border-b border-stone-200 rounded-b-2xl p-4 flex gap-2">
            <button
              onClick={() => {
                const text = rounds.map(r => {
                  if (r.role === 'FINAL') return `## 最终答案\n${r.content}`;
                  return '';
                }).filter(Boolean).join('\n\n');
                navigator.clipboard.writeText(text);
              }}
              className="flex-1 border border-stone-200 py-2.5 rounded-lg text-sm hover:bg-stone-50 transition"
            >
              复制最终答案
            </button>
            <button
              onClick={reset}
              className="flex-1 bg-stone-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-stone-800 transition"
            >
              问下一个问题
            </button>
          </div>
        )}

        {error && <div className="mt-3"><ErrorCard /></div>}
      </div>
    </div>
  );
}
