import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticResult, DiagnosticRun } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { formatReviewFailureFallback } from './presenter.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
} from './review-gate.js';
import { validateDiagnosticResult } from './result-validator.js';
import {
  AnswerCoverageService,
  materializeCoverageReviewInput,
  unknownCoverageReview,
  type CoverageEvidenceProvenance,
} from './answer-coverage.js';
import type { AnswerGoal, DiagnosticClaim, Evidence } from '../domain.js';
import type { ReviewGlobalBlocker } from './review-gate.js';
import {
  buildSafeFrozenAnswerProjection,
  collectVisiblePromptCandidates,
  renderSafeFrozenAnswer,
  type SafeFrozenAnswerProjection,
  type SafePresentationPlan,
  type VisiblePromptReview,
} from './safe-answer-projection.js';
import { VisiblePromptSafetyService } from './visible-prompt-safety.js';

export class ReviewPresentationService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly outputReviewAgentSpec: string,
    private readonly presentationAgentSpec: string,
    private readonly answerCoverageAgentSpec?: string,
    private readonly visiblePromptSafetyAgentSpec?: string,
  ) {}

  async reviewAndFormat(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
  ): Promise<ReviewPresentationResult> {
    this.events.evidenceReviewStarted(caseSession, run, result);
    const answerGoal = run.request?.answerGoal;
    const structural = validateDiagnosticResult(result, answerGoal);
    const validation = this.answerCoverageAgentSpec && answerGoal
      ? validateDiagnosticResult(
          result,
          answerGoal,
          await this.reviewCoverage(structural.result.claims, structural.result.evidence, answerGoal, run),
          { blockers: upstreamGlobalBlockers(run) },
        )
      : structural;
    let validated = validation.result;
    const promptCandidates = collectVisiblePromptCandidates({
      result: validated,
      acceptedClaimIds: validation.acceptedClaimIds,
    });
    const visiblePromptReview = await this.reviewVisiblePrompts(promptCandidates);
    let projection = buildSafeFrozenAnswerProjection({
      result: validated,
      answerGoal: answerGoal ?? fallbackAnswerGoal(validated),
      frozenPrimaryClaimIds: validation.acceptedPrimaryAnswerClaimIds,
      acceptedClaimIds: validation.acceptedClaimIds,
      visiblePromptReview,
    });
    validated = applyProjectionOutcome(validated, projection);
    projection = buildSafeFrozenAnswerProjection({
      result: validated,
      answerGoal: answerGoal ?? fallbackAnswerGoal(validated),
      frozenPrimaryClaimIds: validation.acceptedPrimaryAnswerClaimIds,
      acceptedClaimIds: validation.acceptedClaimIds,
      visiblePromptReview,
    });
    run.result = validated;
    run.status = validated.status;
    const caseStatus = caseStatusFromDiagnosticResult(validated);
    this.events.evidenceValidationResult(caseSession, run.id, validation);
    const frozenDecision = decisionFromDiagnosticResult(validated);

    if (workerFailedBeforeUsableResult(run)) {
      return {
        reply: formatReviewFailureFallback(
          validated,
          caseSession.userPersona,
          run.request?.userGoal,
          run.workerTrace,
          '',
          { caseId: caseSession.id, runId: run.id },
        ),
        decision: frozenDecision,
        caseStatus,
      };
    }

    if (this.config.agent.modelProvider) {
      try {
        const reply = await this.modelDrivenPresentation(caseSession, projection);
        if (reply) {
          return {
            reply,
            decision: frozenDecision,
            caseStatus,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.events.modelReviewFailed(caseSession, message);
      }
    }

    return {
      reply: renderSafeFrozenAnswer({ projection, persona: caseSession.userPersona }),
      decision: frozenDecision,
      caseStatus,
    };
  }

  private async reviewVisiblePrompts(
    candidates: ReturnType<typeof collectVisiblePromptCandidates>,
  ): Promise<VisiblePromptReview> {
    if (!this.visiblePromptSafetyAgentSpec) {
      return { status: 'accepted', acceptedIds: candidates.map((item) => item.id) };
    }
    return new VisiblePromptSafetyService(
      this.model,
      this.visiblePromptSafetyAgentSpec,
    ).review(candidates);
  }

  private async reviewCoverage(
    claims: DiagnosticClaim[],
    evidence: Evidence[],
    answerGoal: AnswerGoal,
    run: DiagnosticRun,
  ) {
    try {
      const reviewInput = materializeCoverageReviewInput({
        answerGoal,
        claims,
        evidence,
        provenance: currentEvidenceProvenance(claims, evidence, answerGoal),
      });
      return await new AnswerCoverageService(this.model, this.answerCoverageAgentSpec ?? '').review(reviewInput);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return unknownCoverageReview(`answer coverage unavailable: ${reason}`);
    }
  }

  private async modelDrivenPresentation(
    caseSession: StoredCase,
    projection: SafeFrozenAnswerProjection,
  ): Promise<string | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

你只负责选择已通过确定性审核的 claim/evidence ID 并规划展示顺序，runtime 会确定性渲染用户可见回复。你不得返回自由回复文本（reply 字段）或新增事实。
当前用户视角：${caseSession.userPersona}。

只返回 JSON：
{"claimIds":["claim_1"],"evidenceIds":["ev_1"],"directAnswerClaimIds":["claim_1"],"actionClaimIds":["action_1"]}

约束：
- 只能排序 projection 中的 safe IDs，不得返回 answerTarget、自由文本或新事实。
- directAnswerClaimIds 必须等于 projection.primary IDs。
- actionClaimIds 必须等于 projection.actions IDs。
- claimIds 必须包含全部 required claim IDs；evidenceIds 必须包含全部 required evidence IDs。
- 不得通过中文问法列表、问题类型枚举或过程目标选择主答。
- 不要把“系统 bug / 设计使然 / 配置或使用问题 / 目前不能确认”这类归类放在结论第一句，除非它本身就是 frozen primary answer。
- 非开发视角不得暴露 src/、knowledge/_sources、caseId/runId、worker command、raw stdout/stderr、内部 prompt、Evidence Judge 分数或路由分数。
- 确定性 Review Gate 已冻结结论状态，Presentation 无权修改 outcome/status/recommendedNextAction。`,
      },
      {
        role: 'user',
        content: JSON.stringify({ projection }),
      },
    ], { json: true });
    const parsed = parseAgentModelJson<SafePresentationPlan>(response);
    this.events.modelReviewResult(caseSession, {
      accepted: true,
      claimIds: safeStringArray(parsed.claimIds),
      evidenceIds: safeStringArray(parsed.evidenceIds),
      directAnswerClaimIds: safeStringArray(parsed.directAnswerClaimIds),
    });
    return renderSafeFrozenAnswer({
      projection,
      persona: caseSession.userPersona,
      plan: parsed,
    });
  }
}

function currentEvidenceProvenance(
  claims: DiagnosticClaim[],
  evidence: Evidence[],
  answerGoal: AnswerGoal,
): Record<string, CoverageEvidenceProvenance | undefined> {
  return Object.fromEntries(evidence.map((item) => {
    const safeText = claims
      .filter((claim) => claim.evidenceIds.includes(item.id))
      .map((claim) => claim.text)
      .join('\n')
      .trim();
    if (!safeText) return [item.id, undefined];
    if (item.kind === 'workspace' || item.kind === 'mcp' || item.kind === 'log') {
      return [item.id, { freshness: 'same_run', safeText }];
    }
    if (
      item.kind === 'manual' &&
      answerGoal.sourceMessageIds.includes(item.source)
    ) {
      return [item.id, { freshness: 'current_message', safeText }];
    }
    // Knowledge v4 freshness is supplied only after Gate C generation validation.
    return [item.id, undefined];
  }));
}

function upstreamGlobalBlockers(run: DiagnosticRun): ReviewGlobalBlocker[] {
  const judge = run.request?.context?.knowledge?.judge as {
    blockers?: string[];
    conflicts?: string[];
  } | undefined;
  const blockers = [...(judge?.blockers ?? [])];
  if ((judge?.conflicts?.length ?? 0) > 0 && !blockers.includes('conflicting_knowledge')) {
    blockers.push('conflicting_knowledge');
  }
  return blockers.flatMap((code): ReviewGlobalBlocker[] => {
    if (code === 'conflicting_knowledge') return [{ code: 'evidence_conflict' }];
    if (code === 'high_risk_uncertainty') return [{ code: 'identity_or_safety_blocker' }];
    return [];
  });
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string'))).slice(0, 20);
}

function workerFailedBeforeUsableResult(run: DiagnosticRun): boolean {
  const trace = run.workerTrace;
  const failed = Boolean(trace && (
    trace.error || trace.signal || (trace.exitCode !== undefined && trace.exitCode !== 0)
  ));
  if (!failed) return false;

  // Worker failure parsers may attach a high-confidence log item describing the
  // failure itself. That item is useful for diagnostics, but is not usable
  // domain evidence and must never make the raw failure eligible for presentation.
  return !run.result?.evidence.some((evidence) => (
    evidence.kind !== 'log' && evidence.confidence !== 'low'
  ));
}

function applyProjectionOutcome(
  result: DiagnosticResult,
  projection: SafeFrozenAnswerProjection,
): DiagnosticResult {
  if (projection.outcome === 'final') return result;
  if (projection.outcome === 'ask_user') {
    return { ...result, status: 'need_input', recommendedNextAction: 'ask_user' };
  }
  if (projection.outcome === 'escalate') {
    return { ...result, status: 'partial', recommendedNextAction: 'escalate_to_human' };
  }
  return { ...result, status: 'partial', recommendedNextAction: 'continue_diagnosis' };
}

function fallbackAnswerGoal(result: DiagnosticResult): AnswerGoal {
  return {
    rawUserQuestion: '',
    resolvedQuestion: '当前问题',
    answerObject: '当前问题',
    mustAnswerItems: ['direct_answer'],
    diagnosticObjective: '',
    sourceMessageIds: [],
  };
}
