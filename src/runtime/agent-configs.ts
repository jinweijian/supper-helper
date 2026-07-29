import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AgentStage =
  | 'main'
  | 'input_review'
  | 'preflight'
  | 'experience'
  | 'knowledge_router'
  | 'evidence_judge'
  | 'rag_answerability'
  | 'evidence_coverage'
  | 'visible_prompt_safety'
  | 'case_curator'
  | 'output_review'
  | 'presentation';

export type AgentExecutionMode = 'deterministic' | 'model_assisted' | 'presentation_only';

export interface AgentRegistryEntry {
  id: string;
  role: string;
  stage: AgentStage;
  configPath: string;
  required: boolean;
  mayProduceUserFacingText: boolean;
  executionMode?: AgentExecutionMode;
  summary: string;
}

export interface AgentRegistry {
  version: number;
  agents: AgentRegistryEntry[];
}

export interface ResolvedAgentConfig extends AgentRegistryEntry {
  absolutePath: string;
  content: string;
}

export interface PublicAgentConfig {
  id: string;
  role: string;
  stage: AgentStage;
  configPath: string;
  required: boolean;
  mayProduceUserFacingText: boolean;
  executionMode?: AgentExecutionMode;
  summary: string;
  title: string;
  responsibility: string;
}

export function agentsDirectory(): string {
  const runtimeDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(runtimeDir, '..', '..', 'src', 'agents'),
    resolve(runtimeDir, '..', 'agents'),
  ];
  const existing = candidates.find((candidate) => existsSync(join(candidate, 'registry.json')));
  return existing ?? candidates[0];
}

export function loadAgentRegistry(): AgentRegistry {
  return JSON.parse(readFileSync(join(agentsDirectory(), 'registry.json'), 'utf8')) as AgentRegistry;
}

export function resolveAgentConfig(stage: AgentStage): ResolvedAgentConfig {
  const registry = loadAgentRegistry();
  const entry = registry.agents.find((agent) => agent.stage === stage);
  if (!entry) {
    throw new Error(`Agent config for stage "${stage}" not found`);
  }

  const absolutePath = join(agentsDirectory(), entry.configPath);
  return {
    ...entry,
    absolutePath,
    content: readFileSync(absolutePath, 'utf8'),
  };
}

export function listPublicAgentConfigs(): PublicAgentConfig[] {
  return loadAgentRegistry().agents.map((entry) => {
    const absolutePath = join(agentsDirectory(), entry.configPath);
    const content = readFileSync(absolutePath, 'utf8');
    return {
      ...entry,
      title: extractTitle(content),
      responsibility: extractSectionSummary(content, 'Responsibility') || entry.summary,
    };
  });
}

function extractTitle(content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Agent';
}

function extractSectionSummary(content: string, section: string): string {
  const match = content.match(new RegExp(`## ${section}\\n\\n([\\s\\S]*?)(?:\\n## |$)`));
  return match?.[1]?.replace(/\s+/g, ' ').trim() || '';
}
