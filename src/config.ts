import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SecretRef, UserPersona } from './domain.js';
import type { EmbeddingProviderConfig } from './providers/embedding/contract.js';
import type { RerankProviderConfig } from './providers/rerank/contract.js';
import type { McpServerConfig } from './mcp/contracts.js';
import { writeJsonAtomic } from './onboarding/atomic-json.js';

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

export class InvalidWorkspaceIdError extends Error {
  constructor() {
    super('invalid workspaceId');
    this.name = 'InvalidWorkspaceIdError';
  }
}

export function configuredWorkspaceId(
  config: SuperHelperConfig,
  requested?: string | null,
): string {
  const workspaceId = requested?.trim() || config.workspaces[0]?.id;
  if (!workspaceId || !config.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new InvalidWorkspaceIdError();
  }
  return workspaceId;
}

const DEFAULT_HOME = join(homedir(), '.super-helper');

export function defaultConfig(): SuperHelperConfig {
  const cwd = process.cwd();

  return {
    version: 1,
    server: {
      host: '127.0.0.1',
      port: 4317,
      bindMode: 'loopback',
    },
    storage: {
      rootDir: DEFAULT_HOME,
      isolateByWorkspace: true,
    },
    knowledge: {
      rootDir: join(DEFAULT_HOME, 'knowledge'),
      isolateByWorkspace: true,
      // 默认启用向量索引构建：双路召回（BM25+Embedding）是默认检索路径，
      // 无 API key 时 configured-search 会优雅降级为纯 BM25（embedding strategy 标 skipped）。
      buildVectorIndex: true,
      projectType: 'generic',
      chunking: {
        maxChars: 800,
        overlapStrategy: 'sentence',
        overlapChars: 120,
        minChars: 80,
      },
    },
    agent: {
      name: 'super helper',
      language: 'zh-CN',
      tone: 'calm_professional',
      useModelForPreflight: false,
      useModelForRagAnswerability: true,
      ragAnswerabilityTopN: 3,
      useModelForEvidenceCoverage: true,
      evidenceCoverageTopN: 3,
      defaultUserPersona: 'operations',
      contextWindowTokens: 200_000,
    },
    models: {
      providers: {},
    },
    embedding: {
      // 默认启用 embedding 双路召回；无 API key 时 strategy.enabled() 返回 false 并降级为纯 BM25。
      enabled: true,
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-0.6B',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      dimensions: 1024,
      distance: 'cosine',
      batchSize: 16,
      timeoutMs: 60_000,
    },
    rerank: {
      enabled: false,
      provider: 'siliconflow',
      model: 'BAAI/bge-reranker-v2-m3',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      timeoutMs: 60_000,
      // 与最终检索 limit 对齐（configured-search 限制为 8），让 rerank 真正主导全部 top 候选，
      // 而非只返回 2 条、其余按原序补回导致 cross-encoder 精度优势被浪费。
      topN: 8,
    },
    claude: {
      enabled: true,
      command: 'claude',
      commandWhitelist: ['claude'],
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: [
        'Bash',
        'Edit',
        'Write',
        'MultiEdit',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
      ],
      timeoutMs: 1_200_000,
      sessionBusyMaxRetries: 10,
      sessionBusyRetryDelayMs: 10_000,
    },
    workspaces: [
      {
        id: 'current',
        name: 'Current Project',
        rootPath: cwd,
        mcpToolIds: [],
      },
    ],
    mcpTools: [],
    onboarding: {
      version: 1,
    },
  };
}

export function configPath(homeDir = DEFAULT_HOME): string {
  return join(homeDir, 'config.json');
}

export function ensureConfig(homeDir = DEFAULT_HOME): SuperHelperConfig {
  const path = configPath(homeDir);
  if (!existsSync(path)) {
    const config = defaultConfig();
    config.storage.rootDir = homeDir;
    config.knowledge.rootDir = join(homeDir, 'knowledge');
    saveConfig(config, path);
    return config;
  }

  const config = loadConfig(path);
  saveConfig(config);
  return config;
}

export function loadConfig(path = configPath()): SuperHelperConfig {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<SuperHelperConfig>;
  const defaults = defaultConfig();
  const merged: SuperHelperConfig = {
    ...defaults,
    ...parsed,
    server: { ...defaults.server, ...parsed.server },
    storage: { ...defaults.storage, ...parsed.storage },
    knowledge: { ...defaults.knowledge, ...parsed.knowledge },
    agent: { ...defaults.agent, ...parsed.agent },
    models: { ...defaults.models, ...parsed.models },
    embedding: { ...defaults.embedding, ...parsed.embedding },
    rerank: { ...defaults.rerank, ...parsed.rerank },
    claude: { ...defaults.claude, ...parsed.claude },
    workspaces: parsed.workspaces?.length ? parsed.workspaces : defaults.workspaces,
    mcpTools: parsed.mcpTools ?? defaults.mcpTools,
    onboarding: { ...defaults.onboarding, ...parsed.onboarding },
  };
  merged.storage.rootDir = resolve(merged.storage.rootDir || DEFAULT_HOME);
  merged.knowledge.rootDir = resolve(parsed.knowledge?.rootDir || join(merged.storage.rootDir, 'knowledge'));
  merged.agent.modelProvider = selectActiveModelProvider(merged);
  merged.agent.useModelForRagAnswerability =
    parsed.agent?.useModelForRagAnswerability ??
    parsed.agent?.useModelForEvidenceCoverage ??
    merged.agent.useModelForRagAnswerability ??
    true;
  merged.agent.useModelForEvidenceCoverage = merged.agent.useModelForRagAnswerability;
  merged.agent.ragAnswerabilityTopN =
    parsed.agent?.ragAnswerabilityTopN ??
    parsed.agent?.evidenceCoverageTopN ??
    merged.agent.ragAnswerabilityTopN ??
    3;
  merged.agent.evidenceCoverageTopN = merged.agent.ragAnswerabilityTopN;
  // 0.2 used to be the implicit default. Treat that legacy value as unset.
  if (parsed.claude?.maxBudgetUsd === 0.2) {
    delete merged.claude.maxBudgetUsd;
  }
  return merged;
}

export function saveConfig(config: SuperHelperConfig, path = configPath(config.storage.rootDir)): void {
  writeJsonAtomic(path, configForPersistence(config));
}

export function configForPersistence(config: SuperHelperConfig): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const provider of Object.values(copy.models?.providers ?? {})) {
    if (provider.apiKeyRef) {
      delete provider.apiKey;
    }
  }
  if (copy.embedding?.apiKeyRef) {
    delete copy.embedding.apiKey;
  }
  if (copy.rerank?.apiKeyRef) {
    delete copy.rerank.apiKey;
  }
  return copy;
}

export function getModelProvider(config: SuperHelperConfig): ModelProviderConfig | undefined {
  if (!config.agent.modelProvider) {
    return undefined;
  }

  return config.models.providers[config.agent.modelProvider];
}

export function getEmbeddingConfig(config: SuperHelperConfig): EmbeddingProviderConfig {
  return config.embedding;
}

export function isEmbeddingEnabled(config: SuperHelperConfig): boolean {
  return config.embedding.enabled === true;
}

export function resolveEmbeddingSecret(config: EmbeddingProviderConfig): string | undefined {
  return resolveSecret(config.apiKey, config.apiKeyEnv);
}

function selectActiveModelProvider(config: SuperHelperConfig): string | undefined {
  if (config.agent.modelProvider && config.models.providers[config.agent.modelProvider]) {
    return config.agent.modelProvider;
  }

  const providerIds = Object.keys(config.models.providers);
  return providerIds.length === 1 ? providerIds[0] : config.agent.modelProvider;
}

export function resolveContextWindowTokens(config: SuperHelperConfig): number {
  const provider = getModelProvider(config);
  return (
    positiveInteger(provider?.contextWindowTokens) ??
    inferModelContextWindowTokens(provider?.model) ??
    positiveInteger(config.agent.contextWindowTokens) ??
    1
  );
}

export function inferModelContextWindowTokens(model?: string): number | undefined {
  const normalized = model?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'minimaxm3') {
    return 1_000_000;
  }

  return undefined;
}

function positiveInteger(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

export function resolveSecret(value?: string, envName?: string): string | undefined {
  if (value) {
    return value;
  }

  if (envName) {
    return process.env[envName];
  }

  return undefined;
}
