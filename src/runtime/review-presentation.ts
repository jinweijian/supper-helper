import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticResult, DiagnosticRun } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  formatReviewFailureFallback,
  personaName,
  renderPresentationPlan,
  ruleBasedReviewAndFormat,
  type PresentationPlan,
} from './presenter.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
} from './review-gate.js';
import { validateDiagnosticResult } from './result-validator.js';

export class ReviewPresentationService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly outputReviewAgentSpec: string,
    private readonly presentationAgentSpec: string,
  ) {}

  async reviewAndFormat(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
  ): Promise<ReviewPresentationResult> {
    this.events.evidenceReviewStarted(caseSession, run, result);
    const validation = validateDiagnosticResult(result, run.request?.answerGoal);
    const validated = validation.result;
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
        const reply = await this.modelDrivenPresentation(caseSession, validated, validation.acceptedClaimIds, validation.acceptedPrimaryAnswerClaimIds, run);
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
      reply: ruleBasedReviewAndFormat(validated, caseSession.userPersona, run.request?.userGoal, {
        answerGoal: run.request?.answerGoal,
        ragAnswerability: run.request?.context?.knowledge?.answerability,
      }),
      decision: frozenDecision,
      caseStatus,
    };
  }

  private async modelDrivenPresentation(
    caseSession: StoredCase,
    result: DiagnosticResult,
    acceptedClaimIds: string[],
    acceptedPrimaryAnswerClaimIds: string[],
    run: DiagnosticRun,
  ): Promise<string | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

你只负责选择已通过确定性审核的 claim/evidence ID 并规划展示顺序，runtime 会确定性渲染用户可见回复。你不得返回自由回复文本（reply 字段）或新增事实。
当前用户视角：${personaName(caseSession.userPersona)}。

只返回 JSON：
{"answerTarget":"用户真实问题","claimIds":["claim_1"],"evidenceIds":["ev_1"],"directAnswerClaimIds":["claim_1"],"sections":[{"title":"结论","claimIds":["claim_1"]}]}

约束：
- answerTarget 必须来自 answerGoal.resolvedQuestion，不得使用 diagnosticObjective 替代用户问题。
- directAnswerClaimIds 必须等于 frozenPrimaryAnswerClaimIds；如果为空，说明本轮没有最终主答，只能表达初步判断。
- claimIds 必须非空，且只能选择 acceptedClaims 中存在的 ID。不得选择 role 为 process_note 的 claim。
- evidenceIds 必须覆盖所选 claimIds 引用的全部 evidence。
- sections 可选，用于规划展示顺序；每个 section 的 claimIds 必须是 claimIds 的子集。runtime 只渲染被选 claim 原文、accepted next action、missingInfo 与固定连接语。
- 不得通过中文问法列表、问题类型枚举或过程目标选择主答。
- 不要把“系统 bug / 设计使然 / 配置或使用问题 / 目前不能确认”这类归类放在结论第一句，除非它本身就是 frozen primary answer。
- 非开发视角不得暴露 src/、knowledge/_sources、caseId/runId、worker command、raw stdout/stderr、内部 prompt、Evidence Judge 分数或路由分数。
- 确定性 Review Gate 已冻结结论状态，Presentation 无权修改 outcome/status/recommendedNextAction。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: caseSession.id,
          workspaceId: caseSession.workspaceId,
          frozenDecision: decisionFromDiagnosticResult(result),
          answerGoal: run.request?.answerGoal,
          ragAnswerability: run.request?.context?.knowledge?.answerability,
          frozenPrimaryAnswerClaimIds: acceptedPrimaryAnswerClaimIds,
          acceptedClaims: result.claims.map((claim) => ({ id: claim.id, type: claim.type, role: claim.role, text: claim.text, evidenceIds: claim.evidenceIds, answers: claim.answers })),
          acceptedEvidence: result.evidence.map((evidence) => ({ id: evidence.id, kind: evidence.kind, source: evidence.source, summary: evidence.summary, confidence: evidence.confidence })),
        }),
      },
    ], { json: true });
    const parsed = parseAgentModelJson<ModelPresentationParsed>(response);
    const validated = validateModelPresentation({
      parsed,
      result,
      acceptedClaimIds,
      acceptedPrimaryAnswerClaimIds,
    });
    this.events.modelReviewResult(caseSession, {
      accepted: Boolean(validated),
      answerTarget: typeof parsed.answerTarget === 'string' ? parsed.answerTarget.slice(0, 300) : undefined,
      claimIds: validated?.plan.claimIds ?? safeStringArray(parsed.claimIds),
      evidenceIds: validated?.plan.evidenceIds ?? safeStringArray(parsed.evidenceIds),
      directAnswerClaimIds: validated?.plan.directAnswerClaimIds ?? safeStringArray(parsed.directAnswerClaimIds),
    });
    if (!validated) return undefined;
    return renderPresentationPlan({ plan: validated.plan, result, persona: caseSession.userPersona });
  }
}

interface ModelPresentationParsed {
  answerTarget?: unknown;
  claimIds?: unknown;
  evidenceIds?: unknown;
  directAnswerClaimIds?: unknown;
  sections?: unknown;
}

function validateModelPresentation(input: {
  parsed: ModelPresentationParsed;
  result: DiagnosticResult;
  acceptedClaimIds: string[];
  acceptedPrimaryAnswerClaimIds: string[];
}): { plan: PresentationPlan; } | undefined {
  const { parsed, result, acceptedClaimIds, acceptedPrimaryAnswerClaimIds } = input;
  if (!Array.isArray(parsed.claimIds) || !Array.isArray(parsed.evidenceIds)) {
    return undefined;
  }
  if (!parsed.claimIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }
  if (!parsed.evidenceIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }
  if (Array.isArray(parsed.directAnswerClaimIds) && !parsed.directAnswerClaimIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }

  const claimIds = Array.from(new Set(parsed.claimIds));
  const evidenceIds = Array.from(new Set(parsed.evidenceIds));
  const directAnswerClaimIds = Array.isArray(parsed.directAnswerClaimIds)
    ? Array.from(new Set(parsed.directAnswerClaimIds))
    : [];
  const acceptedClaimIdSet = new Set(acceptedClaimIds);
  const evidenceById = new Map(result.evidence.map((evidence) => [evidence.id, evidence]));
  if (claimIds.length === 0 || claimIds.some((id) => !acceptedClaimIdSet.has(id))) {
    return undefined;
  }
  if (evidenceIds.length === 0 || evidenceIds.some((id) => !evidenceById.has(id))) {
    return undefined;
  }

  const claimsById = new Map(result.claims.map((claim) => [claim.id!, claim]));
  const selectedClaims = claimIds.map((id) => claimsById.get(id)).filter(Boolean);
  if (selectedClaims.length !== claimIds.length) {
    return undefined;
  }
  const selectedEvidenceIds = new Set(evidenceIds);
  const requiredEvidenceIds = new Set(selectedClaims.flatMap((claim) => claim!.evidenceIds));
  if ([...requiredEvidenceIds].some((id) => !selectedEvidenceIds.has(id))) {
    return undefined;
  }

  if (claimIds.some((id) => claimsById.get(id)?.role === 'process_note')) {
    return undefined;
  }

  const selectedClaimIds = new Set(claimIds);
  const selectedPrimaryIds = claimIds.filter((id) => acceptedPrimaryAnswerClaimIds.includes(id));
  if (acceptedPrimaryAnswerClaimIds.length > 0 && selectedPrimaryIds.length !== acceptedPrimaryAnswerClaimIds.length) {
    return undefined;
  }
  if (acceptedPrimaryAnswerClaimIds.length > 0 && !sameStringSet(directAnswerClaimIds, acceptedPrimaryAnswerClaimIds)) {
    return undefined;
  }
  if (directAnswerClaimIds.some((id) => !selectedClaimIds.has(id))) {
    return undefined;
  }

  return { plan: { claimIds, evidenceIds, directAnswerClaimIds } };
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string'))).slice(0, 20);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
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
