'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Pause, SkipForward, Target, Sparkles, AlertTriangle, Eye, FileSearch, Gavel, RotateCw, ChevronRight, Loader2, Copy, Check, Quote, Lock } from 'lucide-react';

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
  const scrollRef = useRef(null);
  const judgeInputRef = useRef(null);
  const conversationRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rounds, currentStep]);

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

  const copyEntireConversation = () => {
    const lines = [`# 问题\n${question}\n`];
    if (firstPrinciple) lines.push(`# 第一性目标\n${firstPrinciple}\n`);
    rounds.forEach((r) => {
      if (r.role === 'A') lines.push(`## 主答者 A · Round ${r.round} (${r.version})\n${r.content}\n`);
      else if (r.role === 'B') lines.push(`## 审查者 B · Round ${r.round}\n${r.content}\n`);
      else if (r.role === 'JUDGE') lines.push(`## 我（裁判）· Round ${r.round}\n${r.content}\n`);
      else if (r.role === 'FINAL') lines.push(`## 最终收敛答案\n${r.content}\n`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // 调用后端代理。role 决定走哪个 provider：
  //   'main' / 'synthesizer' / 'goal' → Provider A
  //   'critic' → Provider B
  // 自带最多 2 次指数退避重试
  const callClaude = async (systemPrompt, userMessage, opts = {}) => {
    const { role = 'main', maxTokens = 1500 } = opts;
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

        const data = await response.json();

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
- 不要为了简洁而牺牲深度。该展开就展开，该举例就举例，该讨论权衡就讨论权衡。
- 思考用户没说出口的隐含需求和边界条件。
- 如果问题涉及多种情境或选择，分别讨论每一种。
- 对关键论断给出推理过程，不要只下结论。
- 主动指出你不确定的地方，以及哪些信息能帮你给出更好答案。
- 在结尾用一句话回应"这个回答如何服务于第一性目标"。

风格：务实、深入、有判断力，不要过度免责声明，不要套话开场，直接进入实质内容。

输出结构（用 Markdown 组织，长度根据问题复杂度自定，不必刻意短）：
**核心判断 / 结论**
**展开分析**（含子小节、清单、对比，按需）
**关键权衡与不确定性**
**置信度评估**：XX%（并简述依据）
**对第一性目标的服务方式**：（1 句话）`;

  const SYSTEM_A_REVISE = (goal) => `你是"主答者 A"，由 Claude Opus 4.7 担任。审查者 B 对你的上一版答案提出了批评，用户作为裁判可能也给了介入意见。
请认真重写你的答案，给出一个比上版更深入、更全面、更对齐第一性目标的版本。

【第一性目标】（修订必须更好地服务于此）：
${goal}

修订原则：
1. 不是小修小补，而是基于反馈做实质性的深化和重组
2. 明确说明你改了什么、为什么改
3. 如果某些批评你不接受，明确说明并给出理由（不要为了迎合而妥协）
4. 该多写就多写，深度优先于篇幅控制

输出结构（用 Markdown）：
**修订后的核心判断**
**相比上版的关键改动**（要点形式，说明改了什么、为什么改）
**展开分析**（深度回答，含子小节）
**对批评的逐条回应**（接受 / 不接受 + 理由）
**剩余的不确定性**
**置信度评估**：XX%
**对第一性目标的服务方式**：（1 句话）`;

  // 角色 B 的 system prompt — 审查者，强制批判，但锚定第一性目标
  const SYSTEM_B = (goal) => `你是"审查者 B"。你的任务是找出主答者 A 的回答中影响"第一性目标"达成的关键问题。

【第一性目标】（你的北极星，所有批评必须最终服务于此）：
${goal}

工作方法（先发散，后收敛）：
第一步：发散思考——大胆提出 A 可能没想到的视角、风险、隐藏假设、跨领域类比。不要被 A 的框架限制。
第二步：收敛筛选——只保留那些"如果忽略就会显著影响第一性目标达成"的问题。次要的吹毛求疵全部舍弃。
第三步：每条批评结尾必须用一行说明"这如何影响第一性目标"。

强制要求：
- 必须找出至少 3 个、最多 5 个核心问题，禁止说"我同意"、"答案不错"
- 每个问题必须用以下三个类别之一标注：[事实存疑] / [忽略视角] / [逻辑漏洞]
- 站在用户利益角度，提出 A 可能没考虑到的关键盲点

输出格式（用 Markdown）：
**对齐第一性目标的总评：** （1 句话总结 A 的答案在达成第一性目标上的最大短板）

**问题清单：**

**1. [类别] 标题**
（2-3 句具体说明）
*对第一性目标的影响：* （1 句话说明此问题如何阻碍目标达成）

**2. [类别] 标题**
（2-3 句具体说明）
*对第一性目标的影响：* （1 句话）

**3. [类别] 标题**
（2-3 句具体说明）
*对第一性目标的影响：* （1 句话）

不要超过 450 字。直接进入批评，不要客套。`;

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

  // 第二步：在第一性目标确认后，真正开始辩论
  const runDebate = async () => {
    if (!firstPrinciple.trim()) return;
    setError('');
    setLastFailedAction(null);
    setStage('running');
    setRounds([]);
    setLoading(true);

    try {
      // Round 1 - A 主答（Provider A）
      setCurrentStep(`${providerNames.providerA} 正在深度思考第一轮答案……`);
      const aResult = await callClaude(
        SYSTEM_A_INITIAL(firstPrinciple),
        question,
        { role: 'main', maxTokens: 4000 }
      );
      const newRounds = [{ role: 'A', content: aResult.text, version: 'v1', round: 1, model: aResult.modelName }];
      setRounds([...newRounds]);

      // Round 1 - B 审查（Provider B）
      setCurrentStep(`${providerNames.providerB} 正在发散思考并锚定第一性目标进行审查……`);
      const bResult = await callClaude(
        SYSTEM_B(firstPrinciple),
        `用户的问题是：\n${question}\n\nA 的回答是：\n${aResult.text}\n\n请按"先发散后收敛"的方式输出你的审查批评，每条都要回答它如何影响第一性目标。`,
        { role: 'critic', maxTokens: 2000 }
      );
      newRounds.push({ role: 'B', content: bResult.text, round: 1, model: bResult.modelName });
      setRounds([...newRounds]);

      setCurrentStep('');
    } catch (e) {
      setError(e.message);
      setLastFailedAction(() => runDebate);
      // 留在 confirming-goal 页让用户能看到重试按钮
      setStage('confirming-goal');
      setCurrentStep('');
    } finally {
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

      // 拼接历史给 A
      const historyForA = currentRounds.map(r => {
        if (r.role === 'A') return `[A 的 ${r.version} 答案]\n${r.content}`;
        if (r.role === 'B') return `[B 的审查批评]\n${r.content}`;
        if (r.role === 'JUDGE') return `[用户裁判介入]\n${r.content}`;
        return '';
      }).join('\n\n---\n\n');

      setCurrentStep(`Round ${nextRoundNum} — ${providerNames.providerA} 正在深度修订答案……`);
      const aResult = await callClaude(
        SYSTEM_A_REVISE(firstPrinciple),
        `用户的原始问题：\n${question}\n\n讨论历史：\n${historyForA}\n\n请输出你的修订版答案。新答案必须比上版更好地达成第一性目标。`,
        { role: 'main', maxTokens: 4000 }
      );
      const version = `v${currentRounds.filter(r => r.role === 'A').length + 1}`;
      currentRounds.push({ role: 'A', content: aResult.text, version, round: nextRoundNum, model: aResult.modelName });
      setRounds([...currentRounds]);

      // B 再审
      setCurrentStep(`Round ${nextRoundNum} — ${providerNames.providerB} 正在围绕第一性目标审查 A 的修订版……`);
      const bResult = await callClaude(
        SYSTEM_B(firstPrinciple),
        `用户的问题：\n${question}\n\n这是 A 的修订版答案（${version}）：\n${aResult.text}\n\n请重点审查：A 是否在向第一性目标真正收敛？是否引入了新问题或新分歧？按格式输出。`,
        { role: 'critic', maxTokens: 2000 }
      );
      currentRounds.push({ role: 'B', content: bResult.text, round: nextRoundNum, model: bResult.modelName });
      setRounds([...currentRounds]);

      setCurrentStep('');
    } catch (e) {
      setError(e.message);
      setCurrentStep('');
      // 重试：保留当前 rounds（含已添加的 judge），重新跑剩余流程
      setLastFailedAction(() => submitJudgeAndContinue);
    } finally {
      setLoading(false);
    }
  };

  const converge = async () => {
    setLoading(true);
    setError('');
    try {
      setCurrentStep('正在生成最终收敛答案……');
      const history = rounds.map(r => {
        if (r.role === 'A') return `[A 的 ${r.version} 答案]\n${r.content}`;
        if (r.role === 'B') return `[B 的审查批评]\n${r.content}`;
        if (r.role === 'JUDGE') return `[用户裁判介入]\n${r.content}`;
        return '';
      }).join('\n\n---\n\n');

      const finalResult = await callClaude(
        `你是一个综合者。基于 A 和 B 的多轮对抗讨论以及用户的裁判介入，输出最终的、平衡的答案。

【第一性目标】（最终答案必须最好地服务于此）：
${firstPrinciple}

格式：
**最终结论**：（明确的、综合双方意见后的结论，必须直接回应第一性目标）
**关键支持理由**：（3-5 条，每条简要展开）
**A 和 B 的核心分歧及裁决**：（说明 A 和 B 在哪里仍有分歧，以及作为综合者你倾向哪边、为什么）
**对第一性目标的达成度评估**：（1-2 句，说明这个答案在多大程度上回答了用户最深层的需求）
**剩余的不确定性**
**置信度评估**：XX%
**给用户的具体行动建议**：（2-4 条可执行的下一步）

风格：深入、有判断力，不必刻意短。`,
        `用户原始问题：\n${question}\n\n完整讨论历史：\n${history}\n\n请输出最终收敛答案。`,
        { role: 'synthesizer', maxTokens: 3000 }
      );
      setRounds([...rounds, { role: 'FINAL', content: finalResult.text, model: finalResult.modelName }]);
      setStage('done');
      setCurrentStep('');
    } catch (e) {
      setError(e.message);
      setCurrentStep('');
      setLastFailedAction(() => converge);
    } finally {
      setLoading(false);
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
              已自动重试 2 次仍未成功。可能原因：API 限流、网络抖动，或当前环境不支持指定模型。
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
                <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded font-medium">审查 B</span>
                <span className="text-stone-500">{providerNames.providerB} · 强制批判</span>
              </div>
              <div className="text-stone-400 pt-1 border-t border-stone-100">跨家族对抗 · 你随时可作为裁判介入</div>
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
              · 最终收敛答案会评估对这个目标的达成度
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
        <div ref={scrollRef} className="bg-white border-x border-stone-200 max-h-[60vh] overflow-y-auto relative">
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
                      <div className="text-xs text-stone-500">Round {r.round} · {r.version} · 深度回答</div>
                    </div>
                    <span className="text-xs px-2 py-1 bg-purple-50 text-purple-800 rounded-full border border-purple-200">{r.version}</span>
                  </div>
                  <div className="text-sm text-stone-700 leading-relaxed pl-10 select-text">{renderMarkdown(r.content)}</div>
                </div>
              );
            }
            if (r.role === 'B') {
              return (
                <div key={idx} data-source-label={`B 的 Round ${r.round} 审查`} className="border-b border-stone-100 p-5 bg-orange-50/30">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-800 flex items-center justify-center text-sm font-medium">B</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium flex items-center gap-2">
                        审查者 B
                        <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-medium">{r.model || providerNames.providerB}</span>
                      </div>
                      <div className="text-xs text-stone-500">Round {r.round} · 强制批判</div>
                    </div>
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
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
                        最终收敛答案
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-800 rounded font-medium">{r.model || providerNames.providerA}</span>
                      </div>
                      <div className="text-xs text-green-700">综合双方观点 + 你的裁判意见</div>
                    </div>
                  </div>
                  <div className="text-sm text-stone-800 leading-relaxed pl-10 select-text">{renderMarkdown(r.content)}</div>
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
                className="flex-1 bg-stone-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-stone-800 flex items-center justify-center gap-2 transition"
              >
                {judgeInput.trim() ? <><Send className="w-4 h-4" /> 提交裁判意见并继续下一轮</> : <><ChevronRight className="w-4 h-4" /> 让它们继续下一轮</>}
              </button>
              <button
                onClick={converge}
                className="px-4 py-2.5 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 flex items-center gap-1.5 transition"
              >
                <Target className="w-4 h-4" /> 直接收敛
              </button>
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
