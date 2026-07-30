import type { SuperHelperConfig } from '../config.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { PreflightDecision } from './preflight-decision.js';
import type { ResolvedTurnContext } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import { parseAgentModelJson } from './agent-model-review.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { buildAnswerGoal } from './answer-goal.js';
import { buildLocalPreflightDecision, summarizePreflightDecision } from './preflight-gate.js';
import { buildDiagnosticRequest } from './request-builder.js';
import { reconcileResolvedTurnContext } from './resolved-turn.js';
import { turnMessages } from '../sessions/turn-context-snapshot.js';
import { AnswerGoalCompletenessReviewService } from './answer-goal-completeness-review-service.js';
import { reconcileMustAnswerItems } from './answer-goal-reconciliation.js';

export class PreflightService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly inputReviewAgentSpec: string,
    private readonly experienceAgentSpec: string,
    private readonly answerGoalCompletenessAgentSpec: string,
  ) {}

  async decide(caseSession: StoredCase, userMessage: string): Promise<PreflightDecision> {
    this.events.preflightStarted(caseSession, {
      useModelForPreflight: this.config.agent.useModelForPreflight,
      modelProvider: this.config.agent.modelProvider,
    });

    const localDecision = buildLocalPreflightDecision({
      config: this.config,
      caseSession,
      userMessage,
    });

    if (this.config.agent.useModelForPreflight && this.config.agent.modelProvider) {
      try {
        const modelDecision = await this.modelDrivenPreflight(caseSession, userMessage, localDecision);
        if (modelDecision) {
          return this.reconcileDecisions(caseSession, modelDecision, localDecision);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.appendDailyMemory(`- ${new Date().toISOString()} model preflight failed: ${message}`);
        this.events.modelPreflightFailed(caseSession, message);
      }
    }

    this.events.localPreflightResult(caseSession, localDecision);
    return localDecision;
  }

  private async modelDrivenPreflight(
    caseSession: StoredCase,
    userMessage: string,
    localDecision: PreflightDecision,
  ): Promise<PreflightDecision | undefined> {
    const workspace = this.config.workspaces.find((item) => item.id === caseSession.workspaceId);
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.inputReviewAgentSpec}

Experience Agent config is loaded separately and runs only after this Preflight stage:
${this.experienceAgentSpec}

Return JSON only. Use this shape:
{"action":"ask_user","reason":"...","missingInfo":["..."],"question":"..."}
or
{"action":"dispatch","reason":"...","missingInfo":[],"mustAnswerItems":["exact substring from resolved question"],"resolvedTurn":{"confirmedFacts":[],"userClaims":[],"hypotheses":[],"unknowns":[]}}

Workspace-aware Preflight Rules:
- The current workspace is already selected. Do not ask the user to prove which product, system, project, workspace, documentation, or codebase they mean when a current workspace exists.
- A selected workspace and a non-empty user message are enough to begin bounded read-only inspection; do not require vocabulary matches.
- Ask the user only when the missing information blocks every safe read-only action.
- For operations, customer, sales, and product users, do not ask for code paths before trying read-only workspace inspection.

Do not include <think>, markdown, comments, explanations, or text outside the JSON object.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            caseId: caseSession.id,
            workspaceId: caseSession.workspaceId,
            workspace: workspace
              ? {
                  id: workspace.id,
                  name: workspace.name,
                  rootPath: workspace.rootPath,
                  mcpToolIds: workspace.mcpToolIds,
                }
              : undefined,
            localPreflightReadiness: summarizePreflightDecision(localDecision),
            messages: turnMessages(caseSession).slice(-8),
            userMessage,
          },
          null,
          2,
        ),
      },
    ], { json: true });

    const parsed = parseAgentModelJson<{
      action?: 'ask_user' | 'dispatch';
      reason?: string;
      missingInfo?: string[];
      question?: string;
      mustAnswerItems?: unknown;
      resolvedTurn?: Partial<ResolvedTurnContext>;
    }>(response);

    this.events.modelPreflightResult(caseSession, response, parsed);

    if (parsed.action === 'ask_user') {
      return {
        action: 'ask_user',
        missingInfo: parsed.missingInfo ?? ['关键信息'],
        question: parsed.question ?? '请补充关键信息。如果不清楚，可以直接回复“不清楚”。',
      };
    }

    if (parsed.action === 'dispatch') {
      const request = buildDiagnosticRequest({
        caseSession,
        userMessage,
        unknowns: parsed.missingInfo ?? [],
        config: this.config,
      });
      const localResolved = request.context?.resolvedTurn;
      if (localResolved) {
        const reconciled = reconcileResolvedTurnContext({ local: localResolved, model: parsed.resolvedTurn });
        request.context!.resolvedTurn = reconciled;
        const answerGoal = buildAnswerGoal({ rawUserQuestion: userMessage, resolvedTurn: reconciled });
        const scoped = reconcileMustAnswerItems({
          resolvedQuestion: answerGoal.resolvedQuestion,
          proposedItems: parsed.mustAnswerItems,
          completenessReview: {
            status: 'complete',
            missingElements: [],
            reason: 'scope_validation_only',
          },
        });
        const completenessReview = scoped.source === 'model'
          ? await new AnswerGoalCompletenessReviewService(
              this.model,
              this.answerGoalCompletenessAgentSpec,
            ).review({
              resolvedQuestion: answerGoal.resolvedQuestion,
              proposedItems: scoped.items,
            })
          : undefined;
        const mustAnswerItems = reconcileMustAnswerItems({
          resolvedQuestion: answerGoal.resolvedQuestion,
          proposedItems: parsed.mustAnswerItems,
          completenessReview,
        });
        this.events.answerGoalItemsReconciled(caseSession, {
          source: mustAnswerItems.source,
          count: mustAnswerItems.items.length,
          ...(mustAnswerItems.source === 'fallback' ? { fallbackReason: mustAnswerItems.reason } : {}),
        });
        request.answerGoal = {
          ...answerGoal,
          mustAnswerItems: mustAnswerItems.items,
        };
        request.userGoal = reconciled.resolvedQuery;
        request.knownFacts = reconciled.confirmedFacts.map((fact) => fact.text);
        request.unknowns = Array.from(new Set([...request.unknowns, ...reconciled.unknowns.map((item) => item.text)]));
      }
      return {
        action: 'dispatch',
        request,
      };
    }

    return undefined;
  }

  private reconcileDecisions(
    caseSession: StoredCase,
    modelDecision: PreflightDecision,
    localDecision: PreflightDecision,
  ): PreflightDecision {
    if (
      modelDecision.action === 'ask_user' &&
      localDecision.action === 'dispatch'
    ) {
      this.events.modelPreflightOverriddenByLocalDispatch(caseSession, modelDecision, localDecision);
      return localDecision;
    }

    if (modelDecision.action === 'dispatch' && localDecision.action === 'dispatch') {
      const resolvedTurn = modelDecision.request.context?.resolvedTurn ?? localDecision.request.context?.resolvedTurn;
      const acceptedItems = [...modelDecision.request.answerGoal.mustAnswerItems];
      modelDecision.request.userGoal = resolvedTurn?.resolvedQuery ?? localDecision.request.userGoal;
      modelDecision.request.knownFacts = resolvedTurn?.confirmedFacts.map((fact) => fact.text) ?? localDecision.request.knownFacts;
      modelDecision.request.unknowns = Array.from(new Set([
        ...localDecision.request.unknowns,
        ...modelDecision.request.unknowns,
      ]));
      modelDecision.request.context = {
        ...localDecision.request.context!,
        resolvedTurn,
      };
      const localAnswerGoal = resolvedTurn
        ? buildAnswerGoal({
            rawUserQuestion: modelDecision.request.context?.currentUserMessage ?? localDecision.request.context?.currentUserMessage ?? modelDecision.request.userGoal,
            resolvedTurn,
          })
        : localDecision.request.answerGoal;
      modelDecision.request.answerGoal = {
        ...localAnswerGoal,
        mustAnswerItems: acceptedItems,
      };
    }

    return modelDecision;
  }
}
