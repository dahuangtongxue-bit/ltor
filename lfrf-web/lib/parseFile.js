// 前端文件解析模块
// 全部在浏览器里解析，只把提取出的纯文本交给上层，不上传文件到服务器
//
// 支持：txt / md / html / docx / xlsx / xls / csv / pdf（文字版）
// 不支持：图片、ppt（下一期）；扫描版 PDF（无文字层）会提示无法识别

export const MAX_CHARS = 20000; // 文档纯文本上限，约 1.5 万 token

// 文件类型判断（靠扩展名 + MIME 兜底）
function getFileKind(file) {
  const name = (file.name || '').toLowerCase();
  const ext = name.split('.').pop();

  if (['txt', 'md', 'markdown', 'csv', 'log', 'json'].includes(ext)) return 'text';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (ext === 'docx') return 'docx';
  if (['xlsx', 'xls'].includes(ext)) return 'xlsx';
  if (ext === 'pdf') return 'pdf';

  // 扩展名不可靠时，看 MIME
  const type = file.type || '';
  if (type.startsWith('text/html')) return 'html';
  if (type.startsWith('text/')) return 'text';
  if (type.includes('wordprocessingml')) return 'docx';
  if (type.includes('spreadsheetml') || type.includes('ms-excel')) return 'xlsx';
  if (type === 'application/pdf') return 'pdf';

  return 'unsupported';
}

// HTML 去标签，保留可读文本
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // 去掉 script / style
  doc.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  const text = doc.body ? doc.body.innerText || doc.body.textContent || '' : '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

async function parseText(file) {
  return await file.text();
}

async function parseHtml(file) {
  const raw = await file.text();
  return htmlToText(raw);
}

async function parseDocx(file) {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return (result.value || '').trim();
}

async function parseXlsx(file) {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const parts = [];
  wb.SheetNames.forEach(sheetName => {
    const sheet = wb.Sheets[sheetName];
    // 转成 CSV 文本，保留表格结构
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      parts.push(`【工作表：${sheetName}】\n${csv.trim()}`);
    }
  });
  return parts.join('\n\n');
}

async function parsePdf(file) {
  const pdfjsLib = await import('pdfjs-dist');
  // worker 指向 CDN（与安装版本一致）
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages = [];
  const maxPages = Math.min(pdf.numPages, 50); // 最多读 50 页，防超大 PDF 卡死
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    if (pageText.trim()) pages.push(pageText.trim());
  }

  const text = pages.join('\n\n');
  // 文字层为空 → 大概率是扫描版 PDF
  if (!text.trim()) {
    throw new Error('SCANNED_PDF');
  }
  return text;
}

// 主入口：解析文件 → { text, truncated, charCount, kind }
export async function parseFile(file) {
  const kind = getFileKind(file);

  if (kind === 'unsupported') {
    throw new Error('UNSUPPORTED_TYPE');
  }

  let text = '';
  try {
    if (kind === 'text') text = await parseText(file);
    else if (kind === 'html') text = await parseHtml(file);
    else if (kind === 'docx') text = await parseDocx(file);
    else if (kind === 'xlsx') text = await parseXlsx(file);
    else if (kind === 'pdf') text = await parsePdf(file);
  } catch (e) {
    if (e.message === 'SCANNED_PDF') throw e;
    // 解析库内部报错
    const err = new Error('PARSE_FAILED');
    err.detail = e.message;
    throw err;
  }

  text = (text || '').trim();
  if (!text) {
    throw new Error('EMPTY_CONTENT');
  }

  const fullCount = text.length;
  let truncated = false;
  if (fullCount > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }

  return {
    text,
    truncated,
    charCount: fullCount,
    kind,
  };
}

// 友好的错误信息
export function describeParseError(e) {
  switch (e.message) {
    case 'UNSUPPORTED_TYPE':
      return '暂不支持这个文件类型。当前支持：txt / md / html / Word(docx) / Excel(xlsx) / PDF（文字版）。图片和 PPT 暂未支持。';
    case 'SCANNED_PDF':
      return '这个 PDF 似乎是扫描件（没有文字层），目前无法识别其中的文字。请换用文字版 PDF，或把内容转成 Word/文本后再上传。';
    case 'EMPTY_CONTENT':
      return '没能从这个文件里提取到任何文字内容。';
    case 'PARSE_FAILED':
      return `文件解析失败${e.detail ? `（${e.detail}）` : ''}。可以换个格式再试。`;
    default:
      return `文件处理出错：${e.message}`;
  }
}
