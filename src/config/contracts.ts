import type { SecretRef, UserPersona } from '../domain.js';
import type { EmbeddingProviderConfig } from '../providers/embedding/contract.js';
import type { RerankProviderConfig } from '../providers/rerank/contract.js';
import type { McpServerConfig } from '../mcp/contracts.js';
export interface ModelProviderConfig {
  type: 'openai-compatible';
  baseUrl: string;
  api?: 'openai-completions' | 'openai-chat-completions';
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  timeoutMs?: number;
}

export interface SuperHelperConfig {
  version: 1;
  server: {
    host: string;
    port: number;
    bindMode: 'loopback' | 'lan';
  };
  storage: {
    rootDir: string;
    isolateByWorkspace: boolean;
  };
  knowledge: {
    rootDir: string;
    isolateByWorkspace: boolean;
    sourceDir?: string;
    buildVectorIndex: boolean;
    projectType?: 'generic' | 'symfony' | 'node' | 'vue' | string;
    chunking?: {
      maxChars?: number;
      overlapStrategy?: 'sentence' | 'sliding';
      overlapChars?: number;
      minChars?: number;
    };
  };
  agent: {
    name: string;
    language: 'zh-CN' | 'en-US';
    tone: 'calm_professional' | 'concise' | 'technical';
    modelProvider?: string;
    useModelForPreflight: boolean;
    useModelForRagAnswerability?: boolean;
    ragAnswerabilityTopN?: number;
    useModelForEvidenceCoverage?: boolean;
    evidenceCoverageTopN?: number;
    defaultUserPersona: UserPersona;
    contextWindowTokens: number;
  };
  models: {
    providers: Record<string, ModelProviderConfig>;
  };
  embedding: EmbeddingProviderConfig;
  rerank: RerankProviderConfig;
  claude: {
    enabled: boolean;
    command: string;
    commandWhitelist: string[];
    permissionMode: 'plan' | 'dontAsk' | 'default';
    tools: string[];
    allowedTools: string[];
    disallowedTools: string[];
    timeoutMs: number;
    maxBudgetUsd?: number;
    sessionBusyMaxRetries: number;
    sessionBusyRetryDelayMs: number;
  };
  workspaces: Array<{
    id: string;
    name: string;
    rootPath: string;
    mcpToolIds: string[];
  }>;
  mcpTools: McpServerConfig[];
  onboarding: {
    version: 1;
    completedAt?: string;
    lastRunId?: string;
  };
}
