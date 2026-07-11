import { readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';

const PUBLIC_ROOT = resolve(process.cwd(), 'dist/public');

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export function renderBuiltApp(entry: 'dashboard' | 'setup', publicRoot = PUBLIC_ROOT): string {
  const file = entry === 'setup' ? join(publicRoot, 'setup/index.html') : join(publicRoot, 'index.html');
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error('Web UI build is missing. Run pnpm build before starting the server.');
  }
}

export function readPublicAsset(pathname: string, publicRoot = PUBLIC_ROOT): { body: Buffer; contentType: string; cacheControl: string } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new InvalidAssetPathError();
  }
  if (!decoded.startsWith('/assets/') || decoded.includes('\0')) throw new InvalidAssetPathError();
  const root = resolve(publicRoot);
  const target = resolve(root, `.${decoded}`);
  const relation = relative(root, target);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new InvalidAssetPathError();
  try {
    return {
      body: readFileSync(target),
      contentType: MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      cacheControl: /-[A-Za-z0-9_-]{8,}\./.test(target) ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
  } catch {
    throw new AssetNotFoundError();
  }
}

export function sendPublicAsset(res: ServerResponse, pathname: string): void {
  const asset = readPublicAsset(pathname);
  res.writeHead(200, {
    'content-type': asset.contentType,
    'cache-control': asset.cacheControl,
    'x-content-type-options': 'nosniff',
  });
  res.end(asset.body);
}

export class InvalidAssetPathError extends Error {}
export class AssetNotFoundError extends Error {}
