import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readPublicAsset } from '../dist/gateway/static-assets.js';
import { renderSetupApp } from '../dist/setup-ui.js';
import { renderApp } from '../dist/ui.js';
import { supportsNode } from '../scripts/check-node-version.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;

test('production build contains Vue dashboard and setup entries', () => {
  const dashboard = join(repoRoot, 'dist/public/index.html');
  const setup = join(repoRoot, 'dist/public/setup/index.html');
  assert.equal(existsSync(dashboard), true);
  assert.equal(existsSync(setup), true);
  assert.match(readFileSync(dashboard, 'utf8'), /<script[^>]+src="\/assets\/.+\.js"/);
  assert.match(readFileSync(setup, 'utf8'), /<script[^>]+src="\/assets\/.+\.js"/);
});

test('public render symbols read the built entries without byte-level legacy coupling', () => {
  assert.match(renderApp(), /\/assets\/dashboard-.+\.js/);
  assert.match(renderSetupApp(), /\/assets\/setup-.+\.js/);
});

test('asset reader applies MIME, immutable cache, and traversal containment', () => {
  const dashboard = readFileSync(join(repoRoot, 'dist/public/index.html'), 'utf8');
  const assetPath = dashboard.match(/src="(\/assets\/dashboard-.+\.js)"/)?.[1];
  assert.ok(assetPath);
  const asset = readPublicAsset(assetPath);
  assert.equal(asset.contentType, 'text/javascript; charset=utf-8');
  assert.match(asset.cacheControl, /immutable/);
  assert.throws(() => readPublicAsset('/assets/../../package.json'));
  assert.throws(() => readPublicAsset('/assets/%2e%2e%2fpackage.json'));
});

test('package contract requires the Vite build and supported Node floor', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '>=20.19.0');
  assert.match(pkg.scripts.build, /vite build/);
  assert.equal(typeof pkg.scripts['test:web'], 'string');
  assert.equal(typeof pkg.scripts['test:e2e'], 'string');
});

test('Node floor rejects runtimes below 20.19', () => {
  assert.equal(supportsNode('20.18.3'), false);
  assert.equal(supportsNode('20.19.0'), true);
  assert.equal(supportsNode('22.0.0'), true);
});
