import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const lines = (path) => read(path).split(/\r?\n/).length;

test('quality owners contain production behavior and do not reverse-export the audit orchestrator', () => {
  const index = read('src/knowledge/quality/index.ts');
  for (const owner of ['source-rules', 'slice-rules', 'chunk-rules', 'aggregation', 'report-io', 'gate', 'chunk-map']) {
    const path = `src/knowledge/quality/${owner}.ts`;
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`);
    const source = read(path);
    assert.ok(lines(path) >= 20, `${path} must contain real behavior`);
    assert.ok(lines(path) <= 300, `${path} exceeds owner budget`);
    assert.doesNotMatch(source, /from ['"]\.\/audit\.js['"]/);
    assert.match(index, new RegExp(`['"]\\./${owner}\\.js['"]`));
  }
  assert.ok(lines('src/knowledge/quality/audit.ts') <= 300, 'quality audit must be orchestration only');
});

test('knowledge implementation owners stay within the reviewed 300 line budget', () => {
  const implementationOwners = [
    'src/knowledge/extract.ts',
    'src/knowledge/frontmatter.ts',
    'src/knowledge/ingest.ts',
    'src/knowledge/publish.ts',
    'src/knowledge/redmine-card.ts',
    'src/knowledge/repair.ts',
    'src/knowledge/slicer.ts',
    'src/knowledge/templates.ts',
    'src/knowledge/vector-index.ts',
    'src/knowledge/documents/chunks.ts',
  ];
  for (const path of implementationOwners) {
    assert.ok(lines(path) <= 300, `${path} has ${lines(path)} lines without an approved exception`);
  }
});

test('shared public aggregators are capability-scoped and contain no IO or business functions', () => {
  assert.ok(lines('src/domain.ts') <= 120, 'domain.ts must become a type-only public aggregator');
  assert.ok(lines('src/knowledge/types.ts') <= 160, 'knowledge/types.ts must become a capability contract aggregator');
  const config = read('src/config.ts');
  assert.ok(lines('src/config.ts') <= 180, 'config.ts must delegate IO/defaults/resolution to focused owners');
  assert.doesNotMatch(config, /readFileSync|writeJsonAtomic|function\s+inferModelContextWindowTokens/);
});

test('local knowledge acceptance command is registered', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(typeof scripts['acceptance:knowledge:local'], 'string');
  assert.match(scripts['acceptance:knowledge:local'], /knowledge/);
});

test('all oversized production implementations are explicitly reviewed and no Knowledge owner crosses layers', () => {
  const approved = new Set([
    'src/runtime/evidence-judge.ts',
    'src/runtime/presenter.ts',
    'src/runtime/case-curator.ts',
    'src/onboarding/runner.ts',
    'src/runtime/knowledge-diagnosis.ts',
    'src/runtime/knowledge-acceptance.ts',
    'src/runtime/retrieval-evaluation.ts',
  ]);
  const production = [...walk(join(root, 'src')), ...walk(join(root, 'web/src'))]
    .filter((path) => /\.(?:ts|vue)$/.test(path) && !path.endsWith('.test.ts'));
  const oversized = production
    .map((path) => ({ path: path.slice(root.length), lines: readFileSync(path, 'utf8').split(/\r?\n/).length }))
    .filter((item) => item.lines > 300);
  assert.deepEqual(new Set(oversized.map((item) => item.path)), approved);
  const design = read('openspec/changes/complete-knowledge-domain-owner-split/design.md');
  for (const path of approved) assert.match(design, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const path of walk(join(root, 'src/knowledge')).filter((item) => item.endsWith('.ts'))) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /from ['"][^'"]*(?:runtime|gateway|workers)\//, path);
    assert.doesNotMatch(source, /from ['"][^'"]*providers\/(?:embedding|rerank)\/(?:siliconflow|minimax)/, path);
  }
});

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
