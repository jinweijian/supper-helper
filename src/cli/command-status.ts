import { existsSync } from 'node:fs';
import { configPath, loadConfig } from '../config.js';
import { createKnowledgeManagementService } from '../application/knowledge-management-service.js';
import { FileOnboardingRunRepository } from '../onboarding/index.js';
import { readOption } from './args.js';
import { resolveServerBinding } from './bindings.js';

export interface RunStatusCommandInput {
  argv?: string[];
  rootDir?: string;
  probeHealth?: (url: string) => Promise<boolean>;
  write?: (line: string) => void;
}

export async function runStatusCommand(input: RunStatusCommandInput = {}): Promise<void> {
  const argv = input.argv ?? [];
  const rootDir = input.rootDir ?? readOption(argv, '--home');
  const write = input.write ?? ((line: string) => console.log(line));
  const path = configPath(rootDir);

  if (!existsSync(path)) {
    write(`config: missing (${path})`);
    write('onboarding: not configured');
    write('service: stopped');
    return;
  }

  const config = loadConfig(path);
  const binding = resolveServerBinding({
    bind: config.server.bindMode,
    host: config.server.host,
    port: config.server.port,
  });
  const serviceOk = await (input.probeHealth ?? probeHealth)(`${binding.localUrl}/api/health`);
  const runs = new FileOnboardingRunRepository(config.storage.rootDir);
  const latestRun = runs.latest();
  const knowledge = await createKnowledgeManagementService(config)
    .getLocalHealth(config.workspaces[0]?.id ?? 'current');

  write(`config: ${path}`);
  write(`service: ${serviceOk ? 'running' : 'stopped'} (${binding.localUrl})`);
  write(`onboarding: ${config.onboarding.completedAt ? 'completed' : 'pending'}`);
  if (latestRun) {
    write(`latest run: ${latestRun.status} ${latestRun.overallProgress}% (${latestRun.id})`);
  } else {
    write('latest run: none');
  }
  write(`workspace: ${config.workspaces[0]?.rootPath ?? '(missing)'}`);
  write(`knowledge: ${knowledge.index.status} docs=${knowledge.index.documentCount} chunks=${knowledge.index.chunkCount}`);
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
