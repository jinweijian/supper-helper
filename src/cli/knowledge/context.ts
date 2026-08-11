import { join } from 'node:path';
import { defaultConfig, ensureConfig, type SuperHelperConfig } from '../../config.js';
import { resolveKnowledgeWorkspaceRoot } from '../../knowledge/index.js';
import {
  FileSecretsRepository,
  materializeConfigSecrets,
} from '../../onboarding/index.js';
import type { EmbeddingProviderConfig } from '../../providers/embedding/contract.js';
import { hasFlag, readOption } from '../args.js';

export type QualityGateArg = 'warn' | 'strict' | 'off';

export interface KnowledgeCommandContext {
  config: SuperHelperConfig;
  projectWorkspaceRoot: string;
  knowledgeWorkspaceRoot: string;
}

export function resolveKnowledgeCommandContext(argv: string[]): KnowledgeCommandContext {
  const explicit = readOption(argv, '--workspace') ?? readOption(argv, '--path');
  const explicitKnowledgeRoot = readOption(argv, '--knowledge-root');
  const config = explicit && explicitKnowledgeRoot
    ? defaultConfig()
    : materializeKnowledgeCommandConfig(ensureConfig());

  if (explicit) {
    config.workspaces[0] = {
      ...config.workspaces[0],
      id: config.workspaces[0]?.id ?? 'current',
      name: config.workspaces[0]?.name ?? 'Current Project',
      rootPath: explicit,
    };
  }
  if (explicitKnowledgeRoot) {
    config.knowledge.rootDir = explicitKnowledgeRoot;
    config.knowledge.isolateByWorkspace = false;
  }

  return {
    config,
    projectWorkspaceRoot: config.workspaces[0]?.rootPath ?? process.cwd(),
    knowledgeWorkspaceRoot: resolveKnowledgeWorkspaceRoot(config, config.workspaces[0]?.id),
  };
}

export function materializeKnowledgeCommandConfig(config: SuperHelperConfig): SuperHelperConfig {
  return materializeConfigSecrets(
    config,
    new FileSecretsRepository(config.storage.rootDir),
  );
}

export function resolveSourcePath(workspaceRoot: string, relativeOrAbsolute: string): string {
  return relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : join(workspaceRoot, relativeOrAbsolute);
}

export function readQualityGateArg(argv: string[], defaultGate: QualityGateArg): QualityGateArg {
  const value = readOption(argv, '--quality-gate') ?? defaultGate;
  if (value !== 'warn' && value !== 'strict' && value !== 'off') {
    console.error('Invalid --quality-gate. Expected warn|strict|off.');
    process.exit(1);
  }
  return value;
}

export function embeddingConfigFromFlags(
  existing: EmbeddingProviderConfig,
  argv: string[],
): EmbeddingProviderConfig {
  return {
    ...existing,
    enabled: hasFlag(argv, '--enable') || existing.enabled,
    provider: readOption(argv, '--provider') ?? existing.provider,
    model: readOption(argv, '--model') ?? existing.model,
    baseUrl: readOption(argv, '--base-url') ?? existing.baseUrl,
    endpoint: readOption(argv, '--endpoint') ?? existing.endpoint,
    apiKeyEnv: readOption(argv, '--api-key-env') ?? existing.apiKeyEnv,
    dimensions: optionalPositiveInteger(readOption(argv, '--dimensions')) ?? existing.dimensions,
    distance: readOption(argv, '--distance') ?? existing.distance,
    batchSize: optionalPositiveInteger(readOption(argv, '--batch-size')) ?? existing.batchSize,
    timeoutMs: optionalPositiveInteger(readOption(argv, '--timeout-ms')) ?? existing.timeoutMs,
  };
}

function optionalPositiveInteger(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}
