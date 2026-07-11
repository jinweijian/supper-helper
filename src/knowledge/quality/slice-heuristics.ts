import type { KnowledgeDocument } from '../types.js';

const COREFERENCE_TERMS = ['该功能', '上述', '如下图', '该配置', '该流程', '此功能', '该模块', '本节', '上面提到', '如下所示'];
const ANSWER_BEARING_PATTERNS = [
  /(当|如果|若|在).{2,30}(时|情况|条件下|之后)/,
  /步骤[一二三四五六七八九十0-9]+/,
  /[一二三四五六七八九十0-9]+[\.、]/,
  /支持|不支持|会|不会|需要|必须|返回|提示|提醒|开通|关闭|开启/,
  /(会|不会).{0,20}(提醒|提示|开通|触发|记录|通知|发送)/,
  /学习日.{0,15}(提醒|未完成|任务)/,
  /(search|搜索).{0,20}(按|根据|通过|支持)/i,
];

export function isTocLike(doc: KnowledgeDocument): boolean {
  const lines = doc.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const shortLines = lines.filter((line) => line.length < 60);
  if (shortLines.length / lines.length < 0.7) return false;
  const numbered = lines.filter((line) => /^[一二三四五六七八九十0-9]+[、\.]/.test(line) || /^第[一二三四五六七八九十百千]+/i.test(line));
  return numbered.length >= Math.min(5, lines.length / 2) || (/目录/.test(doc.body) && lines.length < 20);
}

export function isHeadingOnly(doc: KnowledgeDocument, body: string): boolean {
  if (!body) return false;
  return (doc.body.match(/^#{1,6}\s+/gm) ?? []).length > 1 && body.length < 80;
}

export function isMultiTopic(doc: KnowledgeDocument, threshold: number): boolean {
  const headings = (doc.body.match(/^#{1,4}\s+(.+)$/gm) ?? [])
    .map((heading) => heading.replace(/^#{1,4}\s+/, '').trim())
    .filter((heading) => !['核心内容', '原文来源'].includes(heading));
  if (headings.length < 2) return false;
  const tokens = headings.map((heading) => new Set(heading.match(/[一-龥]{2,}/g) ?? []));
  let shared = 0;
  let total = 0;
  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      total += 1;
      if ([...tokens[left]!].some((token) => tokens[right]!.has(token))) shared += 1;
    }
  }
  return total > 0 && shared / total < 0.3 && headings.length >= threshold;
}

export function isBrokenCoreference(body: string): boolean {
  const text = body.replace(/\s+/g, '');
  return COREFERENCE_TERMS.filter((term) => text.includes(term)).length >= 2;
}

export function hasAnswerBearingSentence(body: string): boolean {
  return body.split(/[\n。；;]/).map((sentence) => sentence.trim()).filter(Boolean)
    .some((sentence) => ANSWER_BEARING_PATTERNS.some((pattern) => pattern.test(sentence)));
}
