import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandsRouter } from './server/routes/commands.ts';
import { scenesRouter } from './server/routes/scenes.ts';

function resolvePort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Number(process.env.PORT || 3000);
}

const PORT = resolvePort();
const RATE_LIMIT_RPM = Number(process.env.RATE_LIMIT_RPM || 60);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const requestWindow = new Map<string, number[]>();

function rateLimitMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const key = req.ip || 'local';
  const now = Date.now();
  const recent = (requestWindow.get(key) || []).filter((ts) => now - ts < 60_000);
  if (recent.length >= RATE_LIMIT_RPM) {
    res.status(429).json({
      error: 'Too many AI requests. Please wait a moment.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
    return;
  }
  recent.push(now);
  requestWindow.set(key, recent);
  next();
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: IS_PRODUCTION ? 'production' : 'development',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  app.use('/api/v1/commands', rateLimitMiddleware, commandsRouter);
  app.use('/api/v1/scenes', scenesRouter);

  let viteInstance: { close: () => Promise<void> } | null = null;

  if (!IS_PRODUCTION) {
    // HMR is disabled: serve an inert @vite/client ESM shim so CSS style injection works without ws://localhost:24678 errors
    const viteClientShim = [
      'const styleMap = new Map();',
      'export function updateStyle(id, css) {',
      '  let el = styleMap.get(id);',
      '  if (!el) {',
      '    el = document.createElement("style");',
      '    el.setAttribute("type", "text/css");',
      '    el.setAttribute("data-vite-dev-id", id);',
      '    document.head.appendChild(el);',
      '    styleMap.set(id, el);',
      '  }',
      '  el.textContent = css;',
      '}',
      'export function removeStyle(id) {',
      '  const el = styleMap.get(id);',
      '  if (el) { el.remove(); styleMap.delete(id); }',
      '}',
      'export function createHotContext() {',
      '  return { accept() {}, dispose() {}, prune() {}, invalidate() {}, decline() {}, on() {}, off() {}, send() {}, data: {} };',
      '}',
      'export function injectQuery(url) { return url; }',
      'export class ErrorOverlay {}',
    ].join('\n');

    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(viteClientShim);
    });

    const viteReady = import('vite').then(async ({ createServer: createViteServer }) => {
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'spa',
      });
      viteInstance = vite;
      setTimeout(() => {
        void vite.warmupRequest('/src/index.ts').catch(() => undefined);
      }, 400);
      return vite;
    });

    app.use((req, res, next) => {
      viteReady
        .then((vite) => vite.middlewares(req, res, next))
        .catch(next);
    });
  } else {
    const distDir = join(process.cwd(), 'dist');
    if (existsSync(distDir)) {
      app.use(
        express.static(distDir, {
          maxAge: '1h',
          index: false,
        }),
      );
      app.get('*', (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`WorldCraft AI server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      if (viteInstance) {
        void viteInstance.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start WorldCraft AI server:', err);
  process.exit(1);
});
