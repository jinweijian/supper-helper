import { renderBuiltApp } from '../gateway/static-assets.js';

export function renderApp(): string {
  return renderBuiltApp('dashboard');
}
