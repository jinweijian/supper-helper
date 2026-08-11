import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  configPath,
  defaultConfig,
  loadConfig,
} from '../config.js';
import {
  runEmbeddingSmokeTest,
  type EmbeddingProviderConfig,
} from '../providers/embedding/index.js';
import {
  runRerankSmokeTest,
  type RerankProviderConfig,
} from '../providers/rerank/index.js';
import {
  FileSecretsRepository,
  materializeConfigSecrets,
} from '../onboarding/index.js';
import { hasFlag, readNumberOption, readOption } from './args.js';

export async function runProviderCommand(input: {
  capability: 'embedding' | 'rerank';
  argv: string[];
}): Promise<void> {
  const subcommand = input.argv[0];
  if (subcommand !== 'test') {
    console.error(input.capability === 'embedding'
      ? 'Usage: super-helper embedding test [--enable] [--provider siliconflow|fake] [--model <model>] [--dimensions <n>] [--api-key-env <env>] [--base-url <url>]'
      : 'Usage: super-helper rerank test [--enable] [--provider siliconflow] [--model <model>] [--api-key-env <env>] [--base-url <url>]');
    process.exit(1);
  }

  const config = loadProviderCommandConfig(readOption(input.argv, '--home'));
  if (input.capability === 'embedding') {
    const embedding = embeddingConfigFromFlags(config.embedding, input.argv);
    const result = await runEmbeddingSmokeTest({ config: embedding, force: hasFlag(input.argv, '--enable') });
    if (!result.ok && result.error?.code === 'disabled') {
      console.log('embedding disabled');
      console.log(`provider: ${result.provider}`);
      console.log(`model: ${result.model}`);
      return;
    }
    console.log(result.ok ? 'embedding model ok' : 'embedding model failed');
    console.log(`provider: ${result.provider}`);
    console.log(`model: ${result.model}`);
    console.log(`dimensions: ${result.dimensions}`);
    console.log(`durationMs: ${result.durationMs}`);
    if (result.error) {
      console.log(`error: ${result.error.code} ${result.error.safeMessage}`);
    }
    if (!result.ok) {
      process.exit(1);
    }
    return;
  }

  const rerank = rerankConfigFromFlags(config.rerank, input.argv);
  const result = await runRerankSmokeTest({ config: rerank, force: hasFlag(input.argv, '--enable') });
  if (!result.ok && result.error?.code === 'disabled') {
    console.log('rerank disabled');
    console.log(`provider: ${result.provider}`);
    console.log(`model: ${result.model}`);
    return;
  }
  console.log(result.ok ? 'rerank model ok' : 'rerank model failed');
  console.log(`provider: ${result.provider}`);
  console.log(`model: ${result.model}`);
  console.log(`durationMs: ${result.durationMs}`);
  if (result.topScore !== undefined) {
    console.log(`top score: ${result.topScore}`);
  }
  if (result.error) {
    console.log(`error: ${result.error.code} ${result.error.safeMessage}`);
  }
  if (!result.ok) {
    process.exit(1);
  }
}

export function loadProviderCommandConfig(homeDir?: string) {
  const path = configPath(homeDir);
  const config = existsSync(path) ? loadConfig(path) : defaultConfig();
  if (homeDir) {
    config.storage.rootDir = homeDir;
    config.knowledge.rootDir = join(homeDir, 'knowledge');
  }
  return materializeConfigSecrets(
    config,
    new FileSecretsRepository(homeDir ?? config.storage.rootDir),
  );
}

function embeddingConfigFromFlags(existing: EmbeddingProviderConfig, argv: string[]): EmbeddingProviderConfig {
  return {
    ...existing,
    enabled: hasFlag(argv, '--enable') || existing.enabled,
    provider: readOption(argv, '--provider') ?? existing.provider,
    model: readOption(argv, '--model') ?? existing.model,
    baseUrl: readOption(argv, '--base-url') ?? existing.baseUrl,
    endpoint: readOption(argv, '--endpoint') ?? existing.endpoint,
    apiKeyEnv: readOption(argv, '--api-key-env') ?? existing.apiKeyEnv,
    dimensions: readNumberOption(argv, '--dimensions') ?? existing.dimensions,
    distance: readOption(argv, '--distance') ?? existing.distance,
    batchSize: readNumberOption(argv, '--batch-size') ?? existing.batchSize,
    timeoutMs: readNumberOption(argv, '--timeout-ms') ?? existing.timeoutMs,
  };
}

function rerankConfigFromFlags(existing: RerankProviderConfig, argv: string[]): RerankProviderConfig {
  return {
    ...existing,
    enabled: hasFlag(argv, '--enable') || existing.enabled,
    provider: readOption(argv, '--provider') ?? existing.provider,
    model: readOption(argv, '--model') ?? existing.model,
    baseUrl: readOption(argv, '--base-url') ?? existing.baseUrl,
    endpoint: readOption(argv, '--endpoint') ?? existing.endpoint,
    apiKeyEnv: readOption(argv, '--api-key-env') ?? existing.apiKeyEnv,
    timeoutMs: readNumberOption(argv, '--timeout-ms') ?? existing.timeoutMs,
    topN: readNumberOption(argv, '--top-n') ?? existing.topN,
  };
}
