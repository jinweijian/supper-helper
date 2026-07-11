import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SuperHelperConfig } from './contracts.js';

export const DEFAULT_HOME = join(homedir(), '.super-helper');
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
