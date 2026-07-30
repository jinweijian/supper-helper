import type { KnowledgeEvidencePack, KnowledgeEvidenceResult, KnowledgeRoute } from '../knowledge/index.js';

export type EvidenceJudgeBlocker =
  | 'generic_keyword_only'
  | 'low_quality_evidence'
  | 'module_mismatch'
  | 'stale_knowledge'
  | 'conflicting_knowledge'
  | 'high_risk_uncertainty'
  | 'implementation_detail'
  | 'missing_answer_bearing_sentence'
  | 'no_active_evidence'
  | 'ambiguity'
  | 'low_signal_terms'
  | 'missing_provenance'
  | 'low_retrieval_confidence'
  | 'question_not_answered'
  | 'unknown_module';

export interface EvidenceJudgeScoreBreakdown {
  relevance: number;
  coverage: number;
  source_authority: number;
  freshness: number;
  version_match: number;
  agreement: number;
  actionability: number;
  conflict_penalty: number;
  ambiguity_penalty: number;
  risk_penalty: number;
  quality_penalty: number;
}

export interface EvidenceJudgeResult {
  answerable: boolean;
  confidence: 'low' | 'medium' | 'high';
  need_code_escalation: boolean;
  reason: string;
  rationale: string;
  evidence: string[];
  risks: string[];
  missing_info: string[];
  conflicts: string[];
  blockers: EvidenceJudgeBlocker[];
  ambiguity: string[];
  quality_issues: string[];
  recommended_next_action: 'final_answer' | 'dispatch_code_diagnosis' | 'ask_user' | 'escalate_to_human';
  answer_score: number;
  score_breakdown: EvidenceJudgeScoreBreakdown;
}

const sourceAuthority: Record<string, number> = {
  runbook: 0.9,
  faq: 0.9,
  whitepaper: 0.85,
  module_doc: 0.8,
  solved_case: 0.75,
  glossary: 0.45,
  unresolved_case: 0.25,
};

export function judgeKnowledgeEvidence(input: {
  route: KnowledgeRoute;
  evidencePack: KnowledgeEvidencePack;
  question: string;
}): EvidenceJudgeResult {
  const results = input.evidencePack.results;
  const risks = Array.from(new Set([...input.route.risks]));
  const conflicts = detectConflicts(results);
  const stale = results.filter((result) => isStale(result));
  const active = results.filter((result) => result.status === 'active');
  const nonActive = results.filter((result) => result.status !== 'active');
  const implementationSignals = input.route.codeEscalationSignals;
  const blockers: EvidenceJudgeBlocker[] = [];
  const ambiguity: string[] = [];
  const qualityIssues: string[] = [];

  // Must-block: implementation-detail signals
  if (implementationSignals.length > 0) {
    blockers.push('implementation_detail');
    return buildResult({
      results,
      answerable: false,
      reason: `用户问题包含当前实现或错误线索：${implementationSignals.join('、')}，需要升级到只读代码调查。`,
      risks: Array.from(new Set([...risks, 'implementation_detail'])),
      missing: ['当前实现证据'],
      conflicts,
      blockers,
      ambiguity,
      qualityIssues,
      action: 'dispatch_code_diagnosis',
      score: scoreResults(results, { conflicts, risks, stale }),
    });
  }

  // No hits
  if (results.length === 0) {
    blockers.push('no_active_evidence');
    return buildResult({
      results,
      answerable: false,
      reason: '知识库没有找到可用证据，需要升级到代码或其他证据源查询。',
      risks,
      missing: ['知识库命中证据'],
      conflicts: [],
      blockers,
      ambiguity,
      qualityIssues,
      action: 'dispatch_code_diagnosis',
      score: 0,
    });
  }

  const breakdown = computeBreakdown(results, { conflicts, risks, stale, route: input.route, question: input.question });
  const answerScore = scoreFromBreakdown(breakdown);
  const normalizedScore = Math.max(0, Math.min(1, answerScore));

  const topMatchedTerms = results[0]?.matched_terms ?? [];
  const topSpecificTerms = topMatchedTerms.filter((term) => Array.from(term.trim()).length >= 2);

  // Module mismatch detection
  if (input.route.moduleCandidates.length > 0 && results[0] && !input.route.moduleCandidates.includes(results[0].module)) {
    blockers.push('module_mismatch');
  }
  if (input.route.moduleCandidates.length > 0 && results[0]?.taxonomy_known === false) {
    blockers.push('unknown_module');
  }

  const top = results[0];

  // Direct answers require an explicit span selected from the canonical parent.
  if (top && (!top.answer_span || !hasBoundedAnswerSpan(top.answer_span))) {
    blockers.push('missing_answer_bearing_sentence');
  }

  // Only reviewed ok/info evidence may cross the direct-answer boundary.
  if (!top?.quality || top.quality.severity === 'warn' || top.quality.severity === 'error') {
    blockers.push('low_quality_evidence');
    qualityIssues.push(...(top?.quality?.issues ?? ['missing_quality_status']));
  } else {
    qualityIssues.push(...(top.quality.issues ?? []));
  }

  if (top && !hasCompleteProvenance(top)) {
    blockers.push('missing_provenance');
  }

  if (top && topSpecificTerms.length < 2) {
    blockers.push('low_signal_terms');
  }

  if (top && !passesRetrievalConfidenceGate(top, topSpecificTerms)) {
    blockers.push('low_retrieval_confidence');
  }

  // Conflict
  if (conflicts.length > 0) {
    blockers.push('conflicting_knowledge');
    return buildResult({
      results,
      answerable: false,
      reason: '知识库命中的文档之间存在冲突，不能直接回答。',
      risks,
      missing: ['冲突文档复核'],
      conflicts,
      blockers,
      ambiguity,
      qualityIssues,
      action: 'dispatch_code_diagnosis',
      score: normalizedScore,
      breakdown,
    });
  }

  // High risk
  if (risks.length > 0) {
    blockers.push('high_risk_uncertainty');
    return buildResult({
      results,
      answerable: false,
      reason: `问题涉及高风险域：${risks.join('、')}，不能只依赖知识库直接回答。`,
      risks,
      missing: ['高风险证据复核'],
      conflicts,
      blockers,
      ambiguity,
      qualityIssues,
      action: 'escalate_to_human',
      score: normalizedScore,
      breakdown,
    });
  }

  // Stale
  if (top && isStale(top)) {
    blockers.push('stale_knowledge');
    return buildResult({
      results,
      answerable: false,
      reason: '命中的知识文档已过期或待复核，不能作为高置信答案。',
      risks: ['stale_knowledge'],
      missing: ['当前版本证据'],
      conflicts,
      blockers,
      ambiguity,
      qualityIssues,
      action: 'dispatch_code_diagnosis',
      score: normalizedScore,
      breakdown,
    });
  }

  // Non-active evidence
  if (nonActive.length > 0 && (active.length === 0 || results[0]?.status !== 'active')) {
    return buildResult({
      results: active,
      answerable: false,
      reason: `命中的知识文档不是 active 状态：${Array.from(new Set(nonActive.map((result) => result.status))).join('、')}，不能作为直接回答证据。`,
      risks: Array.from(new Set([...risks, 'non_active_knowledge'])),
      missing: ['active 知识证据'],
      conflicts,
      blockers,
      ambiguity,
      qualityIssues,
      action: 'dispatch_code_diagnosis',
      score: normalizedScore,
      breakdown,
    });
  }

  const answerable = normalizedScore >= directAnswerThreshold(results) && blockers.length === 0;
  return buildResult({
    results,
    answerable,
    reason: answerable
      ? '知识库命中 active FAQ/runbook/whitepaper 证据，内容可支撑直接回答。'
      : `知识库有命中但分数不足（score=${normalizedScore.toFixed(2)}, blockers=${blockers.length}），需要补充证据或升级查询。`,
    risks,
    missing: answerable ? [] : ['更高置信证据'],
    conflicts,
    blockers,
    ambiguity,
    qualityIssues,
    action: answerable ? 'final_answer' : 'dispatch_code_diagnosis',
    score: normalizedScore,
    breakdown,
  });
}

function scoreFromBreakdown(breakdown: EvidenceJudgeScoreBreakdown): number {
  const positive =
    breakdown.relevance * 0.25 +
    breakdown.coverage * 0.15 +
    breakdown.source_authority * 0.15 +
    breakdown.freshness * 0.10 +
    breakdown.version_match * 0.10 +
    breakdown.agreement * 0.10 +
    breakdown.actionability * 0.15;
  const penalties =
    breakdown.conflict_penalty +
    breakdown.ambiguity_penalty +
    breakdown.risk_penalty +
    breakdown.quality_penalty;
  return Math.max(0, Math.min(1, Number((positive - penalties).toFixed(2))));
}

function buildResult(input: {
  results: KnowledgeEvidenceResult[];
  answerable: boolean;
  reason: string;
  risks: string[];
  missing: string[];
  conflicts: string[];
  blockers: EvidenceJudgeBlocker[];
  ambiguity: string[];
  qualityIssues: string[];
  action: EvidenceJudgeResult['recommended_next_action'];
  score: number;
  breakdown?: EvidenceJudgeScoreBreakdown;
}): EvidenceJudgeResult {
  const breakdown = input.breakdown ?? computeBreakdown(input.results, { conflicts: input.conflicts, risks: input.risks, stale: [], route: { moduleCandidates: [], keywords: [], codeEscalationSignals: [], risks: [], normalizedQuestion: '', intentCandidates: [], sourceTypes: [] }, question: '' });
  const confidence: EvidenceJudgeResult['confidence'] = input.answerable
    ? input.score >= 0.78 ? 'high' : input.score >= 0.6 ? 'medium' : 'low'
    : 'low';
  return {
    answerable: input.answerable,
    confidence,
    need_code_escalation: !input.answerable,
    reason: input.reason,
    rationale: input.reason,
    evidence: input.results.slice(0, 5).map((r) => r.evidence_id),
    risks: input.risks,
    missing_info: input.missing,
    conflicts: input.conflicts,
    blockers: input.blockers,
    ambiguity: input.ambiguity,
    quality_issues: input.qualityIssues,
    recommended_next_action: input.action,
    answer_score: input.score,
    score_breakdown: breakdown,
  };
}

function computeBreakdown(
  results: KnowledgeEvidenceResult[],
  state: { conflicts: string[]; risks: string[]; stale: KnowledgeEvidenceResult[]; route: KnowledgeRoute; question: string },
): EvidenceJudgeScoreBreakdown {
  if (results.length === 0) {
    return {
      relevance: 0,
      coverage: 0,
      source_authority: 0,
      freshness: 0,
      version_match: 0,
      agreement: 0,
      actionability: 0,
      conflict_penalty: 0,
      ambiguity_penalty: 0,
      risk_penalty: 0,
      quality_penalty: 0,
    };
  }
  const top = results[0]!;
  const matchedTermCount = top.matched_terms.length;
  const titleMatch = state.question && top.title && state.question.includes(top.title.slice(0, 4)) ? 1 : 0;
  const moduleMatch = state.route.moduleCandidates.length === 0 || state.route.moduleCandidates.includes(top.module) ? 1 : 0;

  const relevance = Math.min(1, Math.max(0.1, (matchedTermCount * 0.18) + (titleMatch * 0.25) + (moduleMatch * 0.15)));
  const sourceCoverage = /faq|runbook|whitepaper|solved_case/.test(top.source_type) ? 0.85 : 0.45;
  const coverage = sourceCoverage;
  const source_authority = sourceAuthority[top.source_type] ?? 0.4;
  const freshness = isStale(top) ? 0.35 : 0.9;
  const version_match = top.status === 'active' ? 0.8 : 0.45;
  const agreement = state.conflicts.length > 0 ? 0.2 : results.length > 1 ? 0.9 : 0.75;
  const actionability = /faq|runbook|solved_case/.test(top.source_type) ? 0.9 : 0.65;
  const conflict_penalty = state.conflicts.length > 0 ? 0.25 : 0;
  const ambiguity_penalty = matchedTermCount < 2 ? 0.15 : 0;
  const risk_penalty = state.risks.length > 0 ? 0.2 : 0;
  const quality_penalty = top.quality?.severity === 'error' ? 0.3 : top.quality?.severity === 'warn' ? 0.1 : 0;

  return {
    relevance: Number(relevance.toFixed(2)),
    coverage: Number(coverage.toFixed(2)),
    source_authority: Number(source_authority.toFixed(2)),
    freshness: Number(freshness.toFixed(2)),
    version_match: Number(version_match.toFixed(2)),
    agreement: Number(agreement.toFixed(2)),
    actionability: Number(actionability.toFixed(2)),
    conflict_penalty: Number(conflict_penalty.toFixed(2)),
    ambiguity_penalty: Number(ambiguity_penalty.toFixed(2)),
    risk_penalty: Number(risk_penalty.toFixed(2)),
    quality_penalty: Number(quality_penalty.toFixed(2)),
  };
}

function scoreResults(results: KnowledgeEvidenceResult[], state: {
  conflicts: string[];
  risks: string[];
  stale: KnowledgeEvidenceResult[];
}): number {
  if (results.length === 0) {
    return 0;
  }
  const top = results[0]!;
  const relevance = Math.min(1, Math.max(0.15, top.matched_terms.length / 4));
  const coverage = /faq|runbook|whitepaper|solved_case/.test(top.source_type) ? 0.85 : 0.45;
  const authority = sourceAuthority[top.source_type] ?? 0.4;
  const freshness = isStale(top) ? 0.35 : 0.9;
  const versionMatch = top.status === 'active' ? 0.8 : 0.45;
  const agreement = state.conflicts.length > 0 ? 0.2 : results.length > 1 ? 0.9 : 0.75;
  const actionability = /faq|runbook|solved_case/.test(top.source_type) ? 0.9 : 0.65;
  const conflictPenalty = state.conflicts.length > 0 ? 0.25 : 0;
  const riskPenalty = state.risks.length > 0 ? 0.2 : 0;
  const stalePenalty = state.stale.length > 0 ? 0.12 : 0;
  const score =
    0.25 * relevance +
    0.20 * coverage +
    0.15 * authority +
    0.10 * freshness +
    0.10 * versionMatch +
    0.10 * agreement +
    0.10 * actionability -
    conflictPenalty -
    riskPenalty -
    stalePenalty;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function directAnswerThreshold(results: KnowledgeEvidenceResult[]): number {
  const top = results[0];
  if (!top) {
    return 1;
  }
  if (top.source_type === 'faq' || top.source_type === 'runbook') {
    return 0.7;
  }
  return top.intent === 'troubleshooting' ? 0.78 : 0.68;
}

function detectConflicts(results: KnowledgeEvidenceResult[]): string[] {
  const activeByModule = new Map<string, Set<string>>();
  for (const result of results) {
    const key = `${result.module}:${result.intent}`;
    activeByModule.set(key, new Set([...(activeByModule.get(key) ?? []), result.status]));
  }
  return Array.from(activeByModule.entries())
    .filter(([, statuses]) => statuses.has('active') && (statuses.has('deprecated') || statuses.has('archived') || statuses.has('review_required')))
    .map(([key]) => key);
}

function isStale(result: KnowledgeEvidenceResult): boolean {
  if (result.status === 'deprecated' || result.status === 'archived' || result.status === 'review_required' || result.status === 'draft') {
    return true;
  }
  const verifiedAt = Date.parse(result.last_verified_at ?? '');
  if (!Number.isFinite(verifiedAt)) {
    return true;
  }
  const days = (Date.now() - verifiedAt) / 86_400_000;
  return days > 180;
}

function hasCompleteProvenance(result: KnowledgeEvidenceResult): boolean {
  return Boolean(
    result.source_document &&
    result.source_document_id &&
    result.source_block_ids?.length &&
    result.section_path?.length &&
    !(result.grounding_issues?.length),
  );
}

function passesRetrievalConfidenceGate(
  result: KnowledgeEvidenceResult,
  specificTerms: string[],
): boolean {
  if (result.retrieval?.source === 'rerank') {
    return (result.retrieval.rerankScore ?? 0) >= 0.7;
  }
  const lexicalScore = result.retrieval?.keywordScore ?? result.score;
  return specificTerms.length >= 2 && Number.isFinite(lexicalScore) && lexicalScore > 0;
}

function hasBoundedAnswerSpan(text: string): boolean {
  const length = Array.from(text.trim()).length;
  return length > 0 && length <= 500 && !/[\u0000-\u001F\u007F]/.test(text);
}

export const __testing = { hasBoundedAnswerSpan };
