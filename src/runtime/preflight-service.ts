import type { SuperHelperConfig } from '../config.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { PreflightDecision } from './preflight-decision.js';
import { isSafetyPermissionDecision } from './preflight-decision.js';
import type { ResolvedTurnContext } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import { parseAgentModelJson } from './agent-model-review.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { buildAnswerGoal } from './answer-goal.js';
import { buildLocalPreflightDecision, isGenericWorkspaceFollowUp, summarizePreflightDecision } from './preflight-gate.js';
import { buildDiagnosticRequest } from './request-builder.js';
import { reconcileResolvedTurnContext } from './resolved-turn.js';
import { turnMessages } from '../sessions/turn-context-snapshot.js';

export class PreflightService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly inputReviewAgentSpec: string,
    private readonly experienceAgentSpec: string,
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

    if (isSafetyPermissionDecision(localDecision)) {
      this.events.localPreflightResult(caseSession, localDecision);
      return localDecision;
    }

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
{"action":"dispatch","reason":"...","missingInfo":[],"resolvedTurn":{"confirmedFacts":[],"userClaims":[],"hypotheses":[],"unknowns":[]}}

Workspace-aware Preflight Rules:
- The current workspace is already selected. Do not ask the user to prove which product, system, project, workspace, documentation, or codebase they mean when a current workspace exists.
- If the user provides business terms, feature names, route/location words, config words, impact questions, or troubleshooting symptoms that can be searched in the current workspace, prefer "dispatch".
- Ask the user only when the missing information blocks the next safe read-only action, such as no workspace, no searchable business/technical signal, or a required customer/runtime selector for a configured MCP lookup.
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
        request.answerGoal = buildAnswerGoal({ rawUserQuestion: userMessage, resolvedTurn: reconciled });
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
      localDecision.action === 'dispatch' &&
      isGenericWorkspaceFollowUp(modelDecision.question, modelDecision.missingInfo)
    ) {
      this.events.modelPreflightOverriddenByLocalDispatch(caseSession, modelDecision, localDecision);
      return localDecision;
    }

    if (modelDecision.action === 'dispatch' && localDecision.action === 'dispatch') {
      const resolvedTurn = modelDecision.request.context?.resolvedTurn ?? localDecision.request.context?.resolvedTurn;
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
      modelDecision.request.answerGoal = resolvedTurn
        ? buildAnswerGoal({
            rawUserQuestion: modelDecision.request.context?.currentUserMessage ?? localDecision.request.context?.currentUserMessage ?? modelDecision.request.userGoal,
            resolvedTurn,
          })
        : localDecision.request.answerGoal;
    }

    return modelDecision;
  }
}
