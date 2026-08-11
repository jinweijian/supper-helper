import {
  defaultSourceDirectory,
  initKnowledgeWorkspace,
} from '../../knowledge/index.js';
import { rebuildKnowledgeArtifactsWithQuality } from '../../application/knowledge-rebuild-service.js';
import type { EmbeddingDocumentPort } from '../../contracts/embedding.js';
import type { SuperHelperConfig } from '../../config.js';
import { createEmbeddingProvider } from '../../providers/embedding/factory.js';
import { resolveApiKey } from '../../providers/http.js';
import { hasFlag, readOption } from '../args.js';
import type { KnowledgeCommandContext } from './context.js';
import { readQualityGateArg } from './context.js';
import { printQualitySummary } from './output.js';

export async function runKnowledgeWorkspaceCommand(
  argv: string[],
  context: KnowledgeCommandContext,
): Promise<boolean> {
  const subcommand = argv[0];
  const workspaceRoot = context.knowledgeWorkspaceRoot;

  if (subcommand === 'init') {
    const sourceDir = readOption(argv, '--source-dir') ?? readOption(argv, '--source') ?? defaultSourceDirectory();
    const gate = readQualityGateArg(argv, 'warn');
    const legacyActivePublish = hasFlag(argv, '--legacy-active-publish');
    const result = initKnowledgeWorkspace({
      workspaceRoot,
      sourceDir,
      force: hasFlag(argv, '--force'),
      legacyActivePublish,
      qualityGate: gate,
      chunking: context.config.knowledge.chunking,
    });
    console.log('knowledge workspace ready');
    console.log(`workspace: ${context.projectWorkspaceRoot}`);
    console.log(`knowledge workspace: ${workspaceRoot}`);
    console.log(`knowledge: ${result.knowledgeRoot}`);
    if (sourceDir) console.log(`source dir: ${sourceDir}`);
    console.log(`directories created: ${result.directories.length}`);
    console.log(`files written: ${result.files.length}`);
    if (result.ingestReportPath) console.log(`ingest report: ${result.ingestReportPath}`);
    if (legacyActivePublish) {
      console.log('warning: legacy active publish enabled; normal review/publish gate was bypassed.');
    }
    printQualitySummary(result);
    if (result.qualityGateResult && !result.qualityGateResult.passed) {
      console.error(`gate failed: ${result.qualityGateResult.reason}`);
      process.exit(result.qualityGateResult.exitCode);
    }
    console.log('next: super-helper knowledge update --workspace <workspace> [--knowledge-root <path>]');
    return true;
  }

  if (subcommand === 'update') {
    const gate = readQualityGateArg(argv, 'warn');
    const rebuilt = await rebuildKnowledgeArtifactsWithQuality({
      workspaceRoot,
      qualityGate: gate,
      chunking: context.config.knowledge.chunking,
      embedding: createKnowledgeRebuildEmbedding(context.config),
    });
    const result = rebuilt.index;
    if (!rebuilt.published && result.qualityGateResult && !result.qualityGateResult.passed) {
      printQualitySummary(result);
      console.error(`gate failed before publish: ${result.qualityGateResult.reason}`);
      process.exit(result.qualityGateResult.exitCode);
    }
    console.log('knowledge index updated');
    console.log(`workspace: ${context.projectWorkspaceRoot}`);
    console.log(`knowledge workspace: ${workspaceRoot}`);
    console.log(`knowledge: ${result.knowledgeRoot}`);
    console.log(`documents: ${result.documentCount}`);
    console.log(`chunks: ${result.chunkCount}`);
    console.log(`source documents: ${result.sourceDocumentCount}`);
    console.log(`manifest: ${result.manifestPath}`);
    console.log(`chunks path: ${result.chunksPath}`);
    printQualitySummary(result);
    if (result.qualityGateResult && !result.qualityGateResult.passed) {
      console.error(`gate failed: ${result.qualityGateResult.reason}`);
      process.exit(result.qualityGateResult.exitCode);
    }
    return true;
  }

  return false;
}

export function createKnowledgeRebuildEmbedding(
  config: SuperHelperConfig,
  providerFactory: (providerConfig: SuperHelperConfig['embedding']) => EmbeddingDocumentPort = createEmbeddingProvider,
): {
  enabled: true;
  provider: EmbeddingDocumentPort;
  config: SuperHelperConfig['embedding'];
} | undefined {
  if (
    !config.embedding.enabled ||
    (config.embedding.provider !== 'fake' && !resolveApiKey(config.embedding))
  ) {
    return undefined;
  }
  return {
    enabled: true,
    provider: providerFactory(config.embedding),
    config: config.embedding,
  };
}
