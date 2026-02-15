// Minimal server for Render web service deployment.
// Serves the Vite build and proxies /.wrtc/* signaling to EC2.
// This solves HTTPS (Render) → HTTP (EC2) mixed content for Geckos.io.

import express from 'express';
import { request as httpRequest } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PORT = process.env.PORT || 10000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Proxy /.wrtc/* to game server (SSL termination) ----
app.all('/.wrtc/*', (req, res) => {
    const target = new URL(req.url, BACKEND_URL);

    const proxyReq = httpRequest(target, {
        method: req.method,
        headers: { ...req.headers, host: target.host },
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('[Proxy] Error:', err.message);
        res.status(502).json({ error: 'Backend unreachable' });
    });

    req.pipe(proxyReq);
});

// ---- Serve static Vite build ----
app.use(express.static(join(__dirname, 'dist')));

// ---- SPA fallback ----
app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[Render] Listening on :${PORT}`);
    console.log(`[Render] Proxying /.wrtc/* → ${BACKEND_URL}`);
});
