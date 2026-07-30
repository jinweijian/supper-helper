import type { AnswerGoal, DiagnosticResult, DiagnosticRun, Evidence, UserPersona } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import { validateDiagnosticStructure } from './result-validator.js';
import type { CoverageEvidenceEnvelope } from './coverage-evidence-provenance.js';

export interface ExperienceMatch {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId: string;
  sourceRunId: string;
  question: string;
  reply: string;
  score: number;
  result: DiagnosticResult;
  coverageEvidenceEnvelopes: CoverageEvidenceEnvelope[];
}

export interface ResolvedExperienceEvidence {
  evidence: Evidence;
  coverageEvidenceEnvelope: CoverageEvidenceEnvelope;
}

export interface ExperienceCurrentEvidenceResolver {
  resolve(input: {
    evidence: Evidence;
    sourceRun: DiagnosticRun;
    currentCase: StoredCase;
  }): ResolvedExperienceEvidence | undefined;
}

export interface RejectedExperienceCandidate {
  sourceCaseId: string;
  sourceMessageId: string;
  sourceReplyId?: string;
  sourceRunId?: string;
  score: number;
  rejectionReason: string;
}

export function findExperienceMatch(input: {
  store: CaseRepository;
  currentCase: StoredCase;
  userMessage: string;
  answerGoal?: AnswerGoal;
  currentEvidenceResolver?: ExperienceCurrentEvidenceResolver;
}): ExperienceMatch | undefined {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) return undefined;

  return input.store
    .listCases(200)
    .filter((caseSession) => caseSession.id !== input.currentCase.id)
    .filter((caseSession) => caseSession.tenantId === input.currentCase.tenantId)
    .filter((caseSession) => caseSession.userId === input.currentCase.userId)
    .filter((caseSession) => caseSession.workspaceId === input.currentCase.workspaceId)
    .flatMap((caseSession) => pairsFromCase(
      caseSession,
      input.currentCase,
      normalized,
      input.answerGoal,
      input.currentEvidenceResolver,
    ))
    .sort((left, right) => right.score - left.score)[0];
}

export function findRejectedExperienceCandidates(input: {
  store: CaseRepository;
  currentCase: StoredCase;
  userMessage: string;
  answerGoal?: AnswerGoal;
  currentEvidenceResolver?: ExperienceCurrentEvidenceResolver;
}): RejectedExperienceCandidate[] {
  const normalized = normalizeQuestion(input.userMessage);
  if (normalized.length < 6) return [];
  const candidates: RejectedExperienceCandidate[] = [];
  for (const caseSession of input.store.listCases(200)) {
    if (
      caseSession.id === input.currentCase.id ||
      caseSession.tenantId !== input.currentCase.tenantId ||
      caseSession.userId !== input.currentCase.userId ||
      caseSession.workspaceId !== input.currentCase.workspaceId
    ) continue;
    for (const message of caseSession.messages) {
      if (message.role !== 'user') continue;
      const score = similarity(normalized, normalizeQuestion(message.body));
      if (score < 0.92) continue;
      const reply = caseSession.messages.find((item) => item.role === 'helper' && item.replyToMessageId === message.id);
      if (!reply) {
        candidates.push({
          sourceCaseId: caseSession.id,
          sourceMessageId: message.id,
          score,
          rejectionReason: 'reply_not_attributable',
        });
        continue;
      }
      const sourceRun = findSourceRun(caseSession.runs, message.id, message.body);
      const rejectionReason = sourceRun
        ? reusabilityIssue(
            sourceRun,
            input.currentCase,
            input.answerGoal,
            input.currentEvidenceResolver,
          ).reason
        : 'run_not_attributable';
      if (rejectionReason) {
        candidates.push({
          sourceCaseId: caseSession.id,
          sourceMessageId: message.id,
          sourceReplyId: reply.id,
          sourceRunId: sourceRun?.id,
          score,
          rejectionReason,
        });
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score).slice(0, 5);
}

function pairsFromCase(
  caseSession: StoredCase,
  currentCase: StoredCase,
  normalizedQuestion: string,
  answerGoal?: AnswerGoal,
  currentEvidenceResolver?: ExperienceCurrentEvidenceResolver,
): ExperienceMatch[] {
  const matches: ExperienceMatch[] = [];
  for (const message of caseSession.messages) {
    if (message.role !== 'user') continue;
    const score = similarity(normalizedQuestion, normalizeQuestion(message.body));
    if (score < 0.92) continue;
    const reply = caseSession.messages.find((item) => (
      item.role === 'helper' && item.replyToMessageId === message.id
    ));
    if (!reply) continue;
    const sourceRun = findSourceRun(caseSession.runs, message.id, message.body);
    if (!sourceRun?.result) continue;
    const reusable = reusabilityIssue(
      sourceRun,
      currentCase,
      answerGoal,
      currentEvidenceResolver,
    );
    if (reusable.reason || !reusable.result) continue;
    matches.push({
      sourceCaseId: caseSession.id,
      sourceMessageId: message.id,
      sourceReplyId: reply.id,
      sourceRunId: sourceRun.id,
      question: message.body,
      reply: reply.body,
      score,
      result: reusable.result,
      coverageEvidenceEnvelopes: reusable.coverageEvidenceEnvelopes ?? [],
    });
  }
  return matches;
}

function findSourceRun(runs: DiagnosticRun[], sourceMessageId: string, question: string): DiagnosticRun | undefined {
  const normalized = normalizeQuestion(question);
  const attributed = runs.filter((run) => (
    run.result && run.request?.context?.resolvedTurn?.sourceMessageIds.includes(sourceMessageId)
  ));
  if (attributed.length === 1) return attributed[0];
  if (attributed.length > 1) return undefined;
  const legacyMatches = runs.filter((run) => (
    run.result && run.request && similarity(normalized, normalizeQuestion(run.request.userGoal)) >= 0.92
  ));
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
}

function reusabilityIssue(
  run: DiagnosticRun,
  currentCase: StoredCase,
  answerGoal?: AnswerGoal,
  currentEvidenceResolver?: ExperienceCurrentEvidenceResolver,
): { reason?: string; result?: DiagnosticResult; coverageEvidenceEnvelopes?: CoverageEvidenceEnvelope[] } {
  const result = run.result;
  if (!result || run.status !== 'concluded' || result.status !== 'concluded' || result.recommendedNextAction !== 'final_answer') {
    return { reason: 'run_not_final' };
  }
  if (!answerGoal || !run.request?.answerGoal) return { reason: 'answer_goal_unavailable' };
  if (!hasExactExperienceAnswerGoal(answerGoal, run.request.answerGoal)) {
    return { reason: 'answer_goal_not_exact' };
  }
  if (result.evidence.length === 0) return { reason: 'evidence_missing' };
  if (!currentEvidenceResolver) return { reason: 'current_evidence_resolver_unavailable' };
  const resolvedEvidence = result.evidence.map((evidence) => (
    currentEvidenceResolver.resolve({ evidence, sourceRun: run, currentCase })
  ));
  if (
    resolvedEvidence.some((item) => !item) ||
    resolvedEvidence.some((item) => !isReusableEvidence(item!.evidence, currentCase.userPersona))
  ) {
    return { reason: 'evidence_not_current_or_visible' };
  }
  const currentEvidence = resolvedEvidence.map((item) => item!.evidence);
  const revalidatedResult: DiagnosticResult = {
    ...result,
    evidence: currentEvidence as Evidence[],
    claims: result.claims.map((claim) => ({
      ...claim,
      evidenceIds: [...claim.evidenceIds],
      answers: [...claim.answers],
    })),
    missingInfo: [...result.missingInfo],
  };
  const validation = validateDiagnosticStructure(revalidatedResult, answerGoal);
  const acceptedPrimary = validation.result.claims.filter((claim) => claim.role === 'primary_answer');
  if (acceptedPrimary.length === 0) {
    return { reason: 'answer_goal_not_covered' };
  }
  if (
    validation.issues.length > 0 ||
    validation.globalBlockers.length > 0 ||
    validation.result.status !== 'concluded' ||
    validation.result.recommendedNextAction !== 'final_answer'
  ) {
    return { reason: 'strict_review_failed' };
  }
  return {
    result: revalidatedResult,
    coverageEvidenceEnvelopes: resolvedEvidence.map((item) => item!.coverageEvidenceEnvelope),
  };
}

export function hasExactExperienceAnswerGoal(current: AnswerGoal, source: AnswerGoal): boolean {
  if (
    normalizeGoalText(current.resolvedQuestion) !== normalizeGoalText(source.resolvedQuestion) ||
    normalizeGoalText(current.answerObject) !== normalizeGoalText(source.answerObject)
  ) {
    return false;
  }
  const currentItems = normalizedItemSet(current.mustAnswerItems);
  const sourceItems = normalizedItemSet(source.mustAnswerItems);
  return (
    currentItems.length > 0 &&
    currentItems.length === sourceItems.length &&
    currentItems.every((item, index) => item === sourceItems[index])
  );
}

function isReusableEvidence(evidence: Evidence, persona: UserPersona): boolean {
  if (evidence.confidence === 'low') return false;
  const validation = evidence.validation;
  if (!validation || validation.status !== 'active' || !validation.lastVerifiedAt || !validation.quality) return false;
  if (validation.quality && validation.quality !== 'ok' && validation.quality !== 'info') return false;
  if (validation.lastVerifiedAt) {
    const verifiedAt = Date.parse(validation.lastVerifiedAt);
    if (!Number.isFinite(verifiedAt) || (Date.now() - verifiedAt) / 86_400_000 > 180) return false;
  }
  const allowed = visibilityForPersona(persona);
  return !validation.visibility || allowed.includes(validation.visibility);
}

function visibilityForPersona(persona: UserPersona): Array<NonNullable<Evidence['validation']>['visibility']> {
  if (persona === 'customer') return ['customer_safe'];
  if (persona === 'operations') return ['customer_safe', 'internal'];
  return ['customer_safe', 'internal', 'support'];
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}

function normalizeGoalText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizedItemSet(items: string[]): string[] {
  return Array.from(new Set(items.map(normalizeGoalText).filter(Boolean))).sort();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aSet = bigrams(a);
  const bSet = bigrams(b);
  const intersection = [...aSet].filter((item) => bSet.has(item)).length;
  return intersection / (new Set([...aSet, ...bSet]).size || 1);
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}
