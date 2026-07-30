import type { AnswerGoal, ClaimType, DiagnosticRunStatus, EvidenceKind, LogSeverity, UserPersona } from './base.js';
import type { CaseMessage } from './case.js';

export interface DiagnosticRequest {
  caseId: string;
  runId: string;
  workspaceId: string;
  claudeSessionId: string;
  answerGoal: AnswerGoal;
  userGoal: string;
  knownFacts: string[];
  unknowns: string[];
  constraints: string[];
  allowedMcpToolIds: string[];
  userPersona?: UserPersona;
  context?: DiagnosticRequestContext;
}

export interface DiagnosticRequestContext {
  isFollowUp: boolean;
  currentUserMessage: string;
  recentMessages: Array<{
    id?: string;
    role: CaseMessage['role'];
    body: string;
    createdAt: string;
  }>;
  previousRuns: Array<{
    runId: string;
    status: DiagnosticRunStatus;
    userGoal?: string;
    summary?: string;
    missingInfo: string[];
    evidence: Evidence[];
    claims: DiagnosticClaim[];
  }>;
  resolvedTurn?: ResolvedTurnContext;
  experienceCandidates?: Array<{
    sourceCaseId: string;
    sourceMessageId: string;
    sourceReplyId?: string;
    sourceRunId?: string;
    score: number;
    rejectionReason: string;
  }>;
  knowledge?: {
    answerability?: {
      answerability: 'full' | 'partial' | 'none' | 'unknown';
      selectedEvidenceIds: string[];
      coveredClaims: Array<{
        id: string;
        text: string;
        evidenceIds: string[];
        coveredRequirementIds: string[];
        usefulness: string;
      }>;
      missingElements: string[];
      shouldEscalate: boolean;
      escalationFocus: string;
      reason: string;
    };
    route?: {
      normalizedQuestion: string;
      moduleCandidates: string[];
      intentCandidates: string[];
      keywords: string[];
      sourceTypes: string[];
      codeEscalationSignals: string[];
      risks: string[];
    };
    evidence: Array<{
      id: string;
      source: string;
      sourceDocument?: string;
      sourceDocumentId?: string;
      sourceBlockIds?: string[];
      sectionPath?: string[];
      title: string;
      summary: string;
      answerSpan?: string;
      confidence: 'low' | 'medium' | 'high';
      status: string;
      matchedTerms: string[];
      quality?: { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] };
      retrieval?: {
        source: 'keyword' | 'vector' | 'hybrid' | 'rerank';
        keywordScore?: number;
        vectorScore?: number;
        rerankScore?: number;
        fieldContributions?: Record<string, number>;
      };
      groundingIssues?: string[];
      taxonomyKnown?: boolean;
    }>;
    judge: {
      answerable: boolean;
      confidence: 'low' | 'medium' | 'high';
      need_code_escalation: boolean;
      reason: string;
      evidence: string[];
      risks: string[];
      missing_info: string[];
      conflicts: string[];
      recommended_next_action: string;
      answer_score: number;
    };
  };
  deepQuery?: {
    permission: 'read_only';
    artifactTargets: string[];
    anchorTerms: string[];
    likelyPaths: string[];
    projectType?: string;
    avoidAssumptions: string[];
    correctionActions: string[];
    attempt?: number;
    maxAttempts?: number;
    triedQueries?: string[];
    failedReasons?: string[];
    nextPivot?: string;
    stopReason?: 'max_attempts' | 'sufficient_evidence' | 'needs_user' | 'human_escalation';
    previousArtifactTargets?: string[];
  };
  mcp?: {
    calls: Array<{
      serverId: string;
      toolName: string;
      status: 'completed' | 'rejected' | 'failed';
      reason?: string;
      result?: {
        text: string;
        structuredContent?: string;
        locators: Array<{
          kind: 'image' | 'audio' | 'blob';
          locator: string;
          mimeType?: string;
          sizeBytes: number;
        }>;
        truncated: boolean;
      };
      evidenceId?: string;
    }>;
    evidence: Evidence[];
    missingInfo: string[];
  };
}

export interface ResolvedTurnStatement {
  text: string;
  sourceMessageId: string;
}

export interface ResolvedTurnContext {
  resolvedQuery: string;
  latestUserMessage: string;
  latestUserMessageId?: string;
  confirmedFacts: ResolvedTurnStatement[];
  userClaims: ResolvedTurnStatement[];
  hypotheses: ResolvedTurnStatement[];
  unknowns: ResolvedTurnStatement[];
  isFollowUp: boolean;
  sourceMessageIds: string[];
}

export interface DiagnosticRun {
  id: string;
  caseId: string;
  status: DiagnosticRunStatus;
  request?: DiagnosticRequest;
  result?: DiagnosticResult;
  workerTrace?: WorkerTrace;
}

export interface DiagnosticLogEvent {
  id: string;
  createdAt: string;
  actor: 'agent' | 'claude' | 'mcp' | 'system';
  phase: string;
  summary: string;
  severity?: LogSeverity;
  label?: string;
  detail?: unknown;
  agentId?: string;
  agentRole?: string;
  agentName?: string;
}

export interface WorkerTrace {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: string;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export interface ClaudeWorkerResponse {
  result: DiagnosticResult;
  trace: WorkerTrace;
  coverageEvidence?: Array<{
    evidenceId: string;
    kind: 'workspace' | 'log';
    safeText: string;
    runId: string;
    validated: boolean;
  }>;
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  source: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  validation?: {
    status?: 'active' | 'inactive' | 'deprecated' | 'review_required';
    visibility?: 'customer_safe' | 'internal' | 'support' | 'restricted';
    lastVerifiedAt?: string;
    quality?: 'ok' | 'info' | 'warn' | 'error';
  };
}

export interface DiagnosticClaim {
  id?: string;
  type: ClaimType;
  role: DiagnosticClaimRole;
  text: string;
  evidenceIds: string[];
  answers: string[];
}

export type DiagnosticClaimRole =
  | 'primary_answer'
  | 'supporting_context'
  | 'evidence_locator'
  | 'process_note'
  | 'next_action'
  | 'unknown';

export interface DiagnosticResult {
  status: 'need_input' | 'partial' | 'concluded';
  summary: string;
  missingInfo: string[];
  evidence: Evidence[];
  claims: DiagnosticClaim[];
  recommendedNextAction:
    | 'ask_user'
    | 'continue_diagnosis'
    | 'final_answer'
    | 'escalate_to_human';
}
