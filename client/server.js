/**
 * Production Server for Docker Deployment
 * Handles static file serving and WebRTC signaling proxy
 */
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Get game server URL from environment
const GAME_SERVER_URL = process.env.VITE_SERVER_URL || 'http://13.127.217.1';
const GAME_SERVER_PORT = process.env.VITE_SERVER_PORT || '3000';
const TARGET = `${GAME_SERVER_URL}:${GAME_SERVER_PORT}`.replace(/:(\d+):(\d+)/, ':$2'); // Handle if port already in URL

console.log(`[Proxy] Game server target: ${TARGET}`);

// Proxy WebRTC signaling requests to game server
app.use('/.wrtc', createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    ws: true, // Support WebSocket upgrade
    logLevel: 'debug',
    onError: (err, req, res) => {
        console.error('[Proxy Error]', err.message);
        res.status(502).json({ error: 'Proxy error', message: err.message });
    }
}));

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback - serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on port ${PORT}`);
    console.log(`[Server] Proxying /.wrtc/* -> ${TARGET}/.wrtc/*`);
});
