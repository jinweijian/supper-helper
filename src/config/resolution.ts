import type { EmbeddingProviderConfig } from '../providers/embedding/contract.js';
import type { ModelProviderConfig, SuperHelperConfig } from './contracts.js';

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

export function selectActiveModelProvider(config: SuperHelperConfig): string | undefined {
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
