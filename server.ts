import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Body parsers with 50mb limit for file attachments & media
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS and Security Headers for AI Studio Iframe and Android WebAssets
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static assets from public/ folder (images, icons, styles, js bundles)
app.use(express.static(path.resolve(__dirname, 'public')));
app.use('/assets', express.static(path.resolve(__dirname, 'public/assets')));

// Mount API routes
app.use('/api', apiRouter);

// Development mode with Vite Middleware
const isDev = process.env.NODE_ENV !== 'production';

async function startServer() {
  if (isDev) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('[Sami Server] Vite middlewares mounted for development');
    } catch (err: any) {
      console.warn('[Sami Server] Vite middleware mount note:', err?.message);
    }
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
  }

  // SPA fallback
  app.get('*', (req, res) => {
    const indexPath = path.resolve(__dirname, 'index.html');
    res.sendFile(indexPath);
  });

  app.listen(PORT, HOST, () => {
    console.log(`[Sami Server] App running on http://${HOST}:${PORT}`);
  });
}

startServer();
