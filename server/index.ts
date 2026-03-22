import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = new Hono();

// API routes
app.get('/api/health', (c) => {
  return c.json({
    nodes: [
      { name: 'k8s-control-01', status: 'Ready', roles: ['control-plane'], cpu: 23, memory: 41 },
      { name: 'k8s-worker-01', status: 'Ready', roles: ['worker'], cpu: 67, memory: 72 },
      { name: 'k8s-worker-02', status: 'Ready', roles: ['worker'], cpu: 45, memory: 58 },
      { name: 'k8s-worker-03', status: 'NotReady', roles: ['worker'], cpu: 0, memory: 0 },
    ],
    ceph: {
      status: 'HEALTH_WARN',
      message: '1 OSD down; recovery in progress (43% complete)',
      osdCount: 6,
      osdUp: 5,
      storageTotal: 4000,
      storageUsed: 2840,
      storageUnit: 'GB',
      pgStatus: '256 active+clean, 12 active+recovering',
    },
    timestamp: new Date().toISOString(),
  });
});

// Serve static files from dist/
app.use('/*', serveStatic({ root: './dist' }));

// SPA fallback — serve index.html for all non-API, non-static routes
app.get('*', (c) => {
  try {
    const html = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Not found — run `bun run build` first', 404);
  }
});

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`k8s-alerts server running on http://localhost:${info.port}`);
});
