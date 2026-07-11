import { renderBuiltApp } from '../gateway/static-assets.js';

export function renderSetupApp(): string {
  return renderBuiltApp('setup');
}
