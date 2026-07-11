import { runKnowledgePipelineCommand } from './knowledge/command-pipeline.js';
import { runKnowledgeVectorCommand } from './knowledge/command-vector.js';
import { runKnowledgeWorkspaceCommand } from './knowledge/command-workspace.js';
import { resolveKnowledgeCommandContext } from './knowledge/context.js';

export async function runKnowledgeCommand(argv: string[]): Promise<void> {
  const context = resolveKnowledgeCommandContext(argv);
  if (await runKnowledgeVectorCommand(argv, context)) return;
  if (await runKnowledgeWorkspaceCommand(argv, context)) return;
  if (await runKnowledgePipelineCommand(argv, context)) return;
  console.error('Usage: super-helper knowledge <init|update|extract|normalize|slice|audit|repair|review|publish|migration-report|redmine import-fixture|vector build> [--workspace <path>] [--knowledge-root <path>]');
  process.exit(1);
}
