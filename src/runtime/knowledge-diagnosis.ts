import { existsSync } from 'node:fs';
import type { SuperHelperConfig } from '../config.js';
import type { AnswerGoal, DiagnosticClaim, DiagnosticRequest, DiagnosticResult, Evidence, UserPersona } from '../domain.js';
import {
  discoverKnowledgeDocuments,
  knowledgeRoot,
  routeKnowledgeQuestion,
  type KnowledgeEvidencePack,
  type KnowledgeDocument,
  type KnowledgeRoute,
  type KnowledgeSearchQuery,
  type KnowledgeVisibility,
} from '../knowledge/index.js';
import {
  retrieveKnowledgeWithConfiguredRetrieval,
  type ConfiguredKnowledgeRetrievalResult,
} from '../retrieval/configured-search.js';
import type { RetrievalTrace } from '../retrieval/types.js';
import { DIRECT_ANSWER_ITEM } from './answer-goal.js';
import { attachDeepQueryContext, planDeepQuery } from './deep-query-planner.js';
import { judgeKnowledgeEvidence, type EvidenceJudgeResult } from './evidence-judge.js';
import type { RagAnswerabilityResult } from './rag-answerability-service.js';

export async function retrieveKnowledgeForRuntime(input: {
  config: SuperHelperConfig;
  query: KnowledgeSearchQuery;
}): Promise<ConfiguredKnowledgeRetrievalResult> {
  return retrieveKnowledgeWithConfiguredRetrieval({
    config: input.config,
    query: input.query,
  });
}

export async function prepareKnowledgeDiagnosis(input: {
  config: SuperHelperConfig;
  workspaceRoot: string;
  question: string;
  persona: UserPersona;
}): Promise<{
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  retrievalTrace: RetrievalTrace;
  glossaryTerms: string[];
} | undefined> {
  if (!existsSync(knowledgeRoot(input.workspaceRoot))) {
    return undefined;
  }
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  if (docs.length === 0) {
    return undefined;
  }

  const route = routeKnowledgeQuestion({
    workspaceRoot: input.workspaceRoot,
    question: input.question,
  });
  let retrieval = await retrieveKnowledgeForRuntime({
    config: input.config,
    query: {
      workspaceRoot: input.workspaceRoot,
      query: input.question,
      moduleCandidates: route.moduleCandidates,
      intentCandidates: route.intentCandidates,
      sourceTypes: route.sourceTypes,
      visibility: knowledgeVisibilityForPersona(input.persona),
      limit: 8,
    },
  });
  if (retrieval.evidencePack.results.length === 0 && route.sourceTypes.length > 0) {
    retrieval = await retrieveKnowledgeForRuntime({
      config: input.config,
      query: {
        workspaceRoot: input.workspaceRoot,
        query: input.question,
        moduleCandidates: route.moduleCandidates,
        intentCandidates: route.intentCandidates,
        visibility: knowledgeVisibilityForPersona(input.persona),
        limit: 8,
      },
    });
  }
  const { evidencePack, trace: retrievalTrace } = retrieval;
  const judge = judgeKnowledgeEvidence({
    route,
    evidencePack,
    question: input.question,
  });
  return { route, evidencePack, judge, retrievalTrace, glossaryTerms: glossaryTermsFromDocuments(docs) };
}

export function attachKnowledgeCodeEscalationContext(input: {
  request: DiagnosticRequest;
  question: string;
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  projectType?: string;
  glossaryTerms?: string[];
  answerability?: RagAnswerabilityResult;
}): void {
  const deepQuery = planDeepQuery({
    question: input.question,
    route: input.route,
    evidencePack: input.evidencePack,
    judge: input.judge,
    projectType: input.projectType,
    glossaryTerms: input.glossaryTerms,
    answerability: input.answerability,
  });
  attachDeepQueryContext({
    request: input.request,
    route: input.route,
    evidencePack: input.evidencePack,
    judge: input.judge,
    deepQuery,
  });
  if (input.answerability) {
    input.request.context!.knowledge!.answerability = summarizeRagAnswerability(input.answerability);
    input.request.knownFacts = Array.from(new Set([
      ...input.request.knownFacts,
      ...input.answerability.coveredClaims.map((claim) => `知识库可用结论：${claim.text}`),
    ]));
    input.request.unknowns = Array.from(new Set([
      ...input.request.unknowns,
      ...input.answerability.missingElements.map((item) => `知识库缺失答案要素：${item}`),
    ]));
    input.request.constraints = Array.from(new Set([
      ...input.request.constraints,
      `知识库 Answerability 判断：${input.answerability.reason || input.answerability.answerability}`,
      `代码排查优先补齐：${input.answerability.escalationFocus || input.answerability.missingElements.join('、') || '原问题缺失答案要素'}`,
    ]));
  }
}

export function glossaryTermsFromDocuments(documents: KnowledgeDocument[]): string[] {
  return Array.from(new Set(documents
    .filter((document) => (
      document.frontmatter.type === 'glossary_term' ||
      document.frontmatter.source_type === 'glossary' ||
      document.relativePath.startsWith('glossary/')
    ))
    .flatMap((document) => [
      document.frontmatter.title,
      ...document.frontmatter.related_terms,
      ...document.headings,
    ])
    .map((term) => term.trim())
    .filter(Boolean)));
}

export function diagnosticResultFromKnowledge(input: {
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  route: KnowledgeRoute;
  answerability?: RagAnswerabilityResult;
  answerGoal?: AnswerGoal;
}): DiagnosticResult {
  const exactItems = input.answerGoal?.mustAnswerItems ?? [DIRECT_ANSWER_ITEM];
  const answerEvidence = input.evidencePack.results.filter((result) => result.status === 'active');
  const evidence: Evidence[] = answerEvidence.slice(0, 6).map((result) => ({
    id: result.evidence_id,
    kind: 'knowledge',
    source: sourceLabel(result),
    summary: `${result.title}：${result.answer_span ?? result.excerpt ?? result.summary}`,
    confidence: result.confidence,
    validation: {
      status: result.status === 'active' ? 'active' : result.status === 'review_required' ? 'review_required' : result.status === 'deprecated' ? 'deprecated' : 'inactive',
      visibility: result.visibility,
      lastVerifiedAt: result.last_verified_at,
      quality: result.quality?.severity,
    },
  }));
  const top = answerEvidence[0];
  const summary = top
    ? `知识库命中「${top.title}」，可回答：${top.answer_span ?? top.excerpt ?? top.summary}`
    : '知识库证据足够回答当前问题。';

  if (input.answerability?.answerability === 'full' && input.answerability.coveredClaims.length > 0) {
    return diagnosticCoveredClaimsResult({
      evidence,
      answerability: input.answerability,
      judge: input.judge,
      route: input.route,
      exactItems,
    });
  }

  if (isFeatureOverviewRoute(input.route) || answerEvidence.length > 1) {
    return diagnosticFeatureOverviewResult({
      evidence,
      answerEvidence,
      exactItems,
    });
  }

  return {
    status: 'concluded',
    summary,
    missingInfo: [],
    evidence,
    claims: [
      {
        type: 'fact',
        role: 'primary_answer',
        text: summary,
        evidenceIds: evidence.map((item) => item.id),
        answers: exactItems,
      },
      {
        type: 'inference',
        role: 'supporting_context',
        text: `Evidence Judge 判定知识证据可直接回答，answer_score=${input.judge.answer_score}，模块候选：${input.route.moduleCandidates.join('、') || '未限定'}`,
        evidenceIds: evidence.map((item) => item.id),
        answers: [],
      },
    ],
    recommendedNextAction: 'final_answer',
  };
}

function diagnosticCoveredClaimsResult(input: {
  evidence: Evidence[];
  answerability: RagAnswerabilityResult;
  judge: EvidenceJudgeResult;
  route: KnowledgeRoute;
  exactItems: string[];
}): DiagnosticResult {
  const validEvidenceIds = new Set(input.evidence.map((item) => item.id));
  const claims: DiagnosticClaim[] = input.answerability.coveredClaims
    .map((claim) => ({
      id: claim.id,
      type: 'fact' as const,
      role: 'primary_answer' as const,
      text: cleanKnowledgeText(claim.text),
      evidenceIds: claim.evidenceIds.filter((evidenceId) => validEvidenceIds.has(evidenceId)),
      answers: input.exactItems.filter((item) => claim.coveredRequirementIds.includes(item)),
    }))
    .filter((claim, index, all) => (
      claim.text &&
      claim.evidenceIds.length > 0 &&
      all.findIndex((item) => item.text === claim.text) === index
    ));
  const evidenceIds = claims.length > 0
    ? Array.from(new Set(claims.flatMap((claim) => claim.evidenceIds)))
    : input.evidence.map((item) => item.id);
  const summary = claims.length > 0
    ? `知识库已覆盖当前问题：${claims.map((claim) => claim.text).join('；')}`
    : '知识库证据足够回答当前问题。';

  return {
    status: 'concluded',
    summary,
    missingInfo: [],
    evidence: input.evidence,
    claims: [
      ...claims,
      {
        type: 'inference',
        role: 'supporting_context',
        text: `RAG Answerability 判定知识证据覆盖当前问题，answer_score=${input.judge.answer_score}，模块候选：${input.route.moduleCandidates.join('、') || '未限定'}`,
        evidenceIds,
        answers: [],
      },
    ],
    recommendedNextAction: 'final_answer',
  };
}

function summarizeRagAnswerability(
  answerability: RagAnswerabilityResult,
): NonNullable<NonNullable<DiagnosticRequest['context']>['knowledge']>['answerability'] {
  return {
    answerability: answerability.answerability,
    selectedEvidenceIds: [...answerability.selectedEvidenceIds],
    coveredClaims: answerability.coveredClaims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      evidenceIds: [...claim.evidenceIds],
      coveredRequirementIds: [...claim.coveredRequirementIds],
      usefulness: claim.usefulness,
    })),
    missingElements: [...answerability.missingElements],
    shouldEscalate: answerability.shouldEscalate,
    escalationFocus: answerability.escalationFocus,
    reason: answerability.reason,
  };
}

function diagnosticFeatureOverviewResult(input: {
  evidence: Evidence[];
  answerEvidence: KnowledgeEvidencePack['results'];
  exactItems: string[];
}): DiagnosticResult {
  const selected = input.answerEvidence.slice(0, 6);
  const claims: DiagnosticClaim[] = selected
    .map((result) => ({
      type: 'fact' as const,
      role: 'primary_answer' as const,
      text: featureFactText(result),
      evidenceIds: [result.evidence_id],
      answers: input.exactItems,
    }))
    .filter((claim, index, all) => (
      claim.text &&
      all.findIndex((item) => item.text === claim.text) === index
    ));
  const summary = claims.length > 0
    ? `知识库可回答功能概览：${claims.map((claim) => featureNameFromClaim(claim.text)).join('、')}`
    : '知识库证据足够回答当前功能概览问题。';

  return {
    status: 'concluded',
    summary,
    missingInfo: [],
    evidence: input.evidence,
    claims,
    recommendedNextAction: 'final_answer',
  };
}

function isFeatureOverviewRoute(route: KnowledgeRoute): boolean {
  return route.intentCandidates.includes('feature_overview');
}

function featureFactText(result: KnowledgeEvidencePack['results'][number]): string {
  const body = cleanKnowledgeText(result.answer_span ?? result.excerpt ?? result.summary);
  const title = cleanKnowledgeText(result.title);
  if (!body) {
    return title;
  }
  if (!title || body.includes(title)) {
    return body;
  }
  return `${title}：${body}`;
}

function featureNameFromClaim(text: string): string {
  return text.split(/[：:]/)[0]?.trim() || text.slice(0, 24);
}

function cleanKnowledgeText(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function knowledgeVisibilityForPersona(persona: UserPersona): KnowledgeVisibility[] {
  if (persona === 'customer') {
    return ['customer_safe'];
  }
  if (persona === 'operations') {
    return ['customer_safe', 'internal'];
  }
  return ['customer_safe', 'internal', 'support'];
}

function sourceLabel(result: KnowledgeEvidencePack['results'][number]): string {
  const pages = result.source_pages?.length ? ` pages=${result.source_pages.join(',')}` : '';
  const sourceDocument = result.source_document ? ` source=${result.source_document}` : '';
  return `${result.source}${sourceDocument}${pages}`;
}
