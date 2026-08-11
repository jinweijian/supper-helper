import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticClaim, DiagnosticRequest, DiagnosticResult, Evidence } from '../domain.js';
import { createSdkMcpClient } from './sdk-client.js';
import { executeMcpTool } from './policy.js';
import type { McpClientFactory } from './contracts.js';
import type { NormalizedMcpResult } from './normalizer.js';
import * as z from 'zod/v4';

const EvidenceEnvelopeSchema = z.object({
  confidence: z.literal('high'),
  claims: z.array(z.object({
    text: z.string().min(1),
    type: z.enum(['fact', 'inference']),
    role: z.enum(['primary_answer', 'supporting_context']),
    answers: z.array(z.string()),
  })).min(1),
});

export interface McpEvidenceServiceOptions {
  createClient?: McpClientFactory;
  resolveSecret?: Parameters<typeof executeMcpTool>[0]['resolveSecret'];
}

export interface CurrentMcpCoverageEvidence {
  evidenceId: string;
  safeText: string;
  runId: string;
  validated: boolean;
  readOnly: boolean;
  allowlisted: boolean;
  completed: boolean;
}

export class McpEvidenceService {
  private readonly createClient: McpClientFactory;

  constructor(
    private readonly config: SuperHelperConfig,
    private readonly options: McpEvidenceServiceOptions = {},
  ) {
    this.createClient = options.createClient ?? createSdkMcpClient;
  }

  async run(request: DiagnosticRequest): Promise<DiagnosticResult | undefined> {
    const workspace = this.config.workspaces.find((item) => item.id === request.workspaceId);
    if (!workspace) return undefined;
    const planned = this.config.mcpTools
      .filter((server) => request.allowedMcpToolIds.includes(server.id))
      .flatMap((server) => (server.allowedToolNames ?? []).map((toolName) => ({ server, toolName })))
      .slice(0, 2);
    if (planned.length === 0) return undefined;

    const calls: NonNullable<NonNullable<DiagnosticRequest['context']>['mcp']>['calls'] = [];
    const evidence: Evidence[] = [];
    let previousResult: NormalizedMcpResult | undefined;

    for (const [index, plan] of planned.entries()) {
      const argumentsValue: Record<string, unknown> = {
        query: request.answerGoal.resolvedQuestion,
        mustAnswerItems: request.answerGoal.mustAnswerItems,
      };
      if (index > 0 && previousResult) {
        argumentsValue.previousResult = safePreviousResult(previousResult);
      }
      const execution = await executeMcpTool({
        server: plan.server,
        workspace,
        toolName: plan.toolName,
        arguments: argumentsValue,
        stdioCommandWhitelist: this.config.claude.commandWhitelist,
        createClient: this.createClient,
        resolveSecret: this.options.resolveSecret,
      });
      if (execution.status === 'completed') {
        previousResult = execution.result as NormalizedMcpResult;
        const evidenceId = `mcp_ev_${String(evidence.length + 1).padStart(2, '0')}`;
        evidence.push({
          id: evidenceId,
          kind: 'mcp',
          source: `mcp:${plan.server.id}/${plan.toolName}`,
          summary: evidenceSummary(previousResult),
          confidence: 'medium',
        });
        calls.push({
          serverId: plan.server.id,
          toolName: plan.toolName,
          status: 'completed',
          result: previousResult,
          evidenceId,
        });
      } else {
        calls.push({
          serverId: plan.server.id,
          toolName: plan.toolName,
          status: execution.status,
          reason: execution.reason,
        });
      }
    }

    request.context ??= {
      isFollowUp: false,
      currentUserMessage: request.userGoal,
      recentMessages: [],
      previousRuns: [],
    };
    request.context.mcp = {
      calls,
      evidence,
      missingInfo: request.answerGoal.mustAnswerItems,
    };
    const extracted = extractExplicitResult(request, calls, evidence);
    if (extracted) {
      request.context.mcp.missingInfo = [];
      return extracted;
    }
    return undefined;
  }

  currentCoverageEvidence(request: DiagnosticRequest): CurrentMcpCoverageEvidence[] {
    return (request.context?.mcp?.calls ?? []).flatMap((call) => {
      if (
        call.status !== 'completed' ||
        !call.evidenceId ||
        !call.result ||
        !call.result.structuredContent
      ) return [];
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(call.result.structuredContent) as Record<string, unknown>;
      } catch {
        return [];
      }
      const envelope = EvidenceEnvelopeSchema.safeParse(parsed.superHelperEvidence);
      if (!envelope.success) return [];
      const targetEvidence = request.context?.mcp?.evidence.find((item) => item.id === call.evidenceId);
      if (targetEvidence?.confidence !== 'high') return [];
      const server = this.config.mcpTools.find((item) => item.id === call.serverId);
      const readOnly = server?.permission === 'read_only';
      const allowlisted = Boolean(
        server?.enabled &&
        request.allowedMcpToolIds.includes(call.serverId) &&
        server.allowedToolNames?.includes(call.toolName),
      );
      const safeText = envelope.data.claims.map((claim) => claim.text).join('；')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!safeText || Array.from(safeText).length > 1000) return [];
      return [{
        evidenceId: call.evidenceId,
        safeText,
        runId: request.runId,
        validated: true,
        readOnly,
        allowlisted,
        completed: true,
      }];
    });
  }
}

function extractExplicitResult(
  request: DiagnosticRequest,
  calls: NonNullable<NonNullable<DiagnosticRequest['context']>['mcp']>['calls'],
  evidence: Evidence[],
): DiagnosticResult | undefined {
  const claims: DiagnosticClaim[] = [];
  for (const call of calls) {
    if (call.status !== 'completed' || !call.result?.structuredContent || !call.evidenceId) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(call.result.structuredContent) as Record<string, unknown>;
    } catch {
      continue;
    }
    const envelope = EvidenceEnvelopeSchema.safeParse(parsed.superHelperEvidence);
    if (!envelope.success) continue;
    const targetEvidence = evidence.find((item) => item.id === call.evidenceId);
    if (targetEvidence) targetEvidence.confidence = 'high';
    for (const [index, claim] of envelope.data.claims.entries()) {
      const exactAnswers = claim.role === 'primary_answer'
        ? request.answerGoal.mustAnswerItems.filter((item) => claim.answers.includes(item))
        : [];
      claims.push({
        id: `mcp_claim_${claims.length + index + 1}`,
        type: claim.type,
        role: claim.role,
        text: claim.text,
        evidenceIds: [call.evidenceId],
        answers: exactAnswers,
      });
    }
  }
  const covered = new Set(claims.filter((claim) => claim.role === 'primary_answer').flatMap((claim) => claim.answers));
  if (!request.answerGoal.mustAnswerItems.every((item) => covered.has(item))) return undefined;
  return {
    status: 'concluded',
    summary: claims.map((claim) => claim.text).join('；'),
    missingInfo: [],
    evidence,
    claims,
    recommendedNextAction: 'final_answer',
  };
}

function safePreviousResult(result: NormalizedMcpResult): string {
  return [result.text, result.structuredContent].filter(Boolean).join('\n').slice(0, 4_000);
}

function evidenceSummary(result: NormalizedMcpResult): string {
  const text = [result.text, result.structuredContent].filter(Boolean).join(' ');
  if (text) return text.slice(0, 1_600);
  return result.locators.map((item) => `${item.kind}:${item.mimeType ?? 'unknown'}:${item.sizeBytes}`).join(', ').slice(0, 1_600);
}
