import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeJsonAtomic } from '../onboarding/atomic-json.js';
import type { SuperHelperConfig } from './contracts.js';
import { DEFAULT_HOME, defaultConfig } from './defaults.js';
import { selectActiveModelProvider } from './resolution.js';

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
