// Render web service server.
// Serves the Vite build and proxies /.wrtc/* signaling (HTTP + WebSocket) to EC2.
// WebSocket upgrade support is required for Geckos.io signaling.

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PORT = process.env.PORT || 10000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Proxy /.wrtc/* to game server (HTTP + WebSocket) ----
const wrtcProxy = createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    ws: true,
    on: {
        error(err, _req, res) {
            if (res && typeof res.writeHead === 'function') {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend unreachable' }));
            }
            console.error('[Proxy] Error:', err.message);
        },
    },
});
app.use('/.wrtc', wrtcProxy);

// ---- Serve static Vite build ----
app.use(express.static(join(__dirname, 'dist')));

// ---- SPA fallback ----
app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`[Render] Listening on :${PORT}`);
    console.log(`[Render] Proxying /.wrtc/* → ${BACKEND_URL}`);
});

// ---- Attach WebSocket upgrade handler to the HTTP server ----
server.on('upgrade', wrtcProxy.upgrade);
