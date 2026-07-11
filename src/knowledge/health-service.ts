import type { SuperHelperConfig } from '../config.js';
import {
  buildKnowledgeHealthSummary,
  initKnowledgeWorkspace,
  resolveKnowledgeWorkspaceRoot,
  updateKnowledgeIndexWithQuality,
  type KnowledgeHealthSummary,
} from './index.js';

export type { KnowledgeHealthSummary };

export interface KnowledgeHealthInput {
  config: SuperHelperConfig;
  workspaceId: string;
}

export async function getLocalKnowledgeHealthSummary(input: KnowledgeHealthInput): Promise<KnowledgeHealthSummary> {
  return buildKnowledgeHealthSummary({
    config: input.config,
    workspaceId: input.workspaceId,
  });
}

export function bindKnowledgeWorkspace(input: {
  config: SuperHelperConfig;
  workspaceId: string;
}) {
  return initKnowledgeWorkspace({
    workspaceRoot: resolveKnowledgeWorkspaceRoot(input.config, input.workspaceId),
    chunking: input.config.knowledge.chunking,
  });
}

export function reindexKnowledgeWorkspace(input: {
  config: SuperHelperConfig;
  workspaceId: string;
}) {
  const workspaceRoot = resolveKnowledgeWorkspaceRoot(input.config, input.workspaceId);
  initKnowledgeWorkspace({
    workspaceRoot,
    chunking: input.config.knowledge.chunking,
  });
  return updateKnowledgeIndexWithQuality({
    workspaceRoot,
    chunking: input.config.knowledge.chunking,
  });
}
