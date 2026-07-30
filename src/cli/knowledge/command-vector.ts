import { rebuildKnowledgeArtifacts } from '../../application/knowledge-rebuild-service.js';
import { createEmbeddingProvider } from '../../providers/embedding/factory.js';
import { formatProviderSafeError } from '../../providers/errors.js';
import type { KnowledgeCommandContext } from './context.js';
import { embeddingConfigFromFlags } from './context.js';

export async function runKnowledgeVectorCommand(
  argv: string[],
  context: KnowledgeCommandContext,
): Promise<boolean> {
  if (argv[0] !== 'vector' || argv[1] !== 'build') return false;
  const embedding = embeddingConfigFromFlags(context.config.embedding, argv);
  if (!embedding.enabled) {
    console.log('embedding disabled');
    console.log(`provider: ${embedding.provider}`);
    console.log(`model: ${embedding.model}`);
    process.exit(1);
  }
  try {
    const provider = createEmbeddingProvider(embedding);
    const rebuilt = await rebuildKnowledgeArtifacts({
      workspaceRoot: context.knowledgeWorkspaceRoot,
      chunking: context.config.knowledge.chunking,
      embedding: { enabled: true, provider, config: embedding },
    });
    const result = rebuilt.vector!;
    console.log('knowledge vector index built');
    console.log(`workspace: ${context.projectWorkspaceRoot}`);
    console.log(`knowledge workspace: ${context.knowledgeWorkspaceRoot}`);
    console.log(`provider: ${result.provider}`);
    console.log(`model: ${result.model}`);
    console.log(`dimensions: ${result.dimensions}`);
    console.log(`distance: ${result.distance}`);
    console.log(`vectors: ${result.vectorCount}`);
    console.log(`skipped: ${result.skipped.length}`);
    console.log(`failed: ${result.failures.length}`);
    console.log(`vectors path: ${result.vectorsPath}`);
    console.log(`manifest: ${result.manifestPath}`);
    return true;
  } catch (error) {
    console.error(formatProviderSafeError(error));
    process.exit(1);
  }
}
