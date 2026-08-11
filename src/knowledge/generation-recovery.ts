import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { indexesDir } from './paths.js';
import { assertSafeGenerationId, validateStoredKnowledgeGeneration } from './generation-validation.js';

const STALE_LOCK_MS = 5 * 60_000;

export function recoverStaleKnowledgeGenerationLock(workspaceRoot: string): boolean {
  const root = indexesDir(workspaceRoot);
  const lockPath = join(root, '.generation-publish.lock');
  if (!existsSync(lockPath)) return false;
  if (Date.now() - statSync(lockPath).mtimeMs <= STALE_LOCK_MS) {
    throw new Error('generation_lock_busy');
  }

  const activeGenerationId = readValidatedActiveGenerationId(workspaceRoot);
  const owner = readValidatedLockOwner(lockPath);
  const createdAt = Date.parse(owner.created_at);
  if (Date.now() - createdAt <= STALE_LOCK_MS) throw new Error('generation_lock_busy');
  if (isProcessAlive(owner.pid)) throw new Error('generation_lock_owner_alive');
  if ((activeGenerationId ?? null) !== owner.expected_active_generation_id) {
    throw new Error('generation_recovery_active_changed');
  }

  recoverIncompleteGenerations(workspaceRoot, activeGenerationId);
  rmSync(lockPath, { recursive: true, force: true });
  return true;
}

function readValidatedActiveGenerationId(workspaceRoot: string): string | undefined {
  const pointerPath = join(indexesDir(workspaceRoot), 'active.json');
  if (!existsSync(pointerPath)) return undefined;
  try {
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as {
      version?: unknown;
      generation_id?: unknown;
    };
    if (pointer.version !== 1 || typeof pointer.generation_id !== 'string') {
      throw new Error('invalid pointer');
    }
    assertSafeGenerationId(pointer.generation_id);
    if (!validateStoredKnowledgeGeneration(workspaceRoot, pointer.generation_id, false)) {
      throw new Error('invalid generation');
    }
    return pointer.generation_id;
  } catch {
    throw new Error('generation_recovery_active_invalid');
  }
}

function readValidatedLockOwner(lockPath: string): {
  pid: number;
  created_at: string;
  expected_active_generation_id: string | null;
} {
  const ownerPath = join(lockPath, 'owner.json');
  if (!existsSync(ownerPath)) throw new Error('generation_lock_owner_invalid');
  try {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as {
      version?: unknown;
      pid?: unknown;
      created_at?: unknown;
      expected_active_generation_id?: unknown;
    };
    if (
      owner.version !== 1 ||
      typeof owner.pid !== 'number' ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.created_at !== 'string' ||
      !Number.isFinite(Date.parse(owner.created_at)) ||
      (owner.expected_active_generation_id !== null && typeof owner.expected_active_generation_id !== 'string')
    ) {
      throw new Error('invalid owner');
    }
    if (typeof owner.expected_active_generation_id === 'string') {
      assertSafeGenerationId(owner.expected_active_generation_id);
    }
    return owner as {
      pid: number;
      created_at: string;
      expected_active_generation_id: string | null;
    };
  } catch {
    throw new Error('generation_lock_owner_invalid');
  }
}

function recoverIncompleteGenerations(workspaceRoot: string, activeGenerationId?: string): void {
  const generations = join(indexesDir(workspaceRoot), 'generations');
  if (!existsSync(generations)) return;
  for (const entry of readdirSync(generations, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(generations, entry.name);
    if (/^\.gen_[A-Za-z0-9._-]+\.tmp$/.test(entry.name)) {
      rmSync(directory, { recursive: true, force: true });
      continue;
    }
    if (entry.name === activeGenerationId) continue;
    if (validateStoredKnowledgeGeneration(workspaceRoot, entry.name, false)) continue;
    const hasCompletionMetadata = existsSync(join(directory, 'complete.json')) ||
      existsSync(join(directory, 'generation-manifest.json'));
    if (hasCompletionMetadata) throw new Error('generation_recovery_invalid_generation');
    rmSync(directory, { recursive: true, force: true });
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    return false;
  }
}
