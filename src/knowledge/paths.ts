import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

export function knowledgeRoot(workspaceRoot: string): string {
  return join(workspaceRoot, 'knowledge');
}

export function relativeKnowledgePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path).replaceAll('\\', '/');
}

export function indexesDir(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), 'indexes');
}

export function manifestPath(workspaceRoot: string): string {
  return activeArtifactPath(workspaceRoot, 'manifest.json');
}

export function keywordIndexPath(workspaceRoot: string): string {
  return activeArtifactPath(workspaceRoot, 'keyword-index.json');
}

export function chunksPath(workspaceRoot: string): string {
  return activeArtifactPath(workspaceRoot, 'chunks.jsonl');
}

export function vectorsPath(workspaceRoot: string): string {
  return activeArtifactPath(workspaceRoot, 'vectors.jsonl');
}

export function vectorManifestPath(workspaceRoot: string): string {
  return activeArtifactPath(workspaceRoot, 'vector-manifest.json');
}

export function vectorBuildReportPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'vector-build-report.json');
}

export function ingestReportPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'ingest-report.json');
}

export function dirtyFlagPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'dirty.flag');
}

function activeArtifactPath(workspaceRoot: string, fileName: string): string {
  const root = indexesDir(workspaceRoot);
  const pointerPath = join(root, 'active.json');
  if (!existsSync(pointerPath)) return join(root, fileName);
  try {
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as {
      version?: unknown;
      generation_id?: unknown;
    };
    const generationId = pointer.generation_id;
    if (
      pointer.version === 1 &&
      typeof generationId === 'string' &&
      basename(generationId) === generationId &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(generationId)
    ) {
      const generationRoot = join(root, 'generations', generationId);
      const manifest = JSON.parse(
        readFileSync(join(generationRoot, 'generation-manifest.json'), 'utf8'),
      ) as {
        version?: unknown;
        generation_id?: unknown;
        chunk_artifact_version?: unknown;
        chunking_strategy?: unknown;
        mode?: unknown;
        files?: unknown;
      };
      const complete = JSON.parse(
        readFileSync(join(generationRoot, 'complete.json'), 'utf8'),
      ) as {
        version?: unknown;
        generation_id?: unknown;
        manifest_hash?: unknown;
      };
      const manifestHash = createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');
      if (
        manifest.version === 1 &&
        manifest.generation_id === generationId &&
        manifest.chunk_artifact_version === 4 &&
        manifest.chunking_strategy === 'parent-child-v4' &&
        (manifest.mode === 'bm25_only' || manifest.mode === 'hybrid') &&
        Array.isArray(manifest.files) &&
        complete.version === 1 &&
        complete.generation_id === generationId &&
        complete.manifest_hash === manifestHash
      ) {
        // A valid active generation owns every artifact lookup. Returning the
        // generation-local missing path prevents fallback to stale flat files.
        return join(generationRoot, fileName);
      }
    }
  } catch {
    // Malformed active pointers never fall through to a partially written generation.
  }
  return join(root, fileName);
}

// Pipeline root paths
export function pipelineRoot(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), '_pipeline');
}

export function pipelineExtractsRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'extracts');
}

export function pipelineNormalizedRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'normalized');
}

export function pipelineDraftsRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'drafts');
}

export function pipelineRepairPlansRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'repair-plans');
}

export function pipelineReviewRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'review');
}

export function pipelinePublishRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'publish');
}

export function knowledgeReportsRoot(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), 'reports');
}

// Source-specific file paths
export function sourceBlocksPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineExtractsRoot(workspaceRoot), `${sourceDocumentId}.blocks.jsonl`);
}

export function sourceExtractReportPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineExtractsRoot(workspaceRoot), `${sourceDocumentId}.extract-report.json`);
}

export function normalizedBlocksPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineNormalizedRoot(workspaceRoot), `${sourceDocumentId}.blocks.jsonl`);
}

export function sourceNormalizeReportPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineNormalizedRoot(workspaceRoot), `${sourceDocumentId}.normalize-report.json`);
}

export function sourceDraftRoot(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineDraftsRoot(workspaceRoot), sourceDocumentId);
}

export function sourceDraftReportPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineDraftsRoot(workspaceRoot), `${sourceDocumentId}.draft-report.json`);
}

// Report file paths
export function qualityReportPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'chunk-quality-report.json');
}

export function sourceQualityReportPath(workspaceRoot: string): string {
  return join(knowledgeReportsRoot(workspaceRoot), 'source-quality-report.json');
}

export function publishReportPath(workspaceRoot: string): string {
  return join(pipelinePublishRoot(workspaceRoot), 'publish-report.json');
}

export function repairPlanPath(workspaceRoot: string, timestamp: string): string {
  return join(pipelineRepairPlansRoot(workspaceRoot), `repair-plan-${timestamp}.json`);
}

export function repairResultPath(workspaceRoot: string, timestamp: string): string {
  return join(pipelineRepairPlansRoot(workspaceRoot), `repair-result-${timestamp}.json`);
}

export function sourceReviewRecordPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineReviewRoot(workspaceRoot), `${sourceDocumentId}.review.json`);
}

export function sourcesRoot(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), '_sources');
}

// Path safety: ensure path is under knowledge root
export function isPathUnderKnowledge(workspaceRoot: string, target: string): boolean {
  const knowledge = resolve(knowledgeRoot(workspaceRoot));
  const resolved = resolve(target);
  const relativePath = relative(knowledge, resolved);
  if (relativePath.startsWith('..') || relativePath === '..' + sep) {
    return false;
  }
  return true;
}
