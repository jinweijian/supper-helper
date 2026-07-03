import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, 'src');

function tsFilesUnder(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...tsFilesUnder(path));
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function relativeSource(path) {
  return relative(repoRoot, path).split(sep).join('/');
}

function allTextFilesUnder(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === '.pnpm-store') continue;
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...allTextFilesUnder(path));
    } else if (/\.(?:ts|js|mjs|json|md|yaml|yml)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function assertNoImportPattern(files, patterns, message) {
  const offenders = [];
  for (const file of files) {
    const source = read(file);
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        offenders.push(`${relativeSource(file)} matches ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, [], message);
}

function assertAbsent(paths, message) {
  const existing = paths.filter((path) => existsSync(join(repoRoot, path)));
  assert.deepEqual(existing, [], message);
}

test('knowledge module does not import provider modules', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'knowledge')),
    [
      /from\s+['"]\.\.\/providers(?:\/|['"])/,
      /from\s+['"]\.\.\/embedding(?:\/|['"])/,
      /import\s*\(\s*['"]\.\.\/providers(?:\/|['"])/,
      /import\s*\(\s*['"]\.\.\/embedding(?:\/|['"])/,
    ],
    'knowledge must own local assets and artifacts, not provider factories or compatibility provider modules',
  );
});

test('deleted private compatibility source surfaces stay absent', () => {
  assertAbsent([
    'src/embedding',
    'src/retrieval/compatibility-search.ts',
    'src/retrieval/legacy-rag.ts',
    'src/retrieval/recall/keyword',
    'src/knowledge/indexer.ts',
    'src/knowledge/eval.ts',
    'src/agent.ts',
    'src/server.ts',
    'src/claude-worker.ts',
    'src/index.ts',
    'src/cli/doctor-command.ts',
    'src/cli/server-commands.ts',
    'src/cli/status-command.ts',
    'src/cli/index.ts',
  ], 'private compatibility directories, root aliases, and legacy retrieval files must be physically removed');
});

test('deleted compatibility symbols are not re-exported or routed under new names', () => {
  const scanRoots = [
    'src',
    'dist',
    'docs',
    'AGENTS.md',
    'README.md',
    'package.json',
  ];
  const files = scanRoots.flatMap((scanRoot) => {
    const absolute = join(repoRoot, scanRoot);
    if (!existsSync(absolute)) return [];
    return statSync(absolute).isDirectory() ? allTextFilesUnder(absolute) : [absolute];
  }).filter((path) => !relativeSource(path).startsWith('docs/archive/superpowers/'));
  assertNoImportPattern(
    files,
    [
      /\bsearchKnowledge[A-Za-z_$\w]*/,
      /\bsearchKnowledgeWithRag\b/,
      /\bKnowledgeRagSearchQuery\b/,
      /\bsearchKnowledgeCompatibility\b/,
      /\bcompatibilityKeywordsFromQuery\b/,
      /\bcreateKeywordRecallStrategy\b/,
      /\bincludeKeywordCompatibility\b/,
      /\bKnowledgeEval(?:Question|QuestionResult|Report)\b/,
      /knowledge:eval/,
      /knowledge\s+<[^>]*search/,
      /knowledge\s+<[^>]*eval/,
    ],
    'deleted legacy symbols, package aliases, and knowledge query/eval usage must not survive in source, declarations, or current docs',
  );
});

test('root deprecation re-exports match owner module symbols', async () => {
  const [
    oldModel,
    newModel,
    oldSmoke,
    newSmoke,
    oldPreflight,
    newPreflight,
    oldStorage,
    newStorage,
  ] = await Promise.all([
    import('../dist/model.js'),
    import('../dist/providers/model/adapter.js'),
    import('../dist/model-smoke-test.js'),
    import('../dist/providers/model/smoke-test.js'),
    import('../dist/preflight.js'),
    import('../dist/runtime/preflight-decision.js'),
    import('../dist/storage.js'),
    import('../dist/sessions/file-memory-store.js'),
  ]);

  assert.equal(oldModel.createModelClient, newModel.createModelClient);
  assert.equal(oldSmoke.runModelSmokeTest, newSmoke.runModelSmokeTest);
  assert.equal(oldPreflight.preflight, newPreflight.preflight);
  assert.equal(oldStorage.FileMemoryStore, newStorage.FileMemoryStore);
});

test('retrieval CLI uses configured retrieval instead of manual BM25-only wiring', () => {
  assertNoImportPattern(
    [join(srcRoot, 'cli', 'command-retrieval.ts')],
    [
      /\bcreateRetrievalService\b/,
      /\bcreateBm25RecallStrategy\b/,
      /from\s+['"]\.\.\/retrieval\/index(?:\.js)?['"]/,
    ],
    'retrieval search/debug must use configured retrieval composition, not manual BM25-only service construction',
  );
});

test('embedding provider implementations do not reverse-import a deleted embedding facade', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'providers', 'embedding')),
    [
      /from\s+['"](?:\.\.\/)+embedding(?:\/|['"])/,
      /import\s*\(\s*['"](?:\.\.\/)+embedding(?:\/|['"])/,
    ],
    'provider implementations must live under src/providers and never load implementation from deleted src/embedding',
  );
});

test('configured retrieval composes the registry service without keyword or legacy shortcuts', () => {
  assertNoImportPattern(
    [join(srcRoot, 'retrieval', 'configured-search.ts')],
    [
      /\bsearchKnowledge[A-Za-z_$\w]*/,
      /from\s+['"]\.\/legacy-rag(?:\.js)?['"]/,
    ],
    'configured retrieval must always use the registry/service production path',
  );
});

test('knowledge consumes stable embedding contracts instead of declaring provider-shaped ports', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'knowledge')),
    [
      /\binterface\s+KnowledgeEmbedding(?:Provider|Config|Document)[A-Za-z_$\w]*/,
    ],
    'knowledge must consume stable contracts and must not declare embedding/rerank provider-shaped interfaces',
  );
});

test('knowledge CLI is a thin dispatcher with focused handler modules', () => {
  const dispatcher = join(srcRoot, 'cli', 'command-knowledge.ts');
  assert.ok(read(dispatcher).split(/\r?\n/).length <= 120, 'command-knowledge.ts must stay at or below 120 lines');
  const commandRoot = join(srcRoot, 'cli', 'knowledge');
  assert.equal(existsSync(commandRoot), true, 'src/cli/knowledge must exist');
  const files = existsSync(commandRoot) ? new Set(readdirSync(commandRoot)) : new Set();
  for (const file of ['context.ts', 'output.ts', 'command-workspace.ts', 'command-pipeline.ts', 'command-vector.ts']) {
    assert.equal(files.has(file), true, `${file} must exist under src/cli/knowledge`);
  }
});

test('production source does not import the legacy embedding facade', () => {
  const productionFiles = tsFilesUnder(srcRoot).filter((path) => {
    const relative = relativeSource(path);
    return !relative.startsWith('src/embedding/') && !relative.startsWith('src/providers/');
  });
  assertNoImportPattern(
    productionFiles,
    [
      /from\s+['"](?:\.\.\/|\.\/)+embedding(?:\/|['"])/,
      /import\s*\(\s*['"](?:\.\.\/|\.\/)+embedding(?:\/|['"])/,
    ],
    'production modules must import embedding/rerank capabilities from src/providers directly',
  );
});

test('runtime module does not instantiate embedding or rerank providers', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'runtime')),
    [
      /\bcreateEmbeddingProvider\b/,
      /\bcreateRerankProvider\b/,
      /from\s+['"]\.\.\/providers\/(?:embedding|rerank)\/factory(?:\.js)?['"]/,
      /from\s+['"]\.\.\/embedding(?:\/|['"])/,
    ],
    'runtime must depend on retrieval services, not provider factories or legacy embedding provider modules',
  );
});

test('runtime depends on the case repository port instead of FileMemoryStore', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'runtime')),
    [
      /from\s+['"]\.\.\/sessions\/file-memory-store(?:\.js)?['"]/,
      /\bFileMemoryStore\b/,
    ],
    'runtime services should depend on CaseRepository and StoredCase from the repository contract, not the file-backed implementation',
  );
});

test('case repository contract does not reverse-import file store implementation', () => {
  assertNoImportPattern(
    [join(srcRoot, 'sessions', 'case-repository.ts')],
    [
      /file-memory-store/,
      /\bFileMemoryStore\b/,
    ],
    'case-repository.ts must define the port and StoredCase shape without importing the file-backed implementation',
  );
});

test('production modules consume StoredCase from the repository contract', () => {
  const productionFiles = tsFilesUnder(srcRoot)
    .filter((file) => relativeSource(file) !== 'src/sessions/file-memory-store.ts');
  assertNoImportPattern(
    productionFiles,
    [
      /import\s+type\s+\{[^}]*\bStoredCase\b[^}]*\}\s+from\s+['"][^'"]*file-memory-store(?:\.js)?['"]/,
      /import\s+\{[^}]*\bStoredCase\b[^}]*\}\s+from\s+['"][^'"]*file-memory-store(?:\.js)?['"]/,
    ],
    'StoredCase is part of the CaseRepository contract; consumers should not import it from the file-backed adapter',
  );
});

test('diagnostic runtime is a thin composition root with focused collaborators', () => {
  const runtimePath = join(srcRoot, 'runtime', 'diagnostic-runtime.ts');
  const source = read(runtimePath);
  assert.ok(source.split(/\r?\n/).length <= 300, 'diagnostic-runtime.ts must stay at or below 300 lines');

  const runtimeFiles = new Set(readdirSync(join(srcRoot, 'runtime')));
  const collaborators = [
    ['turn-queue.ts', 'CaseTurnQueue'],
    ['session-lifecycle.ts', 'SessionLifecycle'],
    ['preflight-service.ts', 'PreflightService'],
    ['experience-turn.ts', 'ExperienceTurnService'],
    ['knowledge-turn.ts', 'KnowledgeTurnService'],
    ['worker-diagnosis.ts', 'WorkerDiagnosisService'],
    ['review-presentation.ts', 'ReviewPresentationService'],
    ['case-curation-service.ts', 'CaseCurationService'],
  ];
  for (const [file, symbol] of collaborators) {
    assert.equal(runtimeFiles.has(file), true, `${file} must exist under src/runtime`);
    assert.match(source, new RegExp(`\\b${symbol}\\b`), `DiagnosticRuntime must compose ${symbol}`);
  }

  assertNoImportPattern(
    [runtimePath],
    [
      /from\s+['"]\.\.\/knowledge(?:\/|['"])/,
      /\bresolveKnowledgeWorkspaceRoot\b/,
      /\bknowledgeRoot\b/,
      /\bexistsSync\b/,
      /\bcreateEmbeddingProvider\b/,
      /\bcreateRerankProvider\b/,
    ],
    'DiagnosticRuntime must coordinate services without owning knowledge paths, artifacts, or providers',
  );
});

test('settings service is a thin compatibility facade with focused owners', () => {
  const settingsRoot = join(srcRoot, 'settings');
  const facadePath = join(settingsRoot, 'service.ts');
  const source = read(facadePath);
  assert.ok(source.split(/\r?\n/).length <= 120, 'settings/service.ts must stay at or below 120 lines');

  const required = [
    'contracts.ts',
    'public-view.ts',
    'secrets.ts',
    'model-settings.ts',
    'provider-settings.ts',
    'claude-settings.ts',
  ];
  const files = new Set(readdirSync(settingsRoot));
  for (const file of required) {
    assert.equal(files.has(file), true, `${file} must exist under src/settings`);
  }

  assertNoImportPattern(
    [facadePath],
    [
      /\bfunction\s+[A-Za-z_$]/,
      /\binterface\s+[A-Za-z_$]/,
      /\bconst\s+[A-Za-z_$][\w$]*\s*=/,
      /\bsaveConfig\b/,
      /\brun(?:Model|Embedding|Rerank)SmokeTest\b/,
    ],
    'settings/service.ts must contain compatibility exports only',
  );
  assertNoImportPattern(
    tsFilesUnder(settingsRoot).filter((path) => path !== facadePath),
    [/from\s+['"]\.\/service(?:\.js)?['"]/],
    'settings implementations must never import the compatibility facade',
  );
});

test('root CLI entrypoint stays thin and avoids business-module imports', () => {
  const source = read(join(srcRoot, 'cli.ts'));
  assert.match(source, /^#!\/usr\/bin\/env node/);
  assert.match(source, /['"]\.\/cli\/main\.js['"]/);
  assertNoImportPattern(
    [join(srcRoot, 'cli.ts')],
    [
      /from\s+['"]\.\/knowledge(?:\/|['"])/,
      /from\s+['"]\.\/retrieval(?:\/|['"])/,
      /from\s+['"]\.\/providers(?:\/|['"])/,
      /from\s+['"]\.\/embedding(?:\/|['"])/,
      /from\s+['"]\.\/runtime(?:\/|['"])/,
      /from\s+['"]\.\/gateway(?:\/|['"])/,
      /from\s+['"]\.\/onboarding(?:\/|['"])/,
      /from\s+['"]\.\/server(?:\/|['"])/,
      /from\s+['"]\.\/config(?:\/|['"])/,
    ],
    'root cli.ts must delegate to cli/main.ts and avoid direct business imports',
  );
});

test('primary CLI command adapters use command prefix', () => {
  const required = [
    'command-server.ts',
    'command-status.ts',
    'command-doctor.ts',
    'command-knowledge.ts',
    'command-retrieval.ts',
    'command-provider.ts',
    'command-config.ts',
    'command-accept.ts',
  ];
  const cliFiles = new Set(readdirSync(join(srcRoot, 'cli')));
  for (const file of required) {
    assert.equal(cliFiles.has(file), true, `${file} must exist`);
  }

  assertAbsent(
    ['src/cli/server-commands.ts', 'src/cli/status-command.ts', 'src/cli/doctor-command.ts'],
    'legacy CLI alias files must not exist',
  );
});

test('rerank provider implementation does not live under embedding directories', () => {
  const embeddingFiles = [
    ...safeTsFilesUnder(join(srcRoot, 'providers', 'embedding')),
  ];
  const offenders = embeddingFiles
    .map(relativeSource)
    .filter((path) => /(?:^|\/)rerank(?:-|\.|\/)/.test(path));

  assert.deepEqual(offenders, [], 'rerank provider files must live under src/providers/rerank, not embedding');
});

test('gateway settings route delegates settings orchestration to settings service', () => {
  assertNoImportPattern(
    [join(srcRoot, 'gateway', 'routes', 'settings-routes.ts')],
    [
      /\brunModelSmokeTest\b/,
      /\brunEmbeddingSmokeTest\b/,
      /\brunRerankSmokeTest\b/,
      /\bsaveConfig\b/,
      /\bmodelProviderFromInput\b/,
      /\bembeddingProviderFromInput\b/,
      /\brerankProviderFromInput\b/,
      /from\s+['"]\.\.\/\.\.\/(?:embedding|providers|model-smoke-test|runtime)\/?/,
    ],
    'settings route must stay at HTTP/body/status/serialization boundary and delegate orchestration',
  );
});

test('gateway delegates knowledge health and worker construction to owner services', () => {
  assertNoImportPattern(
    tsFilesUnder(join(srcRoot, 'gateway')),
    [
      /\bbuildKnowledgeHealthSummary\b/,
      /\bcreateConfiguredKnowledgeRetriever\b/,
      /\bnew\s+ClaudeCodeWorker\b/,
      /from\s+['"][^'"]*workers\/claude\/claude-code-worker\.js['"]/,
    ],
    'gateway must not own knowledge health orchestration or concrete worker construction',
  );
});

function safeTsFilesUnder(dir) {
  try {
    return tsFilesUnder(dir);
  } catch {
    return [];
  }
}
