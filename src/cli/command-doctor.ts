import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { configPath, loadConfig, type ModelProviderConfig, type SuperHelperConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
import { createKnowledgeManagementService } from '../application/knowledge-management-service.js';
import { FileOnboardingRunRepository, FileSecretsRepository } from '../onboarding/index.js';
import type { EmbeddingProviderConfig } from '../providers/embedding/index.js';
import type { RerankProviderConfig } from '../providers/rerank/index.js';
import { readOption } from './args.js';
import { resolveServerBinding } from './bindings.js';

export type DoctorSeverity = 'ok' | 'warn' | 'error' | 'info';

export interface DoctorCheck {
  id: string;
  label: string;
  severity: DoctorSeverity;
  message: string;
}

export interface RunDoctorCommandInput {
  argv?: string[];
  rootDir?: string;
  env?: Record<string, string | undefined>;
  checkClaude?: (command: string) => Promise<{ ok: boolean; version?: string }>;
  probeHealth?: (url: string) => Promise<boolean>;
  write?: (line: string) => void;
}

export async function runDoctorCommand(input: RunDoctorCommandInput = {}): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const argv = input.argv ?? [];
  const rootDir = input.rootDir ?? readOption(argv, '--home');
  const env = input.env ?? process.env;
  const write = input.write ?? ((line: string) => console.log(line));
  const path = configPath(rootDir);
  const checks: DoctorCheck[] = [];

  if (!existsSync(path)) {
    checks.push({ id: 'config', label: 'config', severity: 'error', message: `missing (${path})` });
    writeChecks(write, checks);
    return { ok: false, checks };
  }

  let config: SuperHelperConfig;
  try {
    config = loadConfig(path);
    checks.push({ id: 'config', label: 'config', severity: 'ok', message: path });
  } catch (error) {
    checks.push({ id: 'config', label: 'config', severity: 'error', message: safeError(error) });
    writeChecks(write, checks);
    return { ok: false, checks };
  }

  const workspacePath = config.workspaces[0]?.rootPath;
  checks.push(checkDirectory('workspace', workspacePath));
  checks.push(checkCreatableParent('storage', config.storage.rootDir));
  checks.push(checkCreatableParent('knowledge', config.knowledge.rootDir));

  const secrets = new FileSecretsRepository(config.storage.rootDir);
  const activeProvider = config.agent.modelProvider ? config.models.providers[config.agent.modelProvider] : undefined;
  checks.push(checkModelProviderSecret('agent model', activeProvider, secrets, env, !config.agent.useModelForPreflight));
  checks.push(checkProviderSecret('embedding', config.embedding, secrets, env));
  checks.push(checkProviderSecret('rerank', config.rerank, secrets, env));

  const runs = new FileOnboardingRunRepository(config.storage.rootDir);
  const latestRun = runs.latest();
  if (!latestRun) {
    checks.push({ id: 'onboarding_run', label: 'onboarding run', severity: 'info', message: 'none' });
  } else if (latestRun.status === 'failed') {
    checks.push({
      id: 'onboarding_run',
      label: 'onboarding run',
      severity: 'warn',
      message: `${latestRun.status}; retry from dashboard if needed`,
    });
  } else {
    checks.push({
      id: 'onboarding_run',
      label: 'onboarding run',
      severity: 'ok',
      message: `${latestRun.status} ${latestRun.overallProgress}%`,
    });
  }

  const knowledge = await createKnowledgeManagementService(config)
    .getLocalHealth(config.workspaces[0]?.id ?? 'current');
  checks.push({
    id: 'knowledge_index',
    label: 'knowledge index',
    severity: knowledgeSeverity(knowledge.index.status),
    message: `docs=${knowledge.index.documentCount} chunks=${knowledge.index.chunkCount} ${knowledge.index.message}`,
  });

  const claude = await (input.checkClaude ?? checkClaudeCommand)(config.claude.command);
  checks.push({
    id: 'claude',
    label: 'claude',
    severity: claude.ok ? 'ok' : 'warn',
    message: claude.ok ? (claude.version ?? 'available') : 'not available',
  });

  const binding = resolveServerBinding({
    bind: config.server.bindMode,
    host: config.server.host,
    port: config.server.port,
  });
  const serviceOk = await (input.probeHealth ?? probeHealth)(`${binding.localUrl}/api/health`);
  checks.push({
    id: 'service',
    label: 'service',
    severity: serviceOk ? 'ok' : 'info',
    message: serviceOk ? `running (${binding.localUrl})` : 'not running',
  });

  writeChecks(write, checks);
  return { ok: checks.every((check) => check.severity !== 'error'), checks };
}

function checkDirectory(label: string, path?: string): DoctorCheck {
  if (!path) {
    return { id: label, label, severity: 'error', message: 'missing path' };
  }
  try {
    const stat = statSync(path);
    return {
      id: label,
      label,
      severity: stat.isDirectory() ? 'ok' : 'error',
      message: stat.isDirectory() ? 'ok' : 'not a directory',
    };
  } catch {
    return { id: label, label, severity: 'error', message: `not found (${path})` };
  }
}

function knowledgeSeverity(status: 'ok' | 'warn' | 'error' | 'off'): DoctorSeverity {
  if (status === 'error') {
    return 'warn';
  }
  if (status === 'off') {
    return 'info';
  }
  return status;
}

function checkCreatableParent(label: string, path: string): DoctorCheck {
  try {
    mkdirSync(dirname(path), { recursive: true });
    return { id: label, label, severity: 'ok', message: path };
  } catch (error) {
    return { id: label, label, severity: 'error', message: safeError(error) };
  }
}

function checkModelProviderSecret(
  label: string,
  provider: ModelProviderConfig | undefined,
  secrets: FileSecretsRepository,
  env: Record<string, string | undefined>,
  optional: boolean,
): DoctorCheck {
  if (!provider) {
    return {
      id: 'agent_model_secret',
      label,
      severity: optional ? 'info' : 'error',
      message: optional ? 'not configured; model preflight disabled' : 'not configured',
    };
  }
  return secretCheck('agent_model_secret', label, provider, secrets, env);
}

function checkProviderSecret(
  label: string,
  provider: EmbeddingProviderConfig | RerankProviderConfig,
  secrets: FileSecretsRepository,
  env: Record<string, string | undefined>,
): DoctorCheck {
  if (!provider.enabled) {
    return { id: `${label}_secret`, label, severity: 'info', message: 'disabled' };
  }
  if (provider.provider === 'fake') {
    return { id: `${label}_secret`, label, severity: 'ok', message: 'fake provider does not need a secret' };
  }
  return secretCheck(`${label}_secret`, label, provider, secrets, env);
}

function secretCheck(
  id: string,
  label: string,
  provider: { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef },
  secrets: FileSecretsRepository,
  env: Record<string, string | undefined>,
): DoctorCheck {
  if (provider.apiKey) {
    return { id, label, severity: 'ok', message: 'configured' };
  }
  if (provider.apiKeyRef) {
    const ok = hasSecretRef(provider.apiKeyRef, secrets, env);
    return {
      id,
      label,
      severity: ok ? 'ok' : 'error',
      message: provider.apiKeyRef.source === 'env'
        ? (ok ? `env ${provider.apiKeyRef.name}` : `missing env ${provider.apiKeyRef.name}`)
        : (ok ? 'file secret configured' : 'file secret missing'),
    };
  }
  if (provider.apiKeyEnv) {
    return {
      id,
      label,
      severity: env[provider.apiKeyEnv] ? 'ok' : 'error',
      message: env[provider.apiKeyEnv] ? `env ${provider.apiKeyEnv}` : `missing env ${provider.apiKeyEnv}`,
    };
  }
  return { id, label, severity: 'error', message: 'missing secret' };
}

function hasSecretRef(
  ref: SecretRef,
  secrets: FileSecretsRepository,
  env: Record<string, string | undefined>,
): boolean {
  if (ref.source === 'env') {
    return Boolean(env[ref.name]);
  }
  return secrets.has(ref);
}

async function checkClaudeCommand(command: string): Promise<{ ok: boolean; version?: string }> {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    version: result.status === 0 ? result.stdout.trim() : undefined,
  };
}

async function probeHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function writeChecks(write: (line: string) => void, checks: DoctorCheck[]): void {
  for (const check of checks) {
    write(`${check.label}: ${check.severity} - ${check.message}`);
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
