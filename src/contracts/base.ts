export type CaseStatus =
  | 'collecting_input'
  | 'ready_for_diagnosis'
  | 'diagnosing'
  | 'need_input'
  | 'partial'
  | 'concluded';

export type DiagnosticRunStatus =
  | 'queued'
  | 'running'
  | 'need_input'
  | 'partial'
  | 'concluded'
  | 'failed'
  | 'cancelled';

export type EvidenceKind =
  | 'workspace'
  | 'mcp'
  | 'manual'
  | 'knowledge'
  | 'history'
  | 'log'
  | 'unknown';

export type ClaimType = 'fact' | 'inference' | 'assumption' | 'unknown';

export type UserPersona = 'operations' | 'support' | 'customer' | 'developer';

export type LogSeverity = 'ok' | 'warn' | 'error' | 'info';

export type SecretRef =
  | { source: 'file'; key: string }
  | { source: 'env'; name: string };

export interface ContextUsage {
  estimatedTokens: number;
  limitTokens: number;
  percent: number;
  level: 'ok' | 'warn' | 'error';
  available: boolean;
}

export interface AnswerGoal {
  rawUserQuestion: string;
  resolvedQuestion: string;
  answerObject: string;
  mustAnswerItems: string[];
  diagnosticObjective: string;
  sourceMessageIds: string[];
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  rootPath: string;
  claudeInstructionsPath?: string;
  mcpToolIds: string[];
}

export interface McpToolConfig {
  id: string;
  name: string;
  protocol: 'stdio' | 'http' | 'sse';
  permission: 'read_only' | 'read_write';
  enabled: boolean;
}

export interface HelperAgentConfig {
  id: string;
  name: string;
  language: 'zh-CN' | 'en-US';
  tone: 'calm_professional' | 'concise' | 'technical';
  defaultPermission: 'read_only';
  rules: {
    noGuessing: boolean;
    requireEvidenceForConclusion: boolean;
    askWhenMissingRequiredInfo: boolean;
    allowUnknownAnswer: boolean;
    distinguishFactInferenceAssumption: boolean;
  };
}
