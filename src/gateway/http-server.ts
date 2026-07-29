import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../config.js';
import { FileSecretsRepository, createOnboardingService, materializeConfigSecrets, type OnboardingService } from '../onboarding/index.js';
import { renderSetupApp } from '../setup-ui.js';
import { renderApp } from '../ui.js';
import { sendHtml, sendJson, sendRedirect } from './http-utils.js';
import { sendGatewayError } from './errors.js';
import { GatewayApplicationContext } from './application-context.js';
import { createDefaultDiagnosticWorker, type DiagnosticWorkerFactory } from '../workers/default-worker-factory.js';
import { handleChatRoutes } from './routes/chat-routes.js';
import { handleFsRoutes } from './routes/fs-routes.js';
import { handleKnowledgeRoutes } from './routes/knowledge-routes.js';
import { handleLogRoutes } from './routes/log-routes.js';
import { handleOnboardingRoutes } from './routes/onboarding-routes.js';
import { handleSessionRoutes } from './routes/session-routes.js';
import { handleSettingsRoutes } from './routes/settings-routes.js';
import { AssetNotFoundError, InvalidAssetPathError, sendPublicAsset } from './static-assets.js';

export interface StartServerOptions {
  config: SuperHelperConfig;
  onboarding?: OnboardingService;
  workerFactory?: DiagnosticWorkerFactory;
  onInternalError?: (message: string) => void;
}

export interface StartedServer {
  url: string;
  listenHost: string;
  port: number;
  close: () => Promise<void>;
}

export function startServer(options: StartServerOptions): Promise<StartedServer> {
  const secrets = new FileSecretsRepository(options.config.storage.rootDir);
  const runtimeConfig = materializeConfigSecrets(options.config, secrets);
  const context = new GatewayApplicationContext(
    runtimeConfig,
    options.workerFactory ?? createDefaultDiagnosticWorker,
    (ref) => secrets.resolve(ref),
  );
  const onboarding = options.onboarding ?? createOnboardingService({
    config: runtimeConfig,
    onConfigCommitted: (config) => context.reload(materializeConfigSecrets(config, secrets)),
  });
  if (!options.onboarding) {
    onboarding.recoverInterrupted();
  }

  context.agent.recoverInterruptedTurns();

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, context, onboarding, secrets);
    } catch (error) {
      sendGatewayError(res, error, options.onInternalError ?? console.error);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtimeConfig.server.port, runtimeConfig.server.host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : runtimeConfig.server.port;
      const listenHost = runtimeConfig.server.host;
      const host = listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost;
      resolve({
        url: `http://${host}:${actualPort}`,
        listenHost,
        port: actualPort,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  context: GatewayApplicationContext,
  onboarding: OnboardingService,
  secrets: FileSecretsRepository,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { config, store, agent, knowledge } = context;

  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    try {
      sendPublicAsset(res, url.pathname);
    } catch (error) {
      if (error instanceof InvalidAssetPathError) {
        sendJson(res, 400, { error: 'invalid asset path' });
      } else if (error instanceof AssetNotFoundError) {
        sendJson(res, 404, { error: 'asset not found' });
      } else {
        throw error;
      }
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/setup') {
    sendHtml(res, renderSetupApp());
    return;
  }

  if (req.method === 'GET' && isAppShellRoute(url.pathname)) {
    const onboardingState = onboarding.getState();
    if (!onboardingState.completed || onboardingState.needsReview) {
      sendRedirect(res, '/setup');
      return;
    }
    sendHtml(res, renderApp());
    return;
  }

  if (await handleOnboardingRoutes(req, res, url, onboarding)) {
    return;
  }
  if (await handleFsRoutes(req, res, url)) {
    return;
  }
  if (await handleSettingsRoutes(req, res, url, config, secrets)) {
    return;
  }
  if (await handleSessionRoutes(req, res, url, config, store, knowledge)) {
    return;
  }
  if (await handleKnowledgeRoutes(req, res, url, config, knowledge)) {
    return;
  }
  if (await handleChatRoutes(req, res, url, config, agent)) {
    return;
  }
  if (await handleLogRoutes(req, res, url, store)) {
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function isAppShellRoute(pathname: string): boolean {
  return pathname === '/' || /^\/sessions\/[^/]+(\/audit)?$/.test(pathname);
}
