import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { indexesDir } from './paths.js';
import {
  assertSafeGenerationId,
  validateGenerationFiles,
  validateStoredKnowledgeGeneration,
} from './generation-validation.js';

export interface KnowledgeGenerationPointer {
  version: 1;
  generation_id: string;
  activated_at: string;
}

export interface KnowledgeGenerationManifest {
  version: 1;
  generation_id: string;
  created_at: string;
  previous_generation_id?: string;
  chunk_artifact_version: 4;
  chunking_strategy: 'parent-child-v4';
  chunk_count: number;
  vector_count?: number;
  vector_dimensions?: number;
  files: string[];
  file_hashes: Record<string, string>;
  mode: 'bm25_only' | 'hybrid';
}

export class KnowledgeGenerationConflictError extends Error {
  readonly code = 'generation_conflict';
}

export interface KnowledgeGenerationPublisherPort {
  readActive(): KnowledgeGenerationPointer | undefined;
  publish(input: Omit<Parameters<typeof publishKnowledgeGeneration>[0], 'workspaceRoot'>): KnowledgeGenerationPointer;
  rollback(input: Omit<Parameters<typeof rollbackKnowledgeGeneration>[0], 'workspaceRoot'>): KnowledgeGenerationPointer;
  recoverStaleLock(): boolean;
}

export function createFileKnowledgeGenerationPublisher(
  workspaceRoot: string,
): KnowledgeGenerationPublisherPort {
  return {
    readActive: () => readActiveKnowledgeGeneration(workspaceRoot),
    publish: (input) => publishKnowledgeGeneration({ workspaceRoot, ...input }),
    rollback: (input) => rollbackKnowledgeGeneration({ workspaceRoot, ...input }),
    recoverStaleLock: () => recoverStaleKnowledgeGenerationLock(workspaceRoot),
  };
}

export function activeGenerationPointerPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'active.json');
}

export function readActiveKnowledgeGeneration(
  workspaceRoot: string,
): KnowledgeGenerationPointer | undefined {
  const path = activeGenerationPointerPath(workspaceRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as KnowledgeGenerationPointer;
    if (parsed.version !== 1 || typeof parsed.generation_id !== 'string') return undefined;
    return validateStoredKnowledgeGeneration(workspaceRoot, parsed.generation_id, false) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function resolveKnowledgeGenerationFile(
  workspaceRoot: string,
  fileName: string,
  pointer = readActiveKnowledgeGeneration(workspaceRoot),
): string {
  if (!pointer) return join(indexesDir(workspaceRoot), fileName);
  return join(indexesDir(workspaceRoot), 'generations', pointer.generation_id, fileName);
}

export function resolveKnowledgeGenerationFileById(
  workspaceRoot: string,
  fileName: string,
  generationId: string | undefined,
): string {
  if (!generationId) return join(indexesDir(workspaceRoot), fileName);
  assertSafeGenerationId(generationId);
  return join(indexesDir(workspaceRoot), 'generations', generationId, fileName);
}

export function publishKnowledgeGeneration(input: {
  workspaceRoot: string;
  files: Record<string, string>;
  mode: 'bm25_only' | 'hybrid';
  expectedActiveGenerationId?: string;
  generationId?: string;
  now?: Date;
}): KnowledgeGenerationPointer {
  const validation = validateGenerationFiles(input.files, input.mode);
  const root = indexesDir(input.workspaceRoot);
  const generations = join(root, 'generations');
  const generationId = input.generationId ?? `gen_${randomUUID()}`;
  assertSafeGenerationId(generationId);
  const temporary = join(generations, `.${generationId}.tmp`);
  const finalDirectory = join(generations, generationId);
  const lockPath = join(root, '.generation-publish.lock');
  mkdirSync(generations, { recursive: true });
  acquireLock(lockPath, input.expectedActiveGenerationId);
  try {
    assertExpectedActive(input.workspaceRoot, input.expectedActiveGenerationId);
    if (existsSync(finalDirectory)) throw new Error('generation_already_exists');
    mkdirSync(temporary);
    for (const [fileName, content] of Object.entries(input.files)) {
      if (basename(fileName) !== fileName) throw new Error('invalid_generation_file');
      writeAndSync(join(temporary, fileName), content);
    }
    const now = (input.now ?? new Date()).toISOString();
    const manifest: KnowledgeGenerationManifest = {
      version: 1,
      generation_id: generationId,
      created_at: now,
      ...(input.expectedActiveGenerationId
        ? { previous_generation_id: input.expectedActiveGenerationId }
        : {}),
      chunk_artifact_version: 4,
      chunking_strategy: 'parent-child-v4',
      chunk_count: validation.chunkCount,
      ...(validation.vectorCount === undefined ? {} : { vector_count: validation.vectorCount }),
      ...(validation.vectorDimensions === undefined ? {} : { vector_dimensions: validation.vectorDimensions }),
      files: Object.keys(input.files).sort(),
      file_hashes: Object.fromEntries(Object.entries(input.files)
        .map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')])),
      mode: input.mode,
    };
    writeAndSync(
      join(temporary, 'generation-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    writeAndSync(join(temporary, 'complete.json'), `${JSON.stringify({
      version: 1,
      generation_id: generationId,
      manifest_hash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    })}\n`);
    fsyncDirectory(temporary);
    renameSync(temporary, finalDirectory);
    fsyncDirectory(generations);

    assertExpectedActive(input.workspaceRoot, input.expectedActiveGenerationId);
    return replaceActivePointer(input.workspaceRoot, {
      version: 1,
      generation_id: generationId,
      activated_at: now,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function recoverStaleKnowledgeGenerationLock(workspaceRoot: string): boolean {
  const lockPath = join(indexesDir(workspaceRoot), '.generation-publish.lock');
  if (!existsSync(lockPath)) return false;
  if (Date.now() - statSync(lockPath).mtimeMs <= 5 * 60_000) {
    throw new Error('generation_lock_busy');
  }
  const ownerPath = join(lockPath, 'owner.json');
  if (existsSync(ownerPath)) {
    try {
      const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as { pid?: unknown };
      if (typeof owner.pid === 'number' && isProcessAlive(owner.pid)) {
        throw new Error('generation_lock_owner_alive');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'generation_lock_owner_alive') throw error;
      throw new Error('generation_lock_owner_invalid');
    }
  }
  rmSync(lockPath, { recursive: true, force: true });
  return true;
}

export function rollbackKnowledgeGeneration(input: {
  workspaceRoot: string;
  expectedActiveGenerationId: string;
  previousGenerationId: string;
  now?: Date;
}): KnowledgeGenerationPointer {
  assertSafeGenerationId(input.previousGenerationId);
  const lockPath = join(indexesDir(input.workspaceRoot), '.generation-publish.lock');
  acquireLock(lockPath, input.expectedActiveGenerationId);
  try {
    assertExpectedActive(input.workspaceRoot, input.expectedActiveGenerationId);
    if (!validateStoredKnowledgeGeneration(input.workspaceRoot, input.previousGenerationId, true)) {
      throw new Error('rollback_generation_incomplete');
    }
    return replaceActivePointer(input.workspaceRoot, {
      version: 1,
      generation_id: input.previousGenerationId,
      activated_at: (input.now ?? new Date()).toISOString(),
    });
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function assertExpectedActive(workspaceRoot: string, expected?: string): void {
  if (readActiveKnowledgeGeneration(workspaceRoot)?.generation_id !== expected) {
    throw new KnowledgeGenerationConflictError('generation_conflict');
  }
}

function replaceActivePointer(
  workspaceRoot: string,
  pointer: KnowledgeGenerationPointer,
): KnowledgeGenerationPointer {
  const path = activeGenerationPointerPath(workspaceRoot);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeAndSync(temporary, `${JSON.stringify(pointer, null, 2)}\n`);
  renameSync(temporary, path);
  fsyncDirectory(indexesDir(workspaceRoot));
  return pointer;
}

function acquireLock(lockPath: string, expectedActiveGenerationId?: string): void {
  let created = false;
  try {
    mkdirSync(lockPath);
    created = true;
    writeAndSync(join(lockPath, 'owner.json'), `${JSON.stringify({
      version: 1,
      pid: process.pid,
      created_at: new Date().toISOString(),
      expected_active_generation_id: expectedActiveGenerationId ?? null,
    })}\n`);
    fsyncDirectory(lockPath);
  } catch (error) {
    if (created) {
      rmSync(lockPath, { recursive: true, force: true });
      throw new Error('generation_lock_failed', { cause: error });
    }
    if (!existsSync(lockPath)) throw new Error('generation_lock_failed');
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    throw new Error(ageMs > 5 * 60_000 ? 'generation_lock_stale' : 'generation_lock_busy');
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeAndSync(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
