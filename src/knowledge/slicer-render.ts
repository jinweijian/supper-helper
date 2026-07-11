import { createHash } from 'node:crypto';
import type { KnowledgeNormalizedBlock, KnowledgePipelineStage, KnowledgePipelineStatus, KnowledgeStatus } from './types.js';

export function blockText(block: KnowledgeNormalizedBlock): string {
  return (block.normalized_text || block.text || '').trim();
}

export function renderBody(blocks: KnowledgeNormalizedBlock[], minChars: number, warnings: string[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      lines.push(`### ${block.text}`);
      continue;
    }
    const text = blockText(block);
    lines.push(text);
  }
  const body = lines.join('\n\n').trim();
  if (body.length < minChars) {
    warnings.push(`Generated slice body length (${body.length}) below min (${minChars}).`);
  }
  return body;
}

export function renderDraftSlice(input: {
  id: string;
  title: string;
  module: string;
  sourceDocumentId: string;
  sourceDocumentPath?: string;
  sourceTitle: string;
  sectionPath: string[];
  sourceBlockIds: string[];
  body: string;
  firstBlockId?: string;
  lastBlockId?: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const relatedTerms = Array.from(new Set([input.title, ...input.sectionPath, input.sourceTitle].filter(Boolean))).slice(0, 12);
  const stage: KnowledgePipelineStage = 'slice';
  const status: KnowledgePipelineStatus = 'draft';
  const docStatus: KnowledgeStatus = 'draft';
  return `---
id: ${input.id}
title: ${yamlScalar(input.title)}
type: whitepaper_slice
module: ${input.module}
intent: product_rule
source_type: whitepaper
confidence: medium
status: ${docStatus}
visibility: internal
product_versions: []
related_terms:
${yamlArray(relatedTerms)}
related_repos: []
last_verified_at: ${today}
owner: knowledge-admin
source_document_id: ${input.sourceDocumentId}
${input.sourceDocumentPath ? `source_document: ${input.sourceDocumentPath}\n` : ''}source_block_ids:
${yamlArray(input.sourceBlockIds)}
section_path:
${yamlArray(input.sectionPath)}
chunking_strategy: parent-child-v3
pipeline_stage: ${stage}
pipeline_status: ${status}
quality_status: unchecked
first_source_block_id: ${input.firstBlockId ?? ''}
last_source_block_id: ${input.lastBlockId ?? ''}
---

# ${input.title}

## 核心内容

${input.body}

## 原文来源

- source_document_id: ${input.sourceDocumentId}
- section_path: ${input.sectionPath.join(' > ')}
- source_block_ids: ${input.sourceBlockIds.join(', ')}
`;
}

export function inferModule(sourceTitle: string, body: string): string {
  const text = `${sourceTitle}\n${body.slice(0, 4000)}`;
  if (/AI伴学|伴学助手|学习计划|督学提醒|题目答疑/.test(text)) {
    return 'ai-companion';
  }
  if (/EduSoho|教培|课程|班级|学员|教师|网校/.test(text)) {
    return 'edusoho-training';
  }
  return 'general';
}

export function safeSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function yamlScalar(value: string): string {
  return /[:#\[\]{},"']|\s$|^\s/.test(value) ? JSON.stringify(value) : value;
}

function yamlArray(values: string[]): string {
  if (values.length === 0) {
    return '  []';
  }
  return values.map((value) => `  - ${yamlScalar(value)}`).join('\n');
}
