// 本地历史记录（localStorage 版，验证阶段用）
// 只存在用户自己的浏览器里，不上传服务器，换设备/清缓存会丢失
// 验证"用户会不会回来看历史、会不会重复使用"

const STORAGE_KEY = 'lfrf_history_v1';
const MAX_ENTRIES = 20; // 最多保留最近 20 条，超出删最旧的

// 读取全部历史，返回数组（最新的在前）。出错返回空数组
export function loadHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// 保存一条新历史。entry 形如：
// { question, firstPrinciple, rounds, docName, providerNames }
// 自动补 id 和 createdAt，插到最前面，并裁剪到 MAX_ENTRIES
export function saveHistoryEntry(entry) {
  if (typeof window === 'undefined') return null;
  try {
    const list = loadHistory();
    const record = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      ...entry,
    };
    const next = [record, ...list].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return record;
  } catch (e) {
    // localStorage 满了或被禁用：静默失败，不影响主流程
    return null;
  }
}

// 删除一条
export function deleteHistoryEntry(id) {
  if (typeof window === 'undefined') return;
  try {
    const list = loadHistory().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {}
}

// 清空全部
export function clearHistory() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

// 把时间戳格式化成「几分钟前 / 今天 HH:mm / MM-DD HH:mm」
export function formatTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date();
  const isToday = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  if (isToday) return `今天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
